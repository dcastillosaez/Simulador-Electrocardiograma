@echo off
setlocal enabledelayedexpansion

rem Arranca el simulador completo: Postgres, backend y frontend.
rem
rem Pensado para no exigir nada al que lo ejecuta: si Docker Desktop esta
rem cerrado lo abre y espera; si "uv" no esta en el PATH lo busca donde lo
rem deja WinGet; si falta el entorno de Python lo crea.

set "ROOT=%~dp0"

rem Los dos puertos se pueden fijar desde fuera (set PUERTO_API=... antes de
rem llamar) por si en una maquina concreta hacen falta otros.
rem
rem El backend NO va en el 8000, que seria lo natural: Windows se reserva
rem rangos enteros de puertos para si mismo --Hyper-V y Docker los piden al
rem arrancar-- y en la maquina de desarrollo el 7990-8089 esta dentro de uno.
rem Intentar escuchar ahi no da "puerto ocupado" sino un error de permisos
rem (WinError 10013) que despista bastante. Es el mismo motivo por el que el
rem frontend no usa el 5173 de Vite. Para ver los rangos reservados:
rem     netsh interface ipv4 show excludedportrange protocol=tcp
if not defined PUERTO_API set "PUERTO_API=8200"
if not defined PUERTO_WEB set "PUERTO_WEB=5600"

rem El frontend tiene que hablar al mismo puerto que el backend. Se le pasa por
rem el entorno en vez de dejarlo en un fichero: asi cambiar PUERTO_API arriba
rem basta, y no hay dos sitios que se puedan contradecir.
set "VITE_API_BASE_URL=http://localhost:%PUERTO_API%"
set "VITE_WS_URL=ws://localhost:%PUERTO_API%/ws/simulation"

rem ---------------------------------------------------------------- Node ---
where npm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] No se encuentra "npm" en el PATH. Instala Node.js desde
    echo         https://nodejs.org y vuelve a ejecutar este fichero.
    pause
    exit /b 1
)

rem ------------------------------------------------------------------ uv ---
rem WinGet instala los ejecutables en un directorio que se anade al PATH del
rem usuario, pero ese cambio no llega a las sesiones ya abiertas. Buscarlo a
rem mano evita el "uv no esta instalado" en una maquina donde si lo esta.
rem Se anade su carpeta al PATH en vez de guardar la ruta completa: la ruta
rem lleva espacios y acabaria dentro de un start ... cmd /k "...", donde las
rem comillas anidadas son un problema clasico de cmd.
where uv >nul 2>nul
if errorlevel 1 (
    if exist "%LOCALAPPDATA%\Microsoft\WinGet\Links\uv.exe" (
        set "PATH=%LOCALAPPDATA%\Microsoft\WinGet\Links;%PATH%"
    ) else if exist "%USERPROFILE%\.local\bin\uv.exe" (
        set "PATH=%USERPROFILE%\.local\bin;%PATH%"
    ) else if exist "%USERPROFILE%\.cargo\bin\uv.exe" (
        set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
    ) else (
        echo [ERROR] No se encuentra "uv". Instalalo con:
        echo             winget install astral-sh.uv
        echo         o desde https://docs.astral.sh/uv/
        pause
        exit /b 1
    )
)

rem -------------------------------------------------------------- Docker ---
where docker >nul 2>nul
if errorlevel 1 (
    echo [ERROR] No se encuentra "docker" en el PATH. Instala Docker Desktop.
    pause
    exit /b 1
)

echo Comprobando Docker...
docker info >nul 2>nul
if errorlevel 1 (
    echo Docker Desktop no esta arrancado. Abriendolo...

    rem Tres rutas y no una: el instalador por defecto lo deja en Archivos de
    rem programa, pero una instalacion por usuario --la que hace WinGet sin
    rem permisos de administrador-- lo deja bajo LOCALAPPDATA, y en un Windows
    rem en espanol %ProgramFiles% apunta a "Archivos de programa (x86)" cuando
    rem el .bat corre en 32 bits, donde Docker no esta.
    set "DOCKER_EXE="
    if exist "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" (
        set "DOCKER_EXE=%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
    ) else if exist "%ProgramW6432%\Docker\Docker\Docker Desktop.exe" (
        set "DOCKER_EXE=%ProgramW6432%\Docker\Docker\Docker Desktop.exe"
    ) else if exist "%LOCALAPPDATA%\Docker\Docker Desktop.exe" (
        set "DOCKER_EXE=%LOCALAPPDATA%\Docker\Docker Desktop.exe"
    )
    if defined DOCKER_EXE (
        start "" "!DOCKER_EXE!"
    ) else (
        echo [ERROR] No encuentro "Docker Desktop.exe". Abrelo a mano y repite.
        pause
        exit /b 1
    )

    rem Docker Desktop tarda bastante en levantar el motor. Se espera hasta
    rem 180s preguntandole cada 5s en vez de dormir una cantidad fija: en un
    rem portatil frio tarda mas de un minuto, y en uno caliente diez segundos.
    echo Esperando a que el motor de Docker responda ^(hasta 3 minutos^)...
    set "LISTO="
    for /l %%i in (1,1,36) do (
        if not defined LISTO (
            timeout /t 5 /nobreak >nul
            docker info >nul 2>nul
            if not errorlevel 1 (
                set "LISTO=1"
                echo   Motor de Docker listo.
            )
        )
    )
    if not defined LISTO (
        echo [ERROR] Docker no respondio a tiempo. Comprueba Docker Desktop
        echo         y vuelve a ejecutar este fichero.
        pause
        exit /b 1
    )
)

echo Arrancando Postgres...
docker compose -f "%ROOT%docker-compose.yml" up -d --wait db
if errorlevel 1 (
    echo [ERROR] Fallo al arrancar Postgres.
    pause
    exit /b 1
)

rem ------------------------------------------------------------ backend ---
rem Se comprueba que el puerto se pueda escuchar ANTES de arrancar nada. Si no
rem se puede, el backend fallaria dentro de su propia ventana con un error de
rem permisos poco claro, y aqui todo pareceria haber ido bien.
powershell -NoProfile -Command "try { $l = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, %PUERTO_API%); $l.Start(); $l.Stop(); exit 0 } catch { exit 1 }" >nul 2>nul
if errorlevel 1 (
    echo [ERROR] El puerto %PUERTO_API% no se puede usar en esta maquina.
    echo         Suele ser un rango que Windows se reserva. Mira cuales con:
    echo             netsh interface ipv4 show excludedportrange protocol=tcp
    echo         y elige uno libre:
    echo             set PUERTO_API=8686 ^&^& arrancar.bat
    pause
    exit /b 1
)

echo Sincronizando dependencias del backend...
pushd "%ROOT%apps\api"
call uv sync --extra dev
if errorlevel 1 (
    echo [ERROR] Fallo "uv sync" en apps\api.
    popd
    pause
    exit /b 1
)

echo Aplicando migraciones...
call uv run alembic upgrade head
if errorlevel 1 (
    echo [ERROR] Fallo "alembic upgrade head".
    popd
    pause
    exit /b 1
)
popd

rem ----------------------------------------------------------- frontend ---
echo Sincronizando dependencias del frontend...
if not exist "%ROOT%apps\web\node_modules" (
    pushd "%ROOT%apps\web"
    call npm install
    if errorlevel 1 (
        echo [ERROR] Fallo "npm install" en apps\web.
        popd
        pause
        exit /b 1
    )
    popd
)

rem Las migraciones ya se aplicaron arriba: aqui solo se sirve. Asi, si la
rem base de datos falla, el error sale en esta ventana y no escondido dentro
rem de otra que se cierra sola.
echo Arrancando backend...
start "ECG - Backend" cmd /k "cd /d "%ROOT%apps\api" && uv run uvicorn ecg_api.main:app --reload --port %PUERTO_API%"

rem Las dos VITE_* viajan en el entorno de esta ventana, asi que la heredan.
echo Arrancando frontend...
start "ECG - Frontend" cmd /k "cd /d "%ROOT%apps\web" && npm run dev"

rem El backend tarda unos segundos en atender. Se espera a que responda antes
rem de abrir el navegador: si no, la primera carga sale con "no se pudo cargar
rem el catalogo" y parece que algo esta roto cuando solo iba con retraso.
echo Esperando al backend...
set "API_OK="
for /l %%i in (1,1,20) do (
    if not defined API_OK (
        timeout /t 2 /nobreak >nul
        curl -s -o nul "http://localhost:%PUERTO_API%/api/health" >nul 2>nul
        if not errorlevel 1 set "API_OK=1"
    )
)

echo Abriendo el navegador...
start "" "http://localhost:%PUERTO_WEB%"

echo.
echo ================================================
echo   Backend   -^> http://localhost:%PUERTO_API%
echo   Frontend  -^> http://localhost:%PUERTO_WEB%
echo ================================================
if not defined API_OK (
    echo.
    echo   AVISO: el backend aun no respondia. Mira la ventana
    echo   "ECG - Backend" por si dio algun error.
)
echo.
echo Cierra las ventanas de Backend y Frontend para pararlo todo.
echo ^(Postgres sigue en Docker; para pararlo: parar.bat^)
pause
