# CLAUDE.md

Plataforma de simulación clínica de ECG. No es un dibujador de ondas: hay un motor fisiológico que genera la señal en las doce derivaciones, un motor de farmacología que modifica el estado del paciente, un corazón 3D que late con el mismo reloj que el trazado y una aplicación de escritorio que lo empaqueta todo.

**Uso previsto: docencia.** Si el producto se acerca a herramienta de apoyo clínico real, las implicaciones legales y regulatorias son otras. Mantener el posicionamiento como simulador formativo salvo decisión explícita en contra.

## Dónde está la verdad

Este fichero son reglas, no estado. El estado y el porqué de cada decisión viven en:

- `docs/fase-g/arquitectura.md` — el qué y el por qué de la aplicación de escritorio.
- `docs/fase-g/plan-de-fases.md` — las ocho sub-fases, con criterios de aceptación comprobables.
- `docs/fase-g/estado.md` — qué está hecho, qué falta y qué no puede hacerse sin comprar un certificado o levantar un servidor.
- `docs/fase-d/valvulas.md` — el ciclo de las cuatro válvulas y cómo se sintetizaron las poses.
- `docs/requisitos-del-sistema.md` y `docs/instalacion.md`.
- `Instrucciones.md.txt` e `Instrucciones_Electrocardiograma.md` — el brief original, como contexto histórico.

Al cerrar una fase, el relato va a su `estado.md`. Aquí solo sube lo que se convierte en regla.

## Cómo arrancar

```bash
arrancar.bat
```

Levanta Postgres en Docker (abriendo Docker Desktop si hace falta), aplica migraciones, arranca API y frontend en ventanas separadas y abre el navegador. `parar.bat` detiene el contenedor, que es lo único que queda en segundo plano al cerrar las ventanas.

Frontend en `http://localhost:5600`, API en `http://localhost:8200`. **No son los puertos por defecto, y es a propósito:** el 5173 de Vite y el rango 7990-8089 caen en bloques que Windows reserva para sí en la máquina de desarrollo (Hyper-V y Docker los piden al arrancar). El síntoma no es «puerto ocupado» sino `WinError 10013`, un error de permisos. `arrancar.bat` comprueba que el puerto se pueda escuchar antes de levantar nada y admite `set PUERTO_API=...`. Los rangos reservados se ven con `netsh interface ipv4 show excludedportrange protocol=tcp`.

Escritorio (Tauri 2): `cd apps/desktop && npm run dev`, o `npm run build` para el instalador.

Para ver lo que produce el motor sin montar nada más:

```bash
cd packages/ecg-engine && uv run --extra viz python tools/render_rhythms.py
```

Escribe los trazados en formato de papel de ECG en `tools/output/`.

## Invariantes

Reglas que no se deducen leyendo el código y que, si se rompen, rompen algo.

**Farmacología aislada.** `packages/pharmacology-engine/` no importa nada de `ecg-engine`, y hay un test que lo verifica leyendo los imports de cada módulo. Su única salida es `PhysiologyState`, y `apps/api/src/ecg_api/pharmacology/projection.py` es el único punto del sistema donde ese estado se traduce a `EngineParams`. El resto del estado fisiológico viaja por el canal JSON `pharmacology` a 1 Hz.

**Añadir una molécula es añadir un YAML** en `packages/pharmacology-engine/src/pharmacology_engine/catalog/data/`. Si alguna vez obliga a tocar código fuera de ahí, la arquitectura ha fallado.

**El fármaco entra por el mando que le toca.** En los ritmos con mandos propios lo declara `RHYTHM_DRIVES`: la sinusal mueve la aurícula de un bloqueo completo, la automaticidad los focos (escape, taquicardia ventricular) y la conducción AV el grado de bloqueo del flutter; un paciente inventado responde igual, con su aurícula, su escape y su bloqueo. El efecto va en escalones del 5 % porque cada cambio de mando reconstruye la fuente, y el pulso que se publica es el que genera el motor, no el que calcula la farmacología.

**La hemodinámica pasa por `circulation_adjusted`** antes de publicarse, que la corrige con el perfil mecánico del ritmo: sin sístole ventricular no hay tensión, ni gasto, ni respiración, por mucho que la farmacología sepa calcularlas.

**La fisiología vive en `MechanicalProfile`**, no en el cliente. Los instantes del ciclo los manda el servidor —cuatro por sístole para las válvulas, no dos, porque entre el cierre auriculoventricular y la apertura de las sigmoideas hay contracción y relajación isovolumétricas—; del cliente es solo cómo transcurre el viaje entre esos instantes. La patada auricular es la sístole auricular leída de la misma línea temporal, así que una fibrilación auricular se lleva la onda A por delante sin ningún caso especial.

**Las valvas se validan contra dos pieles** —el órgano con miocardio y lo que se ve por defecto sin él— y en **siete puntos del recorrido**, compuestos con la misma cuenta que hace la GPU. Validar contra una sola piel, o solo en las dos poses extremas, da por bueno lo que al usuario se le ve asomar: ha fallado así dos veces. Los ángulos no se escriben a mano, se buscan contra dos propiedades comprobables: que ninguna valva se vea desde fuera y que cerrada no deje pasar por el orificio.

**La escala del trazado la negocian las dos dimensiones**, no solo el ancho. El papel encoge —milímetro más pequeño, cuadrícula igual de cuadrada, los mismos 250 mm a lo ancho— hasta que los 40 mm de tira a 10 mm/mV caben en el alto disponible, y solo si ni al mínimo de escala caben se baja la ganancia. Sacarla del ancho a secas descarta de oficio la ganancia estándar. El reparto lo calcula `computeLayoutMetrics` (`apps/web/src/render/layout-engine.ts`, campo `ecgWidthPx`), y el sobrante horizontal es del corazón 3D, no una franja vacía. En esa columna manda el inspector: pide primero su alto natural y el escenario scrollea con lo que quede, con suelo de 220 px.

**Golden signals en tres niveles.** Si cambia la señal de un ritmo, es cambio intencional o es regresión. No hay tercera opción.

**El esquema de base de datos es portable.** Con `with_variant`, Postgres recibe `JSONB` y `UUID` nativos y SQLite `JSON` y `CHAR(32)`; los tests corren contra los dos (`ECG_TEST_DB=postgres|sqlite`). Y hay modo degradado: la aplicación arranca sin base de datos, `/api/health` lo declara en `persistence` y `/api/sessions` responde 503 con el motivo.

**La lógica clínica no vive en la UI.** Vive en especificaciones, tests, datasets y reglas versionadas. Los escenarios se diseñan como especificaciones declarativas —estado inicial, eventos, condiciones, transiciones, resultados esperados—, no como pantallas, y nada se simula con `if/else` disperso. Claude no es fuente de verdad clínica.

## Catálogo

Doce ritmos más `custom_patient`, que no es un ritmo sino un hueco que rellena el usuario: lo eléctrico viaja como `PatientSpec` (`packages/ecg-engine/src/ecg_engine/patient.py`) dentro de `EngineParams` y lo hemodinámico alimenta el basal del motor farmacológico; la API reparte las dos mitades. Los intervalos se cumplen: pedir un QRS de 140 ms produce una señal en la que `measure` mide 140. La plantilla de latido se reconstruye del propio `template_id`, que lleva la especificación escrita dentro (`custom_beat.py`), así que no hay registro global que crezca ni golden que pierda su significado.

`heart_rate_hz` significa siempre lo mismo, el pulso ventricular. Tres ritmos tienen dos marcapasos y no caben en una sola frecuencia, así que declaran los suyos en `rhythm_parameters` y el motor **calcula** el ventricular (`derived_rate_hz`) en vez de aceptarlo: el flutter (aurícula y grado de bloqueo), la taquicardia ventricular (su foco) y el bloqueo completo (sinusal y escape por separado). La fibrilación ventricular sí es de frecuencia fija, que ahí es verdad clínica.
