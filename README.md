# Simulador de electrocardiograma

Plataforma de simulación clínica de ECG para docencia. No es un dibujador de
ondas: la señal sale de un motor fisiológico determinista que modela latidos,
conducción y artefactos, y el puesto de trabajo reproduce lo que hace un
monitor de cabecera —barrido continuo, cuadrícula milimetrada, medida de
intervalos, ganancia adaptativa—.

> **Uso previsto: docencia.** No es un producto sanitario ni una herramienta
> de apoyo a la decisión clínica. Si el proyecto se acercara a ese terreno, las
> implicaciones legales y regulatorias serían otras.

## Arrancar

```bash
arrancar.bat
```

Levanta Postgres en Docker (abriendo Docker Desktop si hace falta y esperando
al motor), sincroniza dependencias, aplica migraciones, arranca API y frontend
en ventanas separadas y abre el navegador cuando la API responde.

- Frontend — <http://localhost:5600>
- API — <http://localhost:8000>

```bash
parar.bat
```

Detiene el contenedor de Postgres, que es lo único que sigue en segundo plano
al cerrar las ventanas. Los datos se conservan en el volumen de Docker.

### Por qué el puerto 5600 y no el 5173

El puerto por defecto de Vite cae dentro de un rango que Windows reserva para
sí en la máquina de desarrollo (Hyper-V, WSL o Docker lo reclaman al
arrancar). `npm run dev` moría con `EACCES` antes de llegar a escuchar, y no
lo esquiva ningún flag porque el problema es el puerto en sí. Para ver los
rangos excluidos de una máquina:

```bash
netsh interface ipv4 show excludedportrange protocol=tcp
```

### Requisitos

| | |
|---|---|
| Node.js | con `npm` en el PATH |
| Python | ≥ 3.12, gestionado por [uv](https://docs.astral.sh/uv/) |
| Docker Desktop | para Postgres |

`arrancar.bat` comprueba los tres y encuentra `uv` aunque no esté en el PATH
—WinGet lo instala en un directorio que no llega a las sesiones ya abiertas—.

## Arquitectura

Tres capas independientes. El motor no sabe nada de la API, y la API no sabe
nada del navegador.

```
packages/ecg-engine/   Motor fisiológico. Python puro, sin dependencias de red.
packages/ui-system/    Sistema de diseño: tokens, temas y componentes React.
apps/api/              FastAPI: catálogo REST y streaming por WebSocket.
apps/web/              El puesto de simulación. React + Canvas 2D.
docs/superpowers/      Especificaciones y planes de cada entrega.
```

### El motor

Genera la señal de las doce derivaciones a partir de una línea de eventos
cardíacos discretos, no de una plantilla repetida. Cada latido se compone de
sus ondas (P, QRS, T) según una plantilla morfológica, y la conducción decide
qué evento auricular produce cada ventricular — por eso un Wenckebach alarga
el PR latido a latido y un bloqueo completo disocia aurículas y ventrículos
sin ningún `if` especial en el dibujo.

Es **determinista**: con la misma semilla produce la misma señal, bit a bit.
Sobre esa propiedad se apoya una red de *golden signals* en tres niveles
(eventos, medidas y señal) que detecta cualquier cambio no intencionado en la
fisiología.

El ruido y la variabilidad se aplican encima: EMG, interferencia de red,
deriva de línea base, artefacto de movimiento, saturación, arritmia sinusal
respiratoria y jitter del RR.

### Catálogo de ritmos

| Categoría | Ritmos |
|---|---|
| Sinusal | Ritmo sinusal normal, taquicardia, bradicardia |
| Supraventricular | Fibrilación auricular, flutter auricular, TSV |
| Ventricular | Taquicardia ventricular, fibrilación ventricular |
| Bloqueos | AV de primer grado, Mobitz I, bloqueo completo |
| Isquemia | IAM inferior con elevación del ST |

### La API

Una conexión WebSocket por sesión, con dos canales sobre ella:

- **Frames binarios a 10 Hz** — trozos de 100 ms con las doce derivaciones.
  Cabecera de 40 bytes con número de secuencia, para que el cliente detecte
  huecos.
- **Mensajes JSON a 1 Hz** — medidas fisiológicas (FC, RR, PR, QRS, QT y QTc
  por Bazett) medidas sobre los últimos 10 s de señal *realmente generada*, no
  sobre los valores nominales del ritmo. El frontend no calcula ningún
  intervalo: las fórmulas clínicas viven en el motor.

Van por canales separados a propósito: mezclarlas obligaría a versionar el
formato binario cada vez que se añadiera una métrica. El campo `values` de las
medidas es un mapa abierto, para que añadir el eje eléctrico o la frecuencia
auricular no rompa a un cliente anterior.

| Endpoint | |
|---|---|
| `GET /api/health` | Estado del servicio |
| `GET /api/rhythms` | Catálogo |
| `GET /api/rhythms/{id}` | Detalle, con rangos editables |
| `GET /api/sessions` | Sesiones registradas |
| `WS /ws/simulation` | Streaming y control |

Las sesiones de más de 5 s se persisten en Postgres al cerrarse, nunca
durante el streaming.

### El puesto de trabajo

Cinco zonas fijas sobre CSS Grid: cabecera, panel de escenario, área de ECG,
inspector y barra de estado. El área de ECG **nunca hace scroll** — un monitor
clínico no scrollea, y perderlo destruye la sensación de monitorización
continua.

Cada derivación es una tira autónoma con dos canvas superpuestos: la
cuadrícula al fondo y el trazo encima. El trazo se dibuja de forma incremental
en `requestAnimationFrame`, borrando una banda por delante del cursor, que es
el barrido de un monitor de cabecera. Los repintados completos —cambio de
tamaño, de tema, de formato o de escala— nunca entran en ese bucle.

**La cuadrícula es exacta en los dos ejes.** Un milímetro mide lo mismo en
horizontal que en vertical, así que un segundo son cinco cuadros grandes y un
cuadro pequeño son 40 ms: medir contando cuadros, como se hace sobre papel,
da el valor correcto. Cuando la amplitud no cabe en la altura disponible, lo
que se adapta es la **ganancia** (20 / 10 / 5 / 2,5 mm/mV), igual que en un
electrocardiógrafo, y la ganancia efectiva se declara siempre en la barra de
estado. La velocidad del papel no se toca jamás.

#### Formatos de pantalla

| Formato | Derivaciones | Disposición | Por tira |
|---|---|---|---|
| 1 / 3 / 6 / 12 | las que indica | una columna | 10 s |
| 6x2 | 12 | dos columnas de seis | 5 s |

En `6x2` las dos columnas van **sincronizadas**: muestran el mismo instante
con derivaciones distintas, como un monitor, no tramos consecutivos como el
papel impreso. Y no comprime: ancho de columna y segundos por tira se dividen
los dos entre el número de columnas, así que la escala es idéntica en ambos
modos.

#### Herramientas

- **Congelar** el trazado para poder leerlo. Pausa la generación en el
  servidor, así que al reanudar no hay un salto de señal acumulada.
- **Exportar PNG** con la disposición de pantalla, las etiquetas de derivación
  y el sello de fecha y hora dentro de la imagen.
- **Grabar vídeo** de la pantalla completa, controles e inspector incluidos.
- **Temas** de monitor clínico y de papel de ECG.

## Desarrollo

### Tests

```bash
cd packages/ecg-engine && uv run pytest        # motor: 407 tests
cd apps/api && uv run pytest tests/unit        # API: 66 tests
cd apps/api && uv run pytest tests/integration # requiere Postgres arriba
cd apps/web && npx vitest run                  # frontend: 238 tests
cd apps/web && npx tsc -b                      # comprobación de tipos
```

Los tests de integración de la API necesitan el contenedor `db` levantado.

### Ver el motor sin montar nada más

```bash
cd packages/ecg-engine && uv run --extra viz python tools/render_rhythms.py
```

Escribe los doce trazados en formato de papel de ECG en `tools/output/`.

### Sistema de diseño

`packages/ui-system/tokens/tokens.css` es un **artefacto generado**. No se
edita a mano: se cambia `tokens.ts` y se regenera.

```bash
cd apps/web && npm run tokens
```

Un test falla si el CSS commiteado se separa de la fuente tipada.

El renderer nunca consulta el DOM. Recibe un `Theme` resuelto como parámetro,
así que las funciones de dibujo son puras y testeables con un contexto
simulado. No hay un solo literal de color en `apps/web/src/render/`, y un test
centinela lo verifica.

## Estado y hoja de ruta

**Fase 1, implementada de extremo a extremo:** motor determinista con los doce
ritmos, streaming por WebSocket, medidas fisiológicas y el puesto de
simulación clínica.

Lo que viene, por orden de ambición:

- **Fase 2** — evolución temporal de las patologías, respuesta a
  intervenciones, escenarios con decisiones y evaluación automática del
  alumno.
- **Fase 3** — editor visual de escenarios, biblioteca de casos, modo
  instructor e integración con LMS.
- **Fase 4** — validación con cardiólogos y docentes, ajuste fino de la señal
  y pruebas con usuarios reales.

Las especificaciones y los planes de cada entrega están en
`docs/superpowers/`.

## Principios

Los que gobiernan las decisiones de este repositorio, por si ayudan a
entender por qué algo está como está:

- **La lógica clínica no vive en la interfaz.** Las fórmulas, los intervalos y
  las reglas fisiológicas están en el motor, versionadas y con tests.
- **Diseñar por escenarios clínicos, no por pantallas.**
- **Separar realismo clínico de experiencia de usuario.** Que la señal sea
  fiel y que la herramienta sea legible son dos problemas distintos.
- **La degradación es informada, nunca silenciosa.** Si la vista se comprime o
  la ganancia baja, se dice en pantalla.
- **Un hueco declarado es mejor que un número inventado.** Una medida que el
  ritmo no tiene —el PR de un flutter, el QT de una fibrilación ventricular—
  se muestra como no disponible, no como un valor plausible.
