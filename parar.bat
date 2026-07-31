@echo off
setlocal

rem Para el contenedor de Postgres. El backend y el frontend se paran cerrando
rem sus ventanas; esto es lo unico que queda corriendo en segundo plano y se
rem olvida con facilidad.

set "ROOT=%~dp0"

where docker >nul 2>nul
if errorlevel 1 (
    echo No se encuentra "docker" en el PATH. Nada que parar.
    pause
    exit /b 0
)

echo Parando Postgres...
docker compose -f "%ROOT%docker-compose.yml" stop db

echo.
echo Listo. Los datos siguen guardados en el volumen de Docker:
echo la proxima vez que ejecutes arrancar.bat estaran ahi.
pause
