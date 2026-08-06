# pharmacology-engine

Motor farmacológico del simulador de ECG (Fase F).

## El principio

Un fármaco **nunca** produce una onda. Produce un cambio fisiológico, y el
ECG cambia como consecuencia:

```
Administración → PharmacologyEngine → PhysiologyState → EcgEngine → trazado
```

Este paquete no importa `ecg_engine` en ningún módulo, y hay un test
(`tests/unit/test_decoupling.py`) que lo comprueba leyendo los imports de
cada archivo. El único objeto que cruza la frontera es `PhysiologyState`.

## Uso

```python
from pharmacology_engine import PharmacologyEngine, Route

engine = PharmacologyEngine()
engine.administer("atropine", 1.0, Route.IV, t_s=0.0)

engine.physiology_at(90.0).heart_rate_bpm   # frecuencia en el pico
engine.active(90.0)                          # para la barra de la interfaz
engine.effect_with_interactions(90.0)        # efecto + reglas disparadas
```

Consultar es una función pura del tiempo: preguntar por `t = 30` después de
haber preguntado por `t = 120` devuelve exactamente lo mismo. De ahí que el
replay solo necesite guardar la lista de administraciones.

## Añadir una molécula

Un archivo en `src/pharmacology_engine/catalog/data/`. Nada más:

```yaml
id: mi_farmaco
name: Mi fármaco
category: antiarrhythmic       # ver DrugCategory
routes: [IV]                   # ver Route
dose_unit: mg
reference_dose: 100            # la dosis a la que se declaran los efectos
max_cumulative_dose: 300       # techo de acumulación
onset_s: 45
peak_s: 120
duration_s: 1200
half_life_s: 300               # opcional: se deriva de duration y peak
effects:
  qt_delta_ms: {slope: 20}          # campos aditivos → slope
  av_conduction: {multiplier: 0.8}  # campos multiplicativos → multiplier
clinical_note: >
  Por qué existe y qué enseña.
references:
  - "Guía, año — sección"
```

Los campos válidos y su tipo están en `models.ADDITIVE_FIELDS` y
`models.MULTIPLICATIVE_FIELDS`. Poner `slope` donde va un `multiplier` (o al
revés) falla al cargar el catálogo, no en mitad de una sesión: es el error
que produce números plausibles y mal.

## Interacciones

Datos también, en `interactions.INTERACTION_RULES`. Una regla declara sus
participantes —por identificador, por categoría o por ambos— y el efecto
**adicional** que aporta. Se dispara cuando todas sus plazas quedan
cubiertas por fármacos distintos, con la intensidad del más débil de ellos.

## Lo que no hace

Fuera de alcance por decisión de la Fase F: metabolismo hepático,
eliminación renal, unión a proteínas, distribución multicompartimental,
farmacogenética y farmacología poblacional. El objetivo es una simulación
fisiológicamente coherente para enseñanza, no una plataforma de PK/PD.

## Tests

```bash
uv run --extra dev pytest
```

Los golden de `tests/golden/` no fijan números exactos sino la **dirección
clínica** de cada molécula: atropina sube la frecuencia, amiodarona alarga
el QTc, adenosina bloquea el nodo AV, adrenalina sube la contractilidad. Si
un ajuste del catálogo rompe uno de esos tests, el ajuste está mal.
