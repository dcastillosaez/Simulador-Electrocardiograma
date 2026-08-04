# Eje eléctrico cardíaco — Diseño

**Fecha:** 2026-08-03
**Estado:** aprobado, listo para plan de implementación
**Alcance:** modelo angular en `packages/ecg-engine`, parámetro en caliente a través de la API, y panel de orientación eléctrica en `apps/web`.

---

## 1. Qué se construye

Un parámetro que representa la orientación eléctrica del corazón y que, al moverse, cambia la señal de las seis derivaciones de miembros exactamente como lo haría en un paciente real. Con un panel que lo muestra como lo piensa un clínico: un vector sobre el diagrama hexaxial, no un número suelto.

El motor deja de tener una tabla fija de coeficientes de proyección y pasa a calcularlos de un ángulo. No es un modelo nuevo encima del existente: es la demostración de que la tabla actual **ya era** un caso particular de la proyección coseno, y de que generalizarla no cambia ni una muestra de lo que hoy se ve en pantalla.

## 2. El hallazgo que sostiene todo el diseño

`NORMAL_AXIS_PROJECTION` (`leads.py:67`) no es una tabla de doce números escogidos a mano. Sus seis derivaciones de miembros son, con exactitud verificable:

```
I   = M · cos(50° −   0°) = 0.653      M = 1 / cos(50° − 60°) = 1.01543
II  = M · cos(50° −  60°) = 1.000
III = M · cos(50° − 120°) = 0.347
aVR = −(I + II) / 2       = −0.8265
aVL =  (I − III) / 2      =  0.153
aVF =  (II + III) / 2     =  0.6735
```

Los seis valores de la tabla coinciden con estas fórmulas. `ATRIAL_PROJECTION` es la misma construcción a unos 53°.

De ahí salen tres consecuencias que gobiernan el resto del documento:

1. **Una función `projection_for_axis(ángulo)` reproduce la tabla actual.** No hay que elegir entre "modelo nuevo" y "trazados validados": el modelo nuevo *contiene* los trazados validados.
2. **La ley de Einthoven deja de ser un test y pasa a ser un teorema.** `cos(α) + cos(α−120°) = cos(α−60°)` es una identidad trigonométrica, así que `I + III = II` se cumple para cualquier ángulo, incluidos los que a nadie se le ocurra probar.
3. **La magnitud no es una constante mágica.** Se deriva en tiempo de importación como `1 / cos(orientación_referencia − ángulo_de_II)`, que es literalmente la normalización que alguien aplicó al escribir la tabla: hacer que II valga 1,000 exacto. Un `1.01543` escrito a pelo sería un número cuyo origen nadie recordaría en seis meses.

**La magnitud es constante y no se recalcula al mover el eje.** Es el módulo del vector cardíaco: lo que rota es su dirección, no su tamaño. Por eso el coeficiente de II baja según el eje se aleja de 60°, que es exactamente lo que ocurre en un paciente. Renormalizar en cada ángulo para mantener II en 1,000 sería físicamente falso y además explotaría: a 150° el coeficiente de II es cero y la división es imposible.

Hay dos magnitudes, una por familia de onda, cada una derivada de la orientación de referencia de su familia: `1 / cos(50° − 60°) = 1.01543` para QRS, ST y T, y `1 / cos(53,4° − 60°) = 1.00667` para la P. Con una sola magnitud compartida, el coeficiente de II en la proyección auricular saldría 1,009 en lugar del 1,000 de la tabla histórica.

Este documento comenta explícitamente el punto que ya anticipaba `leads.py:5` — *"deja abierta la migración a un modelo vectorial en fase 4 sin tocar la API pública"*. Esto es esa migración, acotada al plano frontal.

## 3. Orientación anatómica y ejes eléctricos son cosas distintas

La distinción no es terminológica, es clínica, y el modelo la refleja:

| Situación | Qué se mueve |
|---|---|
| Paciente longilíneo, corazón vertical | La orientación anatómica, y con ella P, QRS y T |
| Hemibloqueo anterior izquierdo | Solo el eje del QRS. El corazón no se ha movido |
| Hipertrofia ventricular | QRS y T, no la P |
| Isquemia, lesión | El vector del ST, sin que rote nada |

Un parámetro único no puede representar los cuatro casos. El modelo separa:

```python
@dataclass(frozen=True, slots=True)
class AxisParams:
    orientation_deg: float = 50.0
    p_offset_deg: float = 3.4
    qrs_offset_deg: float = 0.0
    st_offset_deg: float = 0.0
    t_offset_deg: float = 0.0
```

El eje efectivo de cada onda es `orientation_deg + su desfase`. No hay estado duplicado, así que no puede desincronizarse: el modo básico de la interfaz mueve `orientation_deg` y los cuatro ejes rotan juntos; el modo avanzado toca los desfases, que es como se representa un hemibloqueo.

**`orientation_deg` no es un parámetro del ECG. Es un parámetro fisiológico.** Lo consumen el motor de señal, el vector del panel y —cuando exista— el corazón 3D de la fase D, que lo leerá como su giro en el plano frontal. Queda escrito aquí para que dentro de un año no aparezca un `heart_rotation_deg` duplicando el mismo dato en otro sitio.

Los 3,4° de desfase de la P no son una invención: son los que la tabla histórica ya llevaba implícitos. Conservarlos es lo que produce regresión cero. La tabla tiene dos decimales, así que el desfase solo queda determinado con una precisión de medio grado; el valor exacto lo fija un test contra `ATRIAL_PROJECTION`.

### Límites

Los rangos no son una limitación del motor, que sabe calcular cualquier ángulo. Son la declaración de qué considera el sistema fisiológicamente razonable, y viajan al cliente por la API:

| Parámetro | Rango | Por qué |
|---|---|---|
| `orientation_deg` | −180 … +180 | La circunferencia completa del plano frontal |
| `p_offset_deg` | −45 … +45 | El eje de la P no se despega mucho del del corazón |
| `qrs_offset_deg` | −90 … +90 | Cubre hemibloqueos en ambos sentidos |
| `st_offset_deg` | −180 … +180 | El vector de lesión apunta hacia donde esté la lesión |
| `t_offset_deg` | −180 … +180 | Una T completamente discordante es un hallazgo real |

Se declaran en `editable_parameters` del catálogo —de donde el frontend los lee, nunca escritos a mano en el cliente— y se aplican también en `EcgEngine._clamped`, que ya existe y ya hace esto con los demás parámetros.

Como los doce ritmos comparten estos rangos, se definen una sola vez como `AXIS_PARAMETER_RANGES` y se fusionan en cada definición del catálogo. Doce copias del mismo bloque serían doce sitios donde se puede desincronizar.

## 4. Zonas clínicas

`AxisZone` es un **helper derivado del ángulo, nunca un dato almacenado**. Guardarlo crearía dos fuentes de verdad que pueden discrepar.

```
EXTREME  −180 ≤ α <  −90     "tierra de nadie"
LEFT      −90 ≤ α <  −30     desviación izquierda
NORMAL    −30 ≤ α ≤  +90
RIGHT     +90 < α ≤ +180     desviación derecha
```

Los cuatro intervalos cubren [−180, +180] sin solaparse ni dejar huecos, que es lo que hace que las fronteras sean testeables una a una.

`zone_for(deg)` **normaliza primero** a (−180, +180]. Hace falta: con `orientation_deg` en +180 y `qrs_offset_deg` en +90, el eje efectivo del QRS sale a +270, que es un ángulo perfectamente válido y que sin normalizar caería fuera de los cuatro intervalos.

Una sola implementación en el motor, y un espejo en TypeScript para que el disco pueda colorear la zona mientras el usuario arrastra, sin esperar una ida y vuelta al servidor. El espejo se mantiene a mano con un test de contrato, igual que la cabecera binaria de 40 bytes es espejo de `frames.py`.

## 5. Proyección por onda

Hoy `_trace_for_event` (`renderer.py:64`) suma todos los componentes de una plantilla —P, QRS, ST y T— en una sola traza y le aplica un único coeficiente. Con eso, la T no puede tener eje propio.

`render_events` pasa de recibir `Mapping[EventKind, LeadProjection]` a recibir un `LeadProjectionSet`:

```python
@dataclass(frozen=True, slots=True)
class LeadProjectionSet:
    p: LeadProjection
    qrs: LeadProjection
    st: LeadProjection
    t: LeadProjection
```

Se llama así y no `ProjectionSet` porque es un conjunto de `LeadProjection`, y el nombre tiene que seguir teniendo sentido el día que aparezca la onda U.

El ST entra desde el principio aunque hoy no se use. La fase de farmacología traerá isquemia, lesión, pericarditis y repolarización precoz, y en todas ellas el vector del ST tiene identidad propia. Añadirlo ahora cuesta un campo; añadirlo después cuesta rehacer el contrato del renderer.

El corte por onda es limpio, verificado contra `beat.py`: las plantillas auriculares (`sinus_p`, `flutter_f`, `af_f`) contienen **solo** componentes `P`; las ventriculares (`normal_qrst`, `wide_qrst`, `escape_qrst`) contienen `QRS`, `ST` y `T`. Así que un evento auricular se proyecta entero con `p`, y uno ventricular se parte en tres grupos por `WaveTarget`.

### Por qué esto no cambia la señal

Con los desfases de ST y T en cero, los tres grupos ventriculares se proyectan con coeficientes idénticos y la suma es la misma señal. La única diferencia es de reasociación en punto flotante —`(a+b)·c` frente a `a·c + b·c`—, del orden de 1e-19 V sobre señales de 1e-3 V.

Además, el componente ST tiene amplitud `0.00000` en las tres plantillas base: es isoeléctrico, y la elevación del STEMI viene de los overlays, que ya se aplican por su propio `lead_mask()` al margen del sistema de proyección. Hoy el grupo del ST aporta exactamente cero.

Los golden signals comparan con `np.testing.assert_allclose` a tolerancia `1e-12` —efectivamente bit a bit—, así que una refactorización solo pasa si reproduce la señal con esa exactitud. La reasociación de punto flotante de arriba (1e-19 V) cabe de sobra dentro de esa tolerancia. Lo que no cabe es sustituir la proyección de producción por la calculada: `projection_for_axis(50°)` reproduce la tabla histórica solo dentro del redondeo (~3e-4), no bit a bit. Por eso la **orientación de referencia usa las tablas literales validadas** —`projection_set_for_axis` devuelve `DEFAULT_PROJECTION_SET`, las tablas históricas, cuando el eje es el de referencia— y solo un eje desviado se calcula por trigonometría. Así los goldens pasan sin regenerarse, que es precisamente lo que existen para garantizar.

## 6. Precordiales

El eje frontal gobierna las seis derivaciones de miembros y **nada más**. V1-V6 están en el plano horizontal: dependen de la rotación horaria o antihoraria del corazón, que es un giro anatómico distinto e independiente, y cuyo efecto visible es desplazar la zona de transición R/S.

Conservan por tanto sus tablas actuales, extraídas de las constantes de hoy a `QRS_PRECORDIAL` y `ATRIAL_PRECORDIAL`. Los grupos de ST y T usan la precordial del QRS, que es lo que hacen hoy al compartir traza con él.

Acoplar las precordiales al eje frontal sería más vistoso y enseñaría al alumno una relación que no existe.

## 7. Las derivaciones aumentadas se quedan sin amplificar

aVR, aVL y aVF se derivan de I, II y III por las relaciones de Goldberger, no por coseno directo sobre sus propios ángulos. Por coseno saldrían un 15,5% mayores: el factor √3/2 es exactamente la "amplificación" que da nombre a la *a* de aVR.

La tabla actual usa los valores sin amplificar, y esos son los trazados que pasaron revisión clínica. Amplificarlos puede ser correcto, pero es una decisión clínica con su propia revisión, no un efecto colateral de introducir el eje.

## 8. Recorrido del parámetro

`AxisParams` entra en `EngineParams`. Como el mensaje `update` del WebSocket ya transporta `params` completo y `updated` lo devuelve aplicado, el ajuste en caliente funciona sin fontanería nueva: solo el espejo del payload en `schemas.py` y en `types/ws-messages.ts`.

**El frontend de render no cambia en absoluto.** La señal llega ya proyectada desde el servidor; el canvas dibuja lo que le llega. Mover el eje no toca `render/`, ni el buffer, ni el barrido.

## 9. Panel de orientación eléctrica

`apps/web/src/ui/AxisControl/`. Un disco hexaxial en SVG con las seis derivaciones rotuladas en sus ángulos reales y el vector del QRS dibujado sobre él, más la lectura numérica, la zona activa y una nota de interpretación clínica.

- **Arrastrar el vector** es la interacción principal: el usuario coge la punta y la gira.
- **Stepper de ±5°** para ajuste fino.
- **Teclado**: el disco es un `role="slider"` con `aria-valuenow`, `aria-valuemin`, `aria-valuemax` y un `aria-valuetext` que dice el ángulo *y* la zona. Flechas mueven 5°, `Home` vuelve a la orientación de referencia. El arrastre es una mejora encima de esto, nunca el único camino.
- **Color por zona** en el borde del disco, discreto: verde tenue en normal, azul en desviación izquierda, naranja en derecha, rojo oscuro en eje extremo. Requiere cuatro roles nuevos en el tema (`Theme.axis`), porque `Theme.inspector` solo tiene ok/warning/critical.
- **Rotación de 200 ms** al cambiar, usando `--motion-normal`, que ya vale exactamente eso. El salto instantáneo rompe la sensación de instrumento.
- **Interpretación clínica** bajo el disco: qué es compatible con la zona activa (hipertrofia, hemibloqueos). Es texto docente; no modifica la señal ni condiciona nada.

El inspector gana además una métrica con el eje y su zona, que es donde un clínico espera leerlo mientras mira el trazado.

## 10. Verificación

| Qué se fija | Cómo |
|---|---|
| `projection_for_axis(50°)` reproduce `NORMAL_AXIS_PROJECTION` | Coeficiente a coeficiente, con tolerancia 5e-4 — media unidad del último decimal de la tabla. **No 1e-9**: la tabla está redondeada a tres decimales, y aVR/aVL/aVF se escribieron desde esos valores ya redondeados, así que la reproducción exacta es imposible por construcción |
| El desfase de la P reproduce `ATRIAL_PROJECTION` | Igual, con tolerancia 5e-3: esa tabla solo tiene dos decimales |
| Einthoven `I + III = II` | Barrido de α cada 1° en todo el rango, no tres casos sueltos |
| aVR negativa en todo el rango normal | Barrido de −30° a +90° |
| Firma de desviación izquierda | A −30°: I positiva, aVF negativa |
| Firma de desviación derecha | A +120°: I negativa, aVF positiva |
| Fronteras de `zone_for` | Los cuatro límites, por ambos lados |
| Normalización de `zone_for` | +270° clasifica igual que −90° |
| Cobertura sin huecos de las zonas | Barrido de −180 a +180: ninguna devuelve `None` |
| Los goldens siguen pasando | Suite existente (tolerancia `1e-12`, bit a bit), sin regenerar. La orientación de referencia usa las tablas literales; solo los ejes desviados se calculan |
| La referencia usa las tablas literales | `projection_set_for_axis(AxisParams())` reproduce `NORMAL_AXIS_PROJECTION`/`ATRIAL_PROJECTION` bit a bit |
| Espejo TS de las zonas | Test de contrato contra los mismos límites |
| Accesibilidad del disco | Rol, valores ARIA, navegación por flechas |

## 11. No-objetivos de esta entrega

| No hay | Por qué | Cuándo |
|---|---|---|
| Rotación horizontal (transición R/S en precordiales) | Exige modelar la progresión de la R como función continua del ángulo; hoy son seis números escritos a mano | Entrega posterior |
| Inclinación sagital | Sin consumidor: ni el ECG ni el corazón 3D actual la usan | Cuando exista uno |
| Eje de la onda U | La onda U no está modelada en las plantillas | Cuando lo esté |
| Ángulo QRS-T ejercitado | El modelo lo soporta (`t_offset_deg`), pero esta entrega lo deja en cero | Entrega posterior |
| Orientación característica por ritmo | Cambiaría la señal de ritmos ya validados | Ver §12 |
| Amplificación de aVR/aVL/aVF | Decisión clínica con revisión propia | Sin fecha |

Todos los ritmos parten de la **orientación fisiológica de referencia** de 50°. No es un valor por defecto pendiente de arreglar: es una decisión deliberada para preservar la compatibilidad con los trazados ya validados. Los ritmos con eje característico —taquicardia ventricular, STEMI, hipertrofias— podrán declarar su propia orientación de referencia en versiones futuras sin tocar el modelo, porque el campo ya existe y ya viaja.

## 12. Futuras extensiones del modelo

El diseño está pensado para crecer sin romper la API:

| Extensión | Estado |
|---|---|
| Orientación frontal (`orientation_deg`) | ✔️ Esta entrega |
| Ejes independientes de P, QRS, ST y T | ✔️ Esta entrega (ST y T sin ejercitar) |
| Ángulo QRS-T independiente | ✔️ Soportado por el modelo |
| Sincronización con el corazón 3D | Consume `orientation_deg`, sin campo nuevo |
| Rotación horizontal (precordiales) | Parámetro nuevo, sin tocar lo existente |
| Inclinación sagital | Parámetro nuevo |
| Eje de la onda U | Campo nuevo en `LeadProjectionSet` |
| Orientación de referencia por ritmo | Campo nuevo en el catálogo |

Ninguna de ellas obliga a rehacer `projection_for_axis`, `AxisParams` ni el contrato de `render_events`.
