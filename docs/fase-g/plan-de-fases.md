# Fase G — Plan detallado de las ocho sub-fases

Complemento de [arquitectura.md](arquitectura.md), que fija el **qué** y el
**por qué**. Esto es el **cómo y en qué orden**: para cada sub-fase, qué entra,
qué no, qué hay que tocar, qué se entrega y cuándo se puede dar por cerrada.

Los criterios de aceptación están escritos para poder comprobarse. «Funciona»
no es un criterio; «se abre y se cierra cien veces sin dejar procesos
huérfanos» sí.

## Panorama

| Fase | Objetivo en una frase | Depende de | Tamaño |
|---|---|---|---|
| G1 | Una ventana nativa con la interfaz dentro | — | Pequeña |
| G2 | Esa ventana arranca y para el backend | G1 | **Grande** |
| G3 | Persistencia local, y que su ausencia no sea fatal | G2 | Media |
| G4 | Un `.exe` que instala y desinstala limpio | G2, G3 | Media |
| G5 | Ese `.exe` está firmado | G4 | Pequeña, con espera |
| G6 | La aplicación se actualiza sola y sabe volver atrás | G4, G5 | Media |
| G7 | Licencia firmada, con la aplicación funcionando sin Internet | G2 | Media |
| G8 | Un tag de git produce el instalador sin tocar nada | G4, G5 | Media |

El camino crítico es **G1 → G2 → G4 → G5 → G8**. G3 y G7 pueden ir en paralelo
a G4 si hay más de una persona; G6 no tiene sentido antes de G5, porque
actualizar sin verificar firma es peor que no actualizar.

---

## G1 — Desktop Shell

**Objetivo.** Que exista `Simulador ECG.exe`, abra una ventana nativa y muestre
dentro la interfaz que hoy se ve en el navegador.

### Entra

- Proyecto Tauri en `apps/desktop/`, con `frontendDist` apuntando al `dist` que
  produce `vite build` y `beforeBuildCommand` encadenando esa compilación.
- Ventana: título, icono, tamaño inicial y **tamaño mínimo**. Este último no es
  cosmético: `AppShell.module.css` reordena el layout por debajo de 1100 px, así
  que la ventana no debe poder encogerse hasta un tamaño donde el ECG quede
  inservible. Mínimo 1280×800.
- Splash mientras carga, con texto de lo que está ocurriendo.
- **`RuntimeMode`**: la interfaz detecta si corre en navegador o en Tauri, por
  la presencia del puente de Tauri y no por una variable de compilación.
- Refactor de [App.tsx](../../apps/web/src/App.tsx): hoy resuelve la URL del
  backend de forma síncrona al importar el módulo. En escritorio la URL no se
  conoce hasta que el backend arranca, así que tiene que resolverse de forma
  asíncrona y mostrar el splash mientras tanto.

### No entra

Python, base de datos, instalador. En G1 la ventana abre y, al no haber
backend, muestra el mismo error de conexión que hoy muestra el navegador.

### Tareas

1. Instalar el toolchain: Rust estable + MSVC Build Tools. **Verificar antes de
   empezar** — son 2–3 GB de descarga.
2. `apps/desktop/` con `tauri.conf.json`, `src-tauri/`, iconos en los tamaños
   que pide Windows.
3. Comando `get_backend_url` en Rust. En G1 devuelve la URL de desarrollo fija;
   en G2 devolverá la real.
4. `runtime-mode.ts` en el frontend, con su test.
5. `App.tsx` asíncrono + estado de carga.

### Entregable

`cargo tauri dev` abre la ventana con la interfaz. `cargo tauri build` produce
un ejecutable que hace lo mismo.

### Criterio de aceptación

La ventana abre, muestra la interfaz completa, y sin backend enseña un error
legible en vez de una pantalla en blanco. Los 395 tests del frontend siguen
verdes y `npm run dev` sigue funcionando en navegador exactamente igual.

### Riesgos

- **WebView2 en Windows 10.** Viene de serie en 11, puede faltar en 10. Se
  resuelve en G4 (bootstrapper en el instalador), pero conviene probarlo ya en
  una máquina Windows 10 limpia.
- El `RuntimeMode` es la primera bifurcación navegador/escritorio del proyecto.
  Si se hace mal, se duplica lógica; debe quedarse en **quién da la URL** y nada
  más.

---

## G2 — Runtime Python

**Objetivo.** Que la ventana arranque el backend al abrirse y lo mate al
cerrarse, sin que el usuario vea nunca una consola.

Es la sub-fase más grande y la que más puede torcerse.

### Entra

- Empaquetado de `apps/api` con PyInstaller en modo **onedir**, no onefile:
  onefile descomprime todo en un temporal en cada arranque, y eso son segundos
  de espera y un antivirus mirando.
- Los dos motores (`ecg-engine`, `pharmacology-engine`) dentro del paquete.
  Ojo con `numpy` y con los datos YAML del catálogo farmacológico: los ficheros
  de datos no son código y PyInstaller no los incluye solo.
- Lanzamiento como **sidecar** de Tauri: puerto efímero, arranque, espera activa
  de `/api/health` con timeout, y la URL entregada a la interfaz por
  `get_backend_url`.
- **Job object de Windows** para los procesos hijo, de forma que mueran con el
  padre aunque el padre muera de forma anormal. El handler de cierre no basta:
  un `taskkill` sobre Tauri se lo salta.
- Apagado ordenado, con plazo por paso y muerte por las bravas al vencerlo.
- **Ajustes de seguridad del modo escritorio**, ya decididos en la arquitectura:
  el origen de Tauri añadido a `CORS_ORIGINS`, aforo bajado a 2–3 conexiones,
  `TRUST_PROXY=false`, escucha solo en `127.0.0.1`, y token de arranque generado
  por el shell que el backend exige.

### No entra

Base de datos. En G2 el backend arranca **sin persistencia** — lo cual obliga a
tener antes el modo degradado… o a aceptar que G2 no arranca hasta G3. Se
resuelve al revés: el modo degradado se adelanta aquí, porque es la única forma
de probar G2 de forma aislada. Es la razón de que el plan diga «G2 antes que
G3».

### Tareas

1. `.spec` de PyInstaller, con hooks para numpy y los datos del catálogo.
2. Script de build que produzca `ecg-api/` listo para empaquetar como recurso.
3. Selección de puerto efímero y arranque del sidecar desde Rust.
4. Health check con timeout y mensajes distintos para «no arrancó» y «no
   respondió a tiempo».
5. Job object + apagado ordenado.
6. Token de arranque: generación, paso al backend por variable de entorno, y
   verificación en el middleware y en el handshake del WebSocket.
7. Modo sin persistencia en `main.py` (ver G3, tarea adelantada).

### Entregable

Doble clic → ventana → ECG funcionando. Cerrar la ventana → ningún proceso
Python vivo.

### Criterio de aceptación

**Cien ciclos de abrir y cerrar sin un solo proceso huérfano**, comprobado con
el gestor de tareas o un script. Y matar Tauri desde el gestor de tareas
tampoco deja Python vivo.

### Riesgos

- **Falsos positivos de antivirus**: los binarios de PyInstaller son un clásico.
  La firma de G5 ayuda; conviene probar antes de distribuir.
- **Tamaño**: Python + numpy rondan los 100–150 MB.
- **Arranque lento**: hay que medirlo desde el primer día. Si pasa de 5
  segundos, el splash tiene que contar qué está haciendo.

---

## G3 — Base de datos

**Objetivo.** Persistencia local en escritorio, y que su ausencia no impida usar
el simulador.

Esta fase está revisada en detalle y con mediciones en
[g3-base-de-datos.md](g3-base-de-datos.md). La decisión: **SQLite en escritorio,
PostgreSQL en servidor**. Resumen de tareas:

1. **Esquema portable**: `sa.JSON().with_variant(JSONB, "postgresql")` en las
   dos columnas JSON y `sa.Uuid` en las cuatro de identificador. El DDL de
   PostgreSQL no cambia.
2. **`seed.py`**: elegir el `insert` según el dialecto activo.
3. **Migraciones**: reescribir las dos revisiones con los tipos portables, y
   construir el `Config` de Alembic programáticamente con `script_location`
   absoluto — hoy usa rutas relativas al directorio de trabajo, que en un `.exe`
   es donde el usuario hizo doble clic.
4. **`PRAGMA foreign_keys=ON`** en el evento `connect` del engine de SQLite,
   **con un test que lo verifique**. Sin él, SQLite no aplica las claves
   foráneas y errores como el de las administraciones huérfanas pasan
   inadvertidos.
5. **Modo degradado**: que `seed_catalog` fallando no impida arrancar, y que los
   endpoints de sesiones respondan un error claro.
6. **CI contra los dos motores**: condición de la decisión, no una mejora.
7. Copia de seguridad: con SQLite es copiar un fichero. Un botón que lo haga.

### Criterio de aceptación

**El simulador arranca, simula, mide y administra fármacos con la base de datos
borrada, y lo dice.** Y la suite de integración pasa contra PostgreSQL y contra
SQLite.

---

## G4 — Instalador

**Objetivo.** Un `.exe` que instala, crea accesos directos y desinstala sin
dejar rastro salvo los datos del usuario.

### Entra

- NSIS generado por Tauri: `SimuladorECG-Setup-X.Y.Z.exe`.
- **WebView2**: incluir el bootstrapper o descargarlo. Decisión de tamaño contra
  conectividad; para un aula sin Internet, incluirlo.
- Accesos directos en escritorio y menú de inicio, ambos opcionales.
- Desinstalador que borra `Program Files` y **pregunta** por
  `%LOCALAPPDATA%\SimuladorECG`. Los datos del usuario no se tiran sin permiso.
- Separación estricta binarios / datos, según §4 de la arquitectura.
- Reparación de instalación: reinstalar encima no debe perder datos ni duplicar
  accesos directos.

### Criterio de aceptación

En una máquina virtual **limpia** (sin Python, sin Node, sin Docker, sin
WebView2): instalar, usar, desinstalar, y comprobar que no queda ni un servicio,
ni una entrada de registro suelta, ni un proceso. Y que reinstalar sobre una
instalación existente conserva el historial.

### Riesgos

Probar solo en la máquina de desarrollo es engañarse: ahí ya está todo
instalado. La VM limpia no es opcional.

---

## G5 — Firma

**Objetivo.** Que Windows no diga «editor desconocido».

### Entra

- Certificado de firma de código. Decisión previa: OV o EV, y proveedor.
- Firma de **los binarios** que se distribuyen y **del instalador**. Son dos
  cosas, ambas necesarias.
- **Timestamping siempre.** Sin él, la firma deja de validar cuando el
  certificado caduca, y una versión antigua perfectamente buena se convierte en
  una alerta de seguridad.
- Firma en la pipeline, hablando con un servicio de firma o un HSM. **La clave
  privada no entra en el repositorio, ni como fichero en un secreto del
  workflow.**

### Criterio de aceptación

Descargar el instalador desde otra máquina y que las propiedades del fichero
muestren el firmante correcto y una marca de tiempo válida.

### Expectativas realistas

Un certificado nuevo, **incluido EV, no elimina automáticamente los avisos de
SmartScreen**. La reputación se construye con descargas a lo largo del tiempo.
Los primeros usuarios verán el aviso: conviene tener escrito qué contarles.

### Nota de planificación

La emisión del certificado tarda días o semanas según el proveedor y la
validación de identidad. **Iniciar el trámite en G1**, no en G5.

---

## G6 — Actualizaciones

**Objetivo.** Que la aplicación se actualice sola, verificando lo que instala, y
sepa volver atrás.

### Entra

- Servidor de versiones con manifiesto firmado.
- Comprobación **solo al arrancar**, nunca durante el uso: nadie quiere una
  actualización a mitad de clase.
- Descarga → **verificación de firma** → instalación → reinicio. La verificación
  no es opcional: un updater que ejecuta lo que le llega es un mecanismo de
  instalación remota de malware con nuestro nombre.
- **Rollback**: si la versión nueva no arranca dos veces seguidas, volver a la
  anterior. Obliga a conservar la instalación previa y a que las migraciones
  sean compatibles hacia atrás dentro de una serie, o a copiar la base antes de
  migrar.
- Sin Internet, la aplicación arranca igual y lo registra en el log.

### Criterio de aceptación

Publicar a propósito una versión que no arranca y comprobar que el equipo vuelve
solo a la anterior con los datos intactos.

### Nota

La infraestructura se prepara desde G1 aunque no se use hasta aquí: **la primera
versión distribuida sin updater no sabrá actualizarse nunca**.

---

## G7 — Licencia

**Objetivo.** Frenar la copia casual sin que el simulador dependa de Internet.

### Entra

- `license.dat` firmado criptográficamente: producto, edición, cliente,
  caducidad y lista de funcionalidades.
- **Verificación en el lado Rust, no en Python.** Un `.pyc` se sustituye con un
  editor de texto; el binario de Tauri es bastante más caro de parchear.
  Ninguna de las dos es inviolable, y ese no es el objetivo.
- Activación en línea opcional, con **periodo de gracia generoso** para trabajar
  sin conexión.
- Banderas de funcionalidad, preparadas para ediciones distintas.
- Comportamiento sin licencia: definido y honesto (por ejemplo, modo de
  evaluación limitado en tiempo), nunca un fallo confuso.

### Criterio de aceptación

Sin licencia se degrada exactamente como está especificado; con licencia y sin
Internet, funciona sin límite dentro del periodo de gracia; una licencia editada
a mano se rechaza.

### Alcance, dicho claro

Esto detiene pasarse el `.exe` entre compañeros. Un programa que se ejecuta en
la máquina del usuario se puede copiar: lo que se sube es el coste, no se baja a
cero.

---

## G8 — Release engineering

**Objetivo.** Que publicar una versión sea poner un tag.

```
git tag v1.0.0 → CI → tests → build → paquete → firma → smoke test → release
```

### Entra

- Workflow que dispara con el tag.
- Los **557 tests actuales** (162 de API + 395 de web) como puerta: si fallan, no
  hay release.
- Build de frontend, backend empaquetado y bundle de Tauri.
- Firma (G5) como paso de la pipeline.
- **Smoke test del instalador**: instalar en un runner limpio, arrancar,
  comprobar `/api/health`, cerrar. Un instalador que no se ha ejecutado nunca no
  es un release.
- Publicación del artefacto y del manifiesto de actualización (G6).
- Versionado único: la versión vive en un sitio y la leen `tauri.conf.json`, el
  backend y la interfaz.

### Criterio de aceptación

Un tag produce un instalador firmado, probado y publicado **sin intervención
manual**.

---

## Estimación

Rangos, no promesas. La incertidumbre está concentrada en G2 y en el trámite del
certificado.

| Fase | Estimación | Dónde está la incertidumbre |
|---|---|---|
| G1 | 2–4 días | Toolchain de Rust y primer contacto con Tauri |
| G2 | 1–3 semanas | PyInstaller con numpy, procesos huérfanos, antivirus |
| G3 | 3–5 días | Ya medida y acotada |
| G4 | 1 semana | WebView2, pruebas en VM limpia |
| G5 | 2 días + espera | La emisión del certificado no depende de nosotros |
| G6 | 1–2 semanas | El rollback es lo que cuesta, no la descarga |
| G7 | 1 semana | Decidir el modelo comercial, más que programarlo |
| G8 | 1 semana | Runners de Windows y smoke test |

## Reglas que atraviesan todas las fases

1. **`arrancar.bat` tiene que seguir funcionando.** Empaquetar no puede congelar
   el desarrollo. Docker no desaparece del repositorio: desaparece de la máquina
   del usuario final.
2. **El motor no se toca.** Si una sub-fase obliga a modificar `ecg-engine` o
   `pharmacology-engine`, es señal de que se ha diseñado mal.
3. **Cada fase deja el repositorio verde.** Nada de ramas largas que rompen los
   tests «hasta que termine G2».
4. **El aviso de uso docente entra en la aplicación**, no solo en el
   repositorio: instalador, «Acerca de» y exportación PNG. Distribuir esto a
   hospitales cambia el contexto lo suficiente.
5. **Lo que no se ha ejecutado, no funciona.** Ningún criterio de aceptación de
   este plan se cumple leyendo código.
