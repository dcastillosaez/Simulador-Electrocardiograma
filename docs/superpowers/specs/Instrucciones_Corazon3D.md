FASE_D_CARDIAC_VISUALIZATION.md
Fase D — Motor de Visualización Cardíaca 3D
Objetivo

Incorporar una representación tridimensional anatómica y mecánicamente coherente del corazón sincronizada en tiempo real con el motor electrofisiológico (ecg-engine).

El corazón 3D no sustituye al ECG.

Ambos representan simultáneamente el mismo estado fisiológico.

Paciente Virtual
        │
        ▼
Electrophysiology Engine
        │
        ├────────► ECG Renderer
        │
        └────────► Cardiac Visualization Engine

Toda la información debe provenir del mismo estado de simulación.

Nunca debe analizarse el ECG para mover el corazón.

Objetivos

El corazón deberá mostrar:

Contracción auricular.
Contracción ventricular.
Relajación.
Sincronía AV.
Alteraciones mecánicas producidas por distintos ritmos.
Cambios en tiempo real al modificar parámetros.
Animación continua a 60 FPS.

No es un modelo CFD ni un simulador biomecánico.

Es un modelo visual sincronizado con la electrofisiología.

Tecnologías
Renderizado

React Three Fiber (R3F)

sobre

Three.js

No utilizar BabylonJS.

No utilizar motores de videojuegos.

Todo el proyecto continúa siendo React.

Modelo anatómico

El modelo debe contener como mínimo:

Aurícula derecha
Aurícula izquierda
Ventrículo derecho
Ventrículo izquierdo
Septo interventricular
Grandes vasos principales

Formato:

glTF 2.0 (.glb)

Razones:

estándar
compresión
animaciones
materiales PBR
compatible con Blender
Pipeline gráfico
GLB

↓

Loader

↓

Scene Graph

↓

Animation Controller

↓

Frame Synchronizer

↓

Renderer
Organización
apps/web/

src/

components/

Cardiac3D/

    HeartScene.tsx

    HeartModel.tsx

    HeartAnimator.ts

    HeartEvents.ts

    HeartMaterials.ts

    HeartCamera.ts

    HeartLighting.ts

    HeartHUD.tsx
Arquitectura

El módulo será completamente independiente del ECG.

Simulation Runtime

        │

        ▼

Cardiac State

        │

        ▼

Heart Animator

        │

        ▼

Three Renderer

Nunca acceder directamente al buffer del ECG.

Sincronización

El motor publicará eventos discretos.

Ejemplo:

P_START

P_END

QRS_START

QRS_END

T_END

Además publicará:

RR interval

Heart Rate

Rhythm Type

Conduction State

El animador únicamente interpola.

Nunca calcula conducción.

Animación

Cada cavidad tendrá un ciclo:

Reposo

↓

Contracción

↓

Eyección

↓

Relajación

↓

Reposo

La amplitud dependerá del estado mecánico.

Ritmos

Sinusal

Contracción completamente sincronizada.

Flutter

Aurículas vibrando rápidamente.

Conducción parcial al ventrículo.

Fibrilación Auricular

Aurículas desorganizadas.

Contracción auricular prácticamente ausente.

RR irregular.

TV

Solo contracción ventricular rápida.

FV

Contracción caótica.

No existe sincronía.

Bloqueo AV completo

Aurículas y ventrículos completamente independientes.

Calidad visual

Objetivo:

60 FPS.

Materiales:

PBR.

No utilizar materiales tipo "plastic".

Iluminación

HDRI suave.

Ambient Occlusion.

Sombras suaves.

Postprocesado

Muy ligero.

Bloom extremadamente sutil.

FXAA.

Nada cinematográfico.

Debe parecer una herramienta médica.

Cámara

Por defecto:

Vista isométrica.

Permitir:

Rotación

Zoom

Pan

Doble clic para centrar.

Nunca rotación automática.

Interacción

Hover:

Resaltar cavidad.

Click:

Seleccionar estructura.

Panel derecho:

Información anatómica.

Materiales

Aurículas

Rojo oscuro.

Ventrículos

Rojo brillante.

Septo

Rojo ligeramente más claro.

Estado eléctrico

Overlay azul.

Contracción

Incremento leve del brillo.

Nunca colores artificiales.

Sincronización temporal

El corazón debe usar exactamente el mismo reloj que el ECG.

No usar:

Date.now()

Usar:

simulation_time

publicado por el runtime.

Rendimiento

Objetivos:

60 FPS.

Menos de 3 millones de triángulos.

Menos de 250 MB GPU.

Carga inferior a 2 segundos.

Futuras extensiones

Esta arquitectura deberá permitir añadir posteriormente:

Fármacos.
Hemodinámica.
Flujo sanguíneo simplificado.
Presión arterial.
Saturación.
Marcapasos.
Cardioversión.
Desfibrilación.
Isquemia regional.
Infarto.
Pericarditis.
Hipertrofia.

Sin modificar el renderer.

Principios de arquitectura

El modelo 3D nunca debe contener lógica fisiológica.

Toda la fisiología pertenece exclusivamente al motor de simulación.

El módulo 3D es únicamente un consumidor del estado fisiológico.

La representación visual debe ser completamente desacoplada del motor electrofisiológico.

Una mejora que añadiría al diseño

Yo iría un paso más allá y no modelaría únicamente el corazón, sino un sistema de capas anatómicas desde el principio. Es decir, el HeartScene no contendría solo el modelo cardíaco, sino una escena preparada para incorporar progresivamente nuevos elementos:

HeartScene
│
├── HeartModel
├── GreatVessels
├── ElectricalOverlay
├── BloodFlowLayer (Fase E)
├── DeviceLayer (Marcapasos, catéteres...)
├── LabelsLayer
├── CameraController
└── Lighting

Con esa arquitectura, cuando en el futuro añadas farmacología, marcapasos, desfibrilación o flujo sanguíneo, no tendrás que rehacer la escena 3D; simplemente activarás nuevas capas sobre una base ya diseñada para crecer.

En conjunto, esta Fase D seguiría la misma filosofía que el resto del proyecto: un núcleo de simulación único y varias representaciones sincronizadas (ECG, corazón 3D y, más adelante, constantes vitales y otros módulos), manteniendo siempre una separación clara entre la lógica fisiológica y la visualización.