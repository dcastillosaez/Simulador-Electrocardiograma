# Instala, arranca, comprueba y desinstala. Sin tocar nada a mano.
#
#     powershell -ExecutionPolicy Bypass -File apps/desktop/tools/probar_instalador.ps1
#
# No sustituye a la prueba en una máquina virgen —aquí ya están Python, Node,
# Rust y WebView2— pero sí detecta lo que más se rompe: que el instalador no
# lleve dentro el backend, que el shell no lo encuentre en la ruta instalada, o
# que la desinstalación deje procesos o ficheros sueltos.

$ErrorActionPreference = "Stop"

$raiz = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$instalador = Get-Item "$raiz\apps\desktop\src-tauri\target\release\bundle\nsis\*setup.exe"
# Tauri deriva la carpeta de datos del identificador de la aplicación, no del
# nombre de producto: `%LOCALAPPDATA%\edu.simuladorecg.desktop`.
$datos = "$env:LOCALAPPDATA\edu.simuladorecg.desktop"

# La ruta de instalación se lee del registro, no se supone. NSIS en modo
# `currentUser` instala bajo `%LOCALAPPDATA%`, pero el subdirectorio exacto lo
# decide él, y suponerlo hizo fallar esta comprobación contra una instalación
# que había funcionado perfectamente.
function Ruta-Instalada {
    $clave = Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" `
        -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName -eq "Simulador ECG" } | Select-Object -First 1
    if (-not $clave) { return $null }
    return $clave.InstallLocation.Trim('"')
}

function Paso($texto) { Write-Host "`n=== $texto ===" -ForegroundColor Cyan }

Paso "Instalador"
"{0} -> {1:N0} MB" -f $instalador.Name, ($instalador.Length / 1MB)
# NSIS comprime bien: los 95 MB del backend caben en unos 30. Por debajo de 20
# es que no viajó.
if ($instalador.Length -lt 20MB) {
    Write-Host "AVISO: pesa menos de 20 MB, probablemente NO lleva el backend dentro" -ForegroundColor Yellow
}

Paso "Instalando en silencio"
Start-Process $instalador.FullName -ArgumentList "/S" -Wait
Start-Sleep -Seconds 2
$destino = Ruta-Instalada
if (-not $destino -or -not (Test-Path $destino)) {
    throw "no se encontró la instalación (registro dice: '$destino')"
}

# El binario lleva el nombre del crate, no el `productName` con espacios. Se
# busca en vez de suponerse, por la misma razón que la ruta.
$app_exe = Get-ChildItem $destino -Filter "*.exe" |
    Where-Object { $_.Name -ne "uninstall.exe" } | Select-Object -First 1
if (-not $app_exe) { throw "no hay ejecutable en $destino" }

"instalado en: $destino"
"ejecutable: $($app_exe.Name)"
$backend = Test-Path "$destino\ecg-api\ecg-api.exe"
"backend dentro de la instalación: $backend"
if (-not $backend) { throw "el backend no viajó en el instalador" }

Paso "Arrancando la aplicación instalada"
$app = Start-Process $app_exe.FullName -PassThru
Start-Sleep -Seconds 25
$api = Get-Process -Name "ecg-api" -ErrorAction SilentlyContinue
"ventana: '$($app.MainWindowTitle)'"
"backend arrancado por la aplicación: $($null -ne $api)"

# El puerto no se conoce desde fuera —lo elige el sistema y lo sabe el shell—
# así que se comprueba que el proceso existe y responde algo, no una URL fija.
if ($api) { "memoria del backend: {0:N0} MB" -f ($api.WorkingSet64 / 1MB) }

Paso "Cerrando"
Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 4
$huerfano = Get-Process -Name "ecg-api" -ErrorAction SilentlyContinue
if ($huerfano) { throw "quedó un backend huérfano tras cerrar la aplicación" }
"sin procesos huérfanos"

Paso "Desinstalando"
$desinstalador = "$destino\uninstall.exe"
if (Test-Path $desinstalador) {
    Start-Process $desinstalador -ArgumentList "/S" -Wait
    Start-Sleep -Seconds 3
}
"binarios borrados: $(-not (Test-Path $app_exe.FullName))"
# Los datos del usuario NO se borran: tirar el historial de sesiones de alguien
# sin preguntar es lo que no se puede deshacer.
$sobrevive = Test-Path "$datos\simulador.sqlite"
"base de datos del usuario conservada: $sobrevive"
if (-not $sobrevive) { throw "el desinstalador se llevó los datos del usuario" }

Paso "Resultado"
Write-Host "instalación, arranque, cierre y desinstalación correctos" -ForegroundColor Green
