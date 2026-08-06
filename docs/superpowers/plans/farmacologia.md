# Fase F — Motor de Farmacología

Versión: 1.0  
Estado: Diseño arquitectónico  
Prioridad: Alta (posterior a la Fase D - Corazón 3D)

---

# Objetivo

Incorporar un motor farmacológico completamente desacoplado del motor del electrocardiograma, capaz de modificar en tiempo real el comportamiento fisiológico del paciente y, como consecuencia, alterar:

- ECG de 12 derivaciones.
- Movimiento del corazón 3D.
- Constantes vitales.
- Evolución clínica del caso.

El motor farmacológico nunca genera señal ECG directamente.

Su única responsabilidad consiste en modificar el estado fisiológico del paciente.

El EcgEngine continúa siendo la única fuente de verdad eléctrica del sistema.

---

# Filosofía

Toda la simulación seguirá el flujo:

Usuario
↓
Administración de un fármaco
↓
Motor farmacológico
↓
Estado fisiológico
↓
Motor ECG
↓
Render ECG

                     ↓

             Corazón 3D

                     ↓

           Constantes vitales

Es importante entender que:

Los medicamentos nunca modifican la forma del ECG.

Modifican únicamente la fisiología.

El ECG cambia como consecuencia.

Esta decisión mantiene completamente desacopladas las capas del simulador.

---

# Objetivos

La Fase F debe permitir:

✓ Administrar medicamentos en tiempo real.

✓ Varias administraciones simultáneas.

✓ Dosis acumulativas.

✓ Curvas concentración-tiempo.

✓ Inicio de acción.

✓ Pico de acción.

✓ Eliminación.

✓ Interacciones farmacológicas.

✓ Persistencia.

✓ Replay exacto.

✓ Sin modificar el EcgEngine.

---

# No objetivos

Esta fase NO pretende simular farmacología clínica completa.

No se implementará:

- metabolismo hepático
- eliminación renal
- unión a proteínas
- distribución multicompartimental
- farmacogenética
- farmacología poblacional

El objetivo es una simulación fisiológica coherente para enseñanza.

---

# Arquitectura

apps/

    api/

        pharmacology/

packages/

    pharmacology-engine/

        catalog/

        kinetics/

        dynamics/

        interactions/

        physiology/

        models/

        engine.py

El motor farmacológico será un paquete independiente.

No importará absolutamente nada del EcgEngine.

El EcgEngine únicamente recibirá:

PhysiologyState

como entrada.

Nunca medicamentos.

---

# Flujo completo

Usuario

↓

Selecciona

Amiodarona

↓

Introduce

300 mg IV

↓

DrugAdministration

↓

PharmacologyEngine

↓

DrugEffect

↓

PhysiologyState

↓

EcgEngine

↓

Nuevo ECG

↓

HeartAnimator

↓

Nuevo movimiento cardíaco

---

# DrugAdministration

Cada administración genera un evento.

```python
@dataclass

class DrugAdministration:

    id: UUID

    drug_id: str

    dose

    route

    administration_time

    operator

    notes
```

Nunca desaparece.

Forma parte del replay.

---

# DrugModel

Cada medicamento implementa exactamente la misma interfaz.

```python
class DrugModel:

    id

    name

    category

    route

    onset_s

    peak_s

    duration_s

    half_life_s

    max_dose

    def effects(...)
```

No conoce el ECG.

No conoce el corazón 3D.

No conoce la UI.

---

# DrugEffect

Los medicamentos nunca producen ondas.

Siempre producen modificadores fisiológicos.

```python
@dataclass

class DrugEffect:

    heart_rate_delta

    sinus_rate

    automaticity

    av_conduction

    ventricular_conduction

    atrial_conduction

    pr_delta_ms

    qrs_delta_ms

    qt_delta_ms

    axis_delta_deg

    st_shift_mv

    t_amplitude

    contractility

    stroke_volume

    blood_pressure

    respiratory_rate

    oxygen_consumption
```

El EcgEngine únicamente ve estos parámetros.

Nunca sabe qué medicamento los produjo.

---

# PhysiologyState

El estado fisiológico pasa a ser la interfaz oficial entre motores.

```python
PhysiologyState

heart_rate

sinus_rate

automaticity

pr_interval

qrs_duration

qt_interval

axis

contractility

blood_pressure

stroke_volume

respiratory_rate

oxygen_consumption
```

Todos los motores consumen este objeto.

---

# Farmacocinética

Cada medicamento implementa una curva concentración-tiempo simplificada.

```
Concentración

          _________

        /           \

______/               \________

        inicio   pico    fin
```

Cada molécula define:

onset

peak

duration

half_life

No se pretende precisión clínica absoluta.

Solo comportamiento fisiológicamente coherente.

---

# Farmacodinamia

Cada frame:

DrugModel

↓

Concentration(t)

↓

DrugEffect

↓

Σ DrugEffects

↓

PhysiologyState

↓

ECG

---

# Acumulación

Dos dosis del mismo medicamento:

300 mg

+

300 mg

↓

600 mg efectivos

hasta el límite definido por el modelo.

No se reemplazan.

Se acumulan.

---

# Interacciones

Nuevo módulo:

interactions/

Recibe:

lista de medicamentos activos

Devuelve:

DrugEffect corregido.

Ejemplos:

Verapamilo

+

Betabloqueante

↓

Mayor bloqueo AV.

Amiodarona

+

QT largo

↓

Mayor prolongación QT.

Digoxina

+

Hipopotasemia (futura)

↓

Mayor riesgo arrítmico.

---

# Catálogo

Todos los medicamentos serán datos.

Nunca código.

```
catalog/

adenosine.yaml

amiodarone.yaml

atropine.yaml

dopamine.yaml

epinephrine.yaml

lidocaine.yaml

magnesium.yaml

metoprolol.yaml

verapamil.yaml

digoxin.yaml
```

Ejemplo:

```yaml
id: amiodarone

category: antiarrhythmic

route: IV

onset: 120

peak: 600

duration: 7200

effects:

    qt_delta_ms:

        slope: 40

    automaticity:

        multiplier: 0.8

    ventricular_conduction:

        multiplier: 0.9
```

---

# Primera biblioteca de fármacos

## Antiarrítmicos

- Adenosina
- Amiodarona
- Lidocaína
- Procainamida

---

## Betabloqueantes

- Metoprolol
- Esmolol

---

## Calcioantagonistas

- Verapamilo
- Diltiazem

---

## Simpaticomiméticos

- Adrenalina
- Noradrenalina
- Dopamina
- Dobutamina

---

## Parasimpaticolíticos

- Atropina

---

## Electrolitos

- Sulfato de Magnesio
- Cloruro Potásico (fase posterior)

---

# UI

Nueva zona del Inspector.

────────────────────────

Farmacología

────────────────────────

Categoría

□ Antiarrítmicos

□ Betabloqueantes

□ Simpaticomiméticos

□ Electrolitos

↓

Lista de medicamentos

↓

Dosis

↓

Vía

↓

Administrar

────────────────────────

Medicamentos activos

Amiodarona

██████████

120 s

↓

Adenosina

███░░░░░░░

8 s

Cada medicamento muestra:

- tiempo restante
- concentración relativa
- dosis administrada

---

# Integración con el corazón 3D

El HeartAnimator nunca conoce medicamentos.

Consume únicamente:

PhysiologyState.

Ejemplos.

Adrenalina

↓

Mayor contractilidad

↓

Mayor amplitud de contracción

↓

Mayor velocidad

↓

Mayor frecuencia.

Adenosina

↓

Bloqueo AV

↓

Pausa ventricular

↓

Reinicio del nodo sinusal.

---

# Integración con constantes

El mismo PhysiologyState actualizará:

FC

TA

SatO₂

FR

Gasto cardíaco (fase futura)

---

# Persistencia

Nueva tabla:

drug_administrations

id

session_id

drug_id

dose

route

time

operator

Todas las administraciones quedan registradas.

---

# Replay

Una sesión reproduce exactamente:

- ECG
- Corazón
- Farmacología

si coinciden:

- seed
- engine_version
- pharmacology_engine_version

---

# Testing

## Unitarios

- Curvas concentración-tiempo.
- Inicio de acción.
- Pico.
- Eliminación.
- DrugEffect.
- Acumulación.
- Interacciones.

---

## Golden

Atropina

↓

FC aumenta.

Amiodarona

↓

QT aumenta.

Adenosina

↓

Bloqueo AV.

Adrenalina

↓

Contractilidad aumenta.

---

## Integración

Administrar medicamentos.

↓

Persistencia.

↓

Replay.

↓

Resultado idéntico.

---

# Fase F2 — Entrenamiento clínico

La arquitectura de la Fase F permite añadir posteriormente un modo de simulación clínica.

El usuario ya no selecciona únicamente un ritmo, sino un caso completo.

Ejemplo:

Paciente:

68 años

Dolor torácico

40 minutos

Hipotensión

↓

ECG

↓

El alumno decide:

- diagnóstico
- tratamiento
- medicamento
- dosis
- vía de administración

↓

El simulador evalúa la decisión y muestra la evolución clínica en tiempo real.

---

# Principios arquitectónicos

✔ El EcgEngine nunca conoce medicamentos.

✔ El HeartAnimator nunca conoce medicamentos.

✔ Todo medicamento modifica únicamente PhysiologyState.

✔ Toda molécula nueva se añade mediante un archivo YAML.

✔ El motor farmacológico permanece completamente desacoplado del motor ECG.

✔ La incorporación de nuevos medicamentos nunca requiere modificar la arquitectura existente.

✔ La simulación es reproducible bit a bit mediante replay.
