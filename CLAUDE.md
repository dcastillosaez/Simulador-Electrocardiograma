# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Descripción

Proyecto independiente dentro de `F:/Documentos/IA/Medicina/`, sin relación con los demás proyectos de esa carpeta (`Cuaderno_Residente/`, `Rotacion_Psiquiatria/`, `Estudio Insomnio/`, `Estudio_Sarampion/`). Ignora el `../CLAUDE.md` del directorio padre al trabajar aquí.

**Alcance de análisis:** únicamente el contenido de `F:/Documentos/IA/Medicina/Simulador_Electrocardiograma/`.

**Estado actual:** fase 1 implementada. El paquete `packages/ecg-engine/` genera los doce ritmos del MVP en las doce derivaciones, de forma determinista, con 401 tests y una red de golden signals en tres niveles. Faltan la API y el frontend (planes B y C, sin escribir).

Para ver lo que produce el motor sin montar nada más:

```bash
cd packages/ecg-engine && uv run --extra viz python tools/render_rhythms.py
```

Escribe los doce trazados en formato de papel de ECG en `tools/output/`.

## Objetivo del producto

Plataforma de simulación clínica de ECG (no un simple dibujador de ondas). Tres niveles de ambición, construidos por fases:

- **Nivel 1 — visualizador didáctico:** ECG en 1/3/6/12 derivaciones, pausa, velocidad, amplitud, calibración, filtro, ruido, FC.
- **Nivel 2 — simulador clínico:** ritmos normales y patológicos, cambios dinámicos (isquemia, arritmias, bloqueos AV, extrasístoles, taquicardias, FV), transiciones temporales, respuesta a intervenciones.
- **Nivel 3 — plataforma profesional (objetivo final):** editor de escenarios, evaluación automática del alumno, registro de sesiones, exportación de trazas, modo instructor, API para LMS/simuladores/laboratorios.

## Arquitectura (capas)

1. **Motor fisiológico** — núcleo. Genera señal ECG y estado del paciente (ritmo base, morfología P-QRS-T, intervalos PR/QRS/QT/RR, ruido/artefactos/deriva). Debe ser agnóstico de interfaz: ejecutable en navegador, backend o tests.
2. **Motor de escenarios** — narrativa clínica: líneas de tiempo, condiciones, eventos, disparadores por intervención, branching.
3. **Motor de reglas** — decide cómo cambia el ECG según estado del paciente. Reglas declarativas, no `if/else` disperso (ej.: hiperpotasemia → ensancha QRS y aplana P).
4. **Capa de visualización** — trazado a 60fps, zoom, grid clínico, selección de derivaciones, congelar pantalla, medición de intervalos, exportación PDF/imagen.
5. **Capa de evaluación** — identificación de ritmo, tiempo de respuesta, intervención elegida, adherencia a protocolo, puntuación.
6. **Persistencia e integración** — usuarios, sesiones, escenarios, resultados, biblioteca de casos, versiones de escenarios, telemetría.

## Modelo de dominio

`Paciente` (edad, sexo, constantes, contexto clínico, comorbilidades) · `Estado fisiológico` (ritmo, conducción, repolarización, perfusión, oxigenación, electrolitos) · `Señal ECG` (derivaciones, amplitud, frecuencia, ruido, filtros) · `Escenario` (objetivos, pasos, eventos, criterios de éxito/fallo) · `Intervención` (fármaco, maniobra, desfibrilación, marcapasos, oxígeno) · `Observación` (hallazgos del usuario) · `Resultado` (aciertos, errores, tiempos, puntuación).

## Motor ECG — requisitos técnicos

- **Morfología:** cada latido como suma de componentes (P, QRS, T, ST, PR, QT). Vía modelos paramétricos (gaussianas/spline), plantillas, síntesis por segmentos, o mezcla plantilla+perturbación.
- **Variabilidad realista:** variabilidad RR, variación de amplitud entre derivaciones, artefacto de movimiento, ruido muscular, interferencia de red, deriva de línea base, filtro de monitor, saturación/clipping.
- **Derivaciones:** 12 estándar + ritmo largo, con opción de ver 1/3/6.
- **Dinámica temporal:** evolución segundo a segundo y minuto a minuto, con eventos gatillados por historia clínica.

## Catálogo de ritmos/patologías (biblioteca base)

Ritmo sinusal normal, taquicardia sinusal, bradicardia sinusal, FA, flutter auricular, TSV, TV, FV, bloqueo AV 1º/2º/3º, BRI/BCRD, IAM con elevación ST, pericarditis, hiperkalemia, hipokalemia, hipocalcemia, hipercalcemia, WPW, torsades.

## Fases de implementación

- **Fase 1 (MVP):** 1 y 12 derivaciones, 10–15 ritmos comunes, controles velocidad/amplitud/ruido, motor simple de escenarios, almacenamiento básico de sesiones.
- **Fase 2:** evolución temporal de patologías, respuesta a intervenciones, escenarios con decisiones, evaluación automática, modo instructor, biblioteca de casos.
- **Fase 3:** editor visual de escenarios, plantillas, colaboración, permisos, analítica, exportaciones, integración LMS, autenticación robusta, auditoría.
- **Fase 4:** pruebas con usuarios reales, validación con cardiólogos/docentes, ajuste fino de señal, benchmark de rendimiento, hardening de seguridad.

No mezclar fases: no meter todo en el MVP.

## Stack recomendado

- **Frontend:** React + TypeScript, Canvas o WebGL para el trazado, Zustand/Redux, Tailwind (o diseño propio si se necesita precisión visual alta).
- **Backend:** Python + FastAPI (prioriza facilidad para motor/lógica) o Node.js/NestJS si el equipo es muy TS.
- **Motor de simulación:** Python para prototipo/modelado; mover a Rust o librería optimizada si hace falta rendimiento.
- **Base de datos:** PostgreSQL + Redis (sesiones tiempo real/caché); casos clínicos como JSON versionado.
- **Infraestructura:** Docker, CI/CD, logs estructurados y métricas.

## Estructura de repositorio objetivo

```
/ecg-simulator
  /apps
    /web
    /api
    /instructor-dashboard
  /packages
    /ecg-engine
    /scenario-engine
    /signal-models
    /ui-components
    /shared-types
  /docs
    /domain-model
    /scenario-spec
    /clinical-reference
  /tests
    /unit
    /integration
    /golden-signals
```

## Principios de diseño

- Diseñar por **escenarios clínicos**, no por pantallas.
- Escenarios como **especificaciones declarativas** (JSON/YAML o DSL propio): estado inicial, eventos, condiciones, transiciones, resultados esperados.
- Validar contra **trazas de referencia** (intervalos, morfología, segmentación, apariencia visual).
- Separar **realismo clínico** de **experiencia de usuario** (legible, rápido, entrenable, explicativo).
- La lógica clínica vive en especificaciones/tests/datasets/reglas versionadas — nunca solo en el código de UI.

## Testing (desde el día 1)

Unitarias del motor de señal · reglas fisiológicas · escenarios · visuales con capturas de referencia · rendimiento · regresión de ritmos · evaluación del alumno. Usar **golden outputs**: la señal esperada de un escenario debe mantenerse estable entre versiones salvo cambio intencional.

## Riesgos a evitar

Construir solo la UI dejando el motor vacío · meter lógica clínica en componentes front-end · no versionar escenarios · no separar señal y presentación · simular todo con `if/else` · no validar con profesionales clínicos · subestimar ruido/artefactos · no diseñar desde el inicio para 12 derivaciones.

## Aviso regulatorio

Uso previsto: **docencia**. Si el producto se acerca a herramienta de apoyo clínico real, hay implicaciones legales/regulatorias distintas — mantener el posicionamiento como simulador formativo salvo decisión explícita en contra.

## Cómo usar Claude en este proyecto

Como arquitecto, generador de casos y copiloto de pruebas: especificaciones funcionales, modelos de dominio, escenarios clínicos, conversión de escenarios a JSON, tests unitarios, revisión de arquitectura, documentación de ritmos/criterios, UI de instructor/dashboard. **No** usar como fuente de verdad única de la lógica clínica — esa verdad vive en especificaciones, tests, datasets y reglas versionadas.
