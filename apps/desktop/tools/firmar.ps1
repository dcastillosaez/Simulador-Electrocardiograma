# Firma un binario. Lo invoca Tauri para cada ejecutable del bundle y para el
# instalador, a través de `bundle.windows.signCommand`.
#
#     .\firmar.ps1 -Ruta "C:\...\algo.exe"
#
# De dónde sale el certificado, por orden de preferencia:
#
#   1. `ECG_SIGN_THUMBPRINT`  -> huella de un certificado del almacén de
#                                Windows. Es lo que se usa en producción: la
#                                clave privada nunca sale del almacén (o del
#                                HSM que lo respalda) y aquí solo viaja su
#                                huella, que no es un secreto.
#   2. `ECG_SIGN_SELFSIGNED`  -> genera y usa un certificado de PRUEBA. Sirve
#                                para verificar que el mecanismo funciona; no
#                                sirve para distribuir nada.
#   3. sin ninguna            -> no firma, y lo dice. Un build de desarrollo no
#                                tiene por qué fallar por no tener certificado.
#
# Lo que NO hace, a propósito: leer un `.pfx` del repositorio ni una contraseña
# de una variable. La clave privada no entra en el árbol de fuentes ni en el
# entorno de un workflow como fichero.

param(
    [Parameter(Mandatory = $true)][string]$Ruta
)

$ErrorActionPreference = "Stop"

# El sello de tiempo NO es opcional. Sin él, la firma deja de validar cuando el
# certificado caduca, y una versión antigua perfectamente buena se convierte de
# la noche a la mañana en una alerta de seguridad para quien la tenga instalada.
$SELLO = "http://timestamp.digicert.com"

function Buscar-Signtool {
    $candidatos = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin" `
        -Recurse -Filter "signtool.exe" -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match "x64" } |
        Sort-Object FullName -Descending
    if ($candidatos) { return $candidatos[0].FullName }
    $enPath = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if ($enPath) { return $enPath.Source }
    return $null
}

function Certificado-De-Prueba {
    # Reutiliza el de una ejecución anterior si sigue vivo: generar uno nuevo en
    # cada firma llenaría el almacén de certificados basura.
    $sujeto = "CN=Simulador ECG (PRUEBA - NO DISTRIBUIR)"
    $existente = Get-ChildItem Cert:\CurrentUser\My |
        Where-Object { $_.Subject -eq $sujeto -and $_.NotAfter -gt (Get-Date) } |
        Select-Object -First 1
    if ($existente) { return $existente.Thumbprint }

    $nuevo = New-SelfSignedCertificate -Type CodeSigningCert -Subject $sujeto `
        -CertStoreLocation Cert:\CurrentUser\My -NotAfter (Get-Date).AddYears(1)
    return $nuevo.Thumbprint
}

$signtool = Buscar-Signtool
if (-not $signtool) {
    Write-Host "signtool.exe no encontrado: se omite la firma de $Ruta" -ForegroundColor Yellow
    exit 0
}

$huella = $env:ECG_SIGN_THUMBPRINT
if (-not $huella -and $env:ECG_SIGN_SELFSIGNED -eq "1") {
    $huella = Certificado-De-Prueba
    Write-Host "FIRMA DE PRUEBA (certificado autofirmado): $Ruta" -ForegroundColor Yellow
}

if (-not $huella) {
    Write-Host "sin certificado configurado: se omite la firma de $Ruta" -ForegroundColor DarkGray
    exit 0
}

& $signtool sign /sha1 $huella /fd SHA256 /tr $SELLO /td SHA256 /q $Ruta
if ($LASTEXITCODE -ne 0) {
    throw "signtool falló con código $LASTEXITCODE sobre $Ruta"
}
Write-Host "firmado: $(Split-Path -Leaf $Ruta)" -ForegroundColor Green
