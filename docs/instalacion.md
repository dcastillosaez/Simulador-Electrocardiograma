# Instalación del Simulador de ECG en Windows

Este documento es para dos personas: quien va a instalar el programa en su
equipo y quiere saber qué está metiendo dentro, y quien tiene que aprobarlo en
un departamento de informática antes de que se instale en ninguna parte.

**Aviso de uso.** El Simulador de ECG es una herramienta docente. No está
destinado al diagnóstico ni al tratamiento de pacientes, y no es un dispositivo
médico.

## Requisitos

- Windows 10 (versión 1803 o posterior) o Windows 11, de 64 bits.
- Unos 250 MB de disco.
- Permisos de usuario normal. **No hace falta ser administrador**: el
  instalador escribe solo en el perfil de quien lo ejecuta.

No hace falta instalar Python, Node ni ninguna base de datos: el instalador los
lleva dentro.

## Qué se descarga

Cada versión publicada en
[Releases](https://github.com/dcastillosaez/Simulador-Electrocardiograma/releases)
incluye dos ficheros:

| Fichero | Qué es |
|---|---|
| `Simulador ECG_<versión>_x64-setup.exe` | El instalador |
| `SHA256SUMS.txt` | La huella SHA-256 del instalador |

## Cómo comprobar que el instalador es el que se publicó

Descargar un ejecutable de Internet y ejecutarlo sin comprobar nada es un acto
de fe. Hay dos comprobaciones, y son independientes: la primera dice que el
fichero ha llegado entero, la segunda dice de dónde salió.

### 1. La huella

En PowerShell, en la carpeta donde esté el fichero descargado:

```powershell
Get-FileHash ".\Simulador ECG_0.1.0_x64-setup.exe" -Algorithm SHA256
```

El resultado tiene que coincidir, carácter a carácter, con el que aparece en el
cuerpo de la release y en `SHA256SUMS.txt`. Si no coincide, el fichero está
corrupto o no es el que se publicó: bórralo y vuelve a descargarlo.

### 2. La procedencia

La huella dice que el fichero no ha cambiado, pero no dice quién lo hizo. Eso lo
dice la *attestation* de procedencia: una firma criptográfica, generada por
GitHub durante la compilación y registrada en un log público de transparencia,
que ata el binario al repositorio, al commit y al workflow concretos de los que
salió.

Con la [CLI de GitHub](https://cli.github.com/) instalada:

```powershell
gh attestation verify ".\Simulador ECG_0.1.0_x64-setup.exe" --repo dcastillosaez/Simulador-Electrocardiograma
```

Una salida con `✓ Verification succeeded` significa que ese fichero exacto se
compiló en este repositorio, con el código de ese commit, y no lo ha construido
nadie por su cuenta. Nadie —ni quien mantiene el proyecto— puede fabricar esa
firma fuera del workflow: la clave es un token efímero del propio GitHub y no
existe en ningún sitio donde alguien pueda copiarla.

## Sobre el aviso de Windows al abrirlo

Al ejecutar el instalador, Windows puede mostrar una pantalla azul de
**SmartScreen** («Windows protegió su PC») y, en el control de cuentas de
usuario, **«Editor: desconocido»**.

Eso no significa que el fichero esté dañado ni que Windows haya detectado nada
en él. Significa una cosa muy concreta: el instalador **no está firmado con un
certificado de firma de código emitido por una autoridad reconocida**. Ese
certificado se compra —entre 200 y 800 € al año, según el tipo— y de momento
este proyecto no lo tiene. Las compilaciones se firman con un certificado de
prueba autofirmado, que sirve para verificar que el mecanismo de firma funciona
y no sirve para que Windows confíe en nada.

Mientras eso siga así, la comprobación real es la de la sección anterior: la
huella y la procedencia. Son verificaciones más fuertes que el aviso de
SmartScreen, no más débiles —SmartScreen mide reputación comercial, la
attestation demuestra origen—, pero Windows no las mira.

Si aun así hace falta instalarlo, en esa pantalla: *Más información* →
*Ejecutar de todas formas*.

### Para departamentos de informática

En un despliegue institucional hay una salida limpia y es la habitual para
software interno: extraer el certificado con el que está firmado el instalador
e implantarlo por directiva de grupo (GPO) en el almacén de **Editores de
confianza** de los equipos del centro. A partir de ahí el instalador queda
firmado y sin aviso en esas máquinas, y solo en esas máquinas.

## Qué hace el instalador en la máquina

Todo ocurre dentro del perfil del usuario. No toca el registro fuera de `HKCU`,
no instala servicios, no crea tareas programadas y no modifica nada del sistema.

| Qué | Dónde |
|---|---|
| Programa | `%LOCALAPPDATA%\Simulador ECG\` |
| Datos de la aplicación | `%LOCALAPPDATA%\edu.simuladorecg.desktop\` |
| Base de datos (SQLite) | `%LOCALAPPDATA%\edu.simuladorecg.desktop\simulador.sqlite` |
| Accesos directos | Menú Inicio y, opcionalmente, escritorio |
| Desinstalación | `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\` |

Si el equipo no tiene **WebView2** —el motor de navegador de Microsoft que ya
viene con Windows 11 y con Windows 10 actualizado—, el instalador lo descarga e
instala en ese momento. Es la única descarga que hace, y viene de Microsoft.

## Qué hace el programa cuando se ejecuta

La aplicación arranca un proceso hijo, `ecg-api.exe`, que es el motor de
simulación. Ese proceso:

- Escucha **solo en `127.0.0.1`**, la interfaz de loopback. No es accesible
  desde la red: ni desde otro equipo, ni desde otra máquina de la misma red
  local.
- Usa un **puerto que elige el sistema operativo** en cada arranque, no uno
  fijo. No hay que abrir nada en el cortafuegos.
- Exige un **token** generado en cada ejecución para aceptar conexiones, de
  forma que otro programa del mismo equipo no pueda hablar con él por casualidad.
- Muere con la aplicación. Se usa un *job object* de Windows para garantizarlo
  incluso si el proceso padre termina de forma anormal, así que cerrar la
  ventana no deja procesos huérfanos.

**No hay conexiones salientes.** Esta versión no consulta servidores de
actualización, no envía telemetría y no llama a ningún servicio externo: el
programa funciona con el cable de red desenchufado. En `tauri.conf.json` hay una
sección de actualizaciones preparada, pero el plugin correspondiente no está
compilado en este binario y no se ejecuta ningún código de red.

Los datos —sesiones, pacientes personalizados, administraciones de fármacos—
se quedan en el fichero SQLite del perfil del usuario. No salen del equipo.

## Desinstalación

Configuración → Aplicaciones → *Simulador ECG* → Desinstalar. O el
`uninstall.exe` de la carpeta de instalación.

La desinstalación borra el programa. **La carpeta de datos se queda**, para no
llevarse por delante las sesiones guardadas de quien reinstala. Si quieres
borrarlo todo, elimina a mano `%LOCALAPPDATA%\edu.simuladorecg.desktop\`.

## Si algo va mal

La aplicación abre la ventana pero se queda en blanco o dice que no puede
arrancar el motor: casi siempre es un antivirus que ha puesto en cuarentena
`ecg-api.exe`. Es un ejecutable de Python empaquetado con PyInstaller, un patrón
que algunos motores heurísticos marcan sin más motivo que el empaquetado.
Comprobar la cuarentena del antivirus y, si procede, añadir una excepción para
`%LOCALAPPDATA%\Simulador ECG\`.
