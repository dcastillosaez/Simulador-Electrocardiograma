# Simulador de ECG — Requisitos del sistema

> Documento de referencia único: qué hace la aplicación, con qué fundamento
> clínico, cómo se comporta como simulador y qué test demuestra cada cosa.
>
> Fecha: 31 de agosto de 2026 · rama `research/corazon-3d-fma7274`
> · motor de ECG 1.0.0 · motor farmacológico 1.0.0 · heart-engine 0.1.0 · API 0.1.0

---

## 0. Uso previsto y aviso regulatorio

**RG-1 — Uso docente.** El producto es un simulador formativo. No es un
dispositivo médico y no está destinado al diagnóstico ni al tratamiento de
pacientes. El paciente es sintético y la señal la genera un motor; no se tratan
datos clínicos de personas reales.

**RG-2 — El aviso viaja con el producto.** La declaración aparece en la barra de
estado mientras se usa la aplicación y se estampa dentro de cada PNG exportado,
porque una captura se reenvía y acaba lejos de la ventana que la generó.

*Implementación:* `apps/web/src/ui/intended-use.ts`, incrustado por
`apps/web/src/render/dom-snapshot.ts`.
*Verificación:* `apps/web/src/render/dom-snapshot.test.ts` → `buildSvgMarkup`;
`apps/desktop/src-tauri/tests/sin_conexiones_salientes.rs` →
`el_documento_de_instalacion_sigue_prometiendo_lo_mismo`.

---

## 1. Alcance y arquitectura

### 1.1 Capas

| Capa | Dónde vive | Responsabilidad |
|---|---|---|
| Motor fisiológico de señal | `packages/ecg-engine/` | Genera 12 derivaciones a partir de ritmo, conducción, morfología, eje y ruido |
| Motor farmacológico | `packages/pharmacology-engine/` | Curvas concentración-tiempo, efectos, acumulación e interacciones → `PhysiologyState` |
| Motor mecánico | `packages/heart-engine/` | Traduce eventos eléctricos a ventanas de contracción por cámara |
| API y streaming | `apps/api/` | REST del catálogo + WebSocket binario, medidas, persistencia |
| Interfaz clínica | `apps/web/` + `packages/ui-system/` | Puesto de simulación: trazado, medición, paneles, corazón 3D |
| Envoltura de escritorio | `apps/desktop/` (Tauri 2 + Rust) | Ventana nativa, ciclo de vida del backend, licencia, actualizaciones |

### 1.2 Reglas de arquitectura exigibles

**RA-1 — Los motores no se conocen.** `pharmacology-engine` no importa nada de
`ecg_engine`; el único objeto que cruza la frontera es `PhysiologyState`, y el
único punto donde ese estado se traduce a parámetros de señal es
`apps/api/src/ecg_api/pharmacology/projection.py`.
*Test:* `pharmacology-engine/tests/unit/test_decoupling.py` →
`test_ningun_modulo_importa_el_motor_de_ecg`, `test_el_paquete_no_arrastra_numpy`.

**RA-2 — La clínica es dato, no código.** Añadir un ritmo es añadir una
`RhythmDefinition` a `catalog/definitions.py`; añadir una molécula es añadir un
YAML a `pharmacology_engine/catalog/data/`. Ningún ritmo puede obligar a
escribir una condición fuera del catálogo.
*Tests:* `ecg-engine/tests/unit/test_catalog.py` →
`test_no_rhythm_specific_branching_in_the_engine`;
`pharmacology-engine/tests/unit/test_catalog.py` →
`test_la_biblioteca_base_esta_completa`.

**RA-3 — Un solo lugar por contrato.** Los tipos que cruzan módulos viven en
`ecg_engine/types.py` y `pharmacology_engine/models.py`, y en ningún otro sitio.
*Test:* `ecg-engine/tests/unit/test_types.py` (10 casos).

**RA-4 — Unidades SI dentro, unidades clínicas en la frontera.** Segundos,
voltios y hercios en el motor; milisegundos, milivoltios y lpm solo al publicar.
El frontend nunca calcula un intervalo: recibe milisegundos y los pinta.
*Test:* `apps/api/tests/unit/test_measuring.py` →
`test_it_reports_the_intervals_in_milliseconds`.

---

## 2. Requisitos médicos y fisiológicos

### 2.1 Morfología del latido

**RM-1 — Latido por composición de gaussianas.** Cada onda (P, Q, R, S, ST, T)
es una gaussiana con amplitud, centro y anchura; el latido es su suma. Las
patologías morfológicas se obtienen moviendo esos parámetros, nunca dibujando
una curva a mano.
*Tests:* `test_waveform.py` (6) → `test_gaussian_peaks_at_center_with_given_amplitude`,
`test_gaussian_fwhm_matches_analytic_value`, `test_fwhm_is_2_sqrt_2_ln2_times_sigma`,
`test_render_component_shifts_by_event_offset`.

**RM-2 — Plantillas del MVP.** Seis plantillas cerradas: `sinus_p`, `flutter_f`,
`af_f` (auriculares) y `normal_qrst`, `wide_qrst`, `escape_qrst` (ventriculares).
La auricular solo contiene componentes P; la ventricular contiene QRS, ST y T.
*Tests:* `test_beat.py` → `test_registry_contains_the_mvp_templates`,
`test_atrial_template_only_has_p_components`,
`test_ventricular_template_has_qrs_st_and_t`.

**RM-3 — Duraciones fisiológicas por plantilla.** El QRS normal es estrecho, el
ancho supera 120 ms y el QT cae en rango fisiológico. La onda R es la deflexión
positiva dominante y es aguda, no ancha.
*Tests:* `test_beat.py` → `test_normal_qrs_duration_is_physiological`,
`test_wide_qrs_exceeds_120_ms`, `test_normal_qt_is_physiological`,
`test_r_wave_is_the_dominant_positive_deflection`, `test_r_wave_is_sharp_not_broad`,
`test_wide_qrs_really_is_broad_at_half_height`.

### 2.2 Las doce derivaciones

**RM-4 — Orden canónico invariable.** `I, II, III, aVR, aVL, aVF, V1…V6`. Toda
señal del sistema es un array `(12, n)` en `float64` y en ese orden.
*Tests:* `test_types.py` → `test_lead_order_is_canonical_and_frozen`;
`test_renderer.py` → `test_output_is_always_float64_and_twelve_leads`.

**RM-5 — Ley de Einthoven.** I + III = II en todo el rango de ejes, no solo en el
eje de referencia.
*Tests:* `test_leads.py` → `test_einthoven_law_holds_for_the_limb_leads`,
`test_einthoven_is_a_theorem_over_the_whole_range`.

**RM-6 — Derivaciones aumentadas por definición.** aVR, aVL y aVF se derivan de
las bipolares, y aVR es negativa en todo el rango normal.
*Tests:* `test_leads.py` → `test_augmented_leads_follow_their_definitions`,
`test_avr_is_negative_under_a_normal_axis`,
`test_avr_is_negative_across_the_normal_range`;
`test_renderer.py` → `test_avr_is_negative_for_a_normal_qrs`.

**RM-7 — Progresión de la onda R.** Crecimiento monótono de V1 a V5, con complejo
netamente negativo en V1-V2 y transición en V3.
*Test:* `test_leads.py` → `test_precordial_progression_is_monotonic_from_v1_to_v5`.

**RM-8 — Ninguna derivación perfectamente isoeléctrica.** El eje de referencia se
fija en +50° y no en +60° precisamente porque a 60° exactos aVL sale cero exacto,
algo que no ocurre en ningún paciente real y que salta a la vista en papel.
*Test:* `test_leads.py` → `test_no_lead_is_perfectly_isoelectric`.

**RM-9 — Proyección auricular distinta de la ventricular.** La P no se proyecta
con la tabla del QRS.
*Tests:* `test_leads.py` → `test_atrial_projection_differs_from_ventricular`,
`test_projection_for_axis_reproduces_the_atrial_table`;
`test_renderer.py` → `test_atrial_and_ventricular_events_use_different_projections`.

**RM-10 — Amplitud de referencia.** La R en II ronda 1 mV con el eje normal, que
es la referencia de escala de toda la cadena de ruido y de la calibración
visual.
*Test:* `test_renderer.py` → `test_r_amplitude_in_lead_ii_is_about_one_millivolt`.

### 2.3 Eje eléctrico

**RM-11 — Eje paramétrico con desfase por onda.** `AxisParams` declara la
orientación anatómica y un desfase propio por onda. El eje efectivo de cada onda
es orientación + desfase: un hemibloqueo mueve solo el QRS y la isquemia solo el
ST, sin desincronizar nada y sin estado duplicado.

| Parámetro | Rango | Por defecto |
|---|---|---|
| `orientation_deg` | −180 … 180 | 50,0 |
| `p_offset_deg` | −45 … 45 | 3,4 |
| `qrs_offset_deg` | −90 … 90 | 0,0 |
| `st_offset_deg` | −180 … 180 | 0,0 |
| `t_offset_deg` | −180 … 180 | 0,0 |

*Tests:* `test_leads.py` → `test_projection_for_axis_reproduces_the_normal_qrs_table`,
`test_st_and_t_share_the_qrs_projection_at_zero_offset`,
`test_a_qrs_offset_moves_only_the_qrs_projection`,
`test_reference_axis_uses_the_literal_validated_tables`;
`test_engine.py` → `test_rotating_the_axis_changes_limb_leads_not_precordials`,
`test_clamped_axis_respects_the_catalog_ranges`;
`test_catalog.py` → `test_every_rhythm_exposes_the_axis_ranges`,
`test_axis_ranges_match_the_design_limits`.

**RM-12 — Zonas del eje.** Normal, desviación izquierda, desviación derecha y
desviación extrema, clasificadas por ángulo normalizado y cubriendo la
circunferencia entera sin huecos.
*Tests:* `test_leads.py` → `test_left_axis_deviation_signature`,
`test_right_axis_deviation_signature`, `test_zone_boundaries_are_testable_one_by_one`,
`test_zone_for_normalizes_before_classifying`,
`test_zones_cover_the_whole_circle_without_gaps`.
*Espejo en cliente, con test de contrato que obliga al TypeScript a coincidir con
el motor:* `apps/web/src/ui/AxisControl/axis-zones.test.ts`.

### 2.4 Catálogo de ritmos

**RM-13 — Trece entradas: doce hallazgos clínicos auditados y un paciente
personalizado.** Cada entrada declara su contrato completo: fuente, política de
conducción, frecuencia ventricular, si el PR es medible, actividad auricular,
perfil mecánico, overlays admitidos, descripción clínica y referencias
bibliográficas (guías ESC/AHA y Chou's Electrocardiography).

| id | Nombre | Categoría | FC de mando | Rango editable (lpm) | PR medible | Actividad auricular | Mandos propios |
|---|---|---|---|---|---|---|---|
| `sinus_normal` | Ritmo sinusal normal | sinus | 70 | 60–100 | sí | organizada | — |
| `sinus_tachycardia` | Taquicardia sinusal | sinus | 120 | 101–180 | sí | organizada | — |
| `sinus_bradycardia` | Bradicardia sinusal | sinus | 48 | 30–59 | sí | organizada | — |
| `atrial_fibrillation` | Fibrilación auricular | supraventricular | 80 | 50–180 | **no** | **fibrilatoria** | — |
| `atrial_flutter` | Flutter auricular | supraventricular | 150 (derivada) | fija | **no** | organizada | aurícula 250–350; conducción 2:1–4:1 |
| `svt` | Taquicardia supraventricular | supraventricular | 180 | 150–250 | sí (PR 90 ms) | organizada | — |
| `ventricular_tachycardia` | Taquicardia ventricular | ventricular | 180 (derivada) | fija | **no** | organizada, disociada | foco 100–250 |
| `ventricular_fibrillation` | Fibrilación ventricular | ventricular | 0 (fija) | fija | **no** | **ausente** | — |
| `av_block_first` | Bloqueo AV de 1.er grado | bloqueo | 70 | 45–100 | sí (PR 260 ms) | organizada | — |
| `av_block_second_mobitz_i` | Bloqueo AV 2.º grado, Mobitz I | bloqueo | 75 (sinusal) | 50–100 | sí | organizada | — |
| `av_block_third` | Bloqueo AV completo | bloqueo | 40 (escape) | fija | **no** | organizada, disociada | sinusal 60–100; escape 20–45 |
| `stemi_inferior` | IAM inferior con elevación del ST | isquemia | 78 | 50–120 | sí | organizada | overlay `st_elevation_inferior` |
| `custom_patient` | Paciente personalizado | custom | 70 | 0–400 | según especificación | según especificación | `PatientSpec` completa |

*Tests de catálogo (39 casos en `test_catalog.py`), entre ellos:*
`test_catalog_contains_exactly_the_twelve_mvp_rhythms`,
`test_the_custom_patient_is_offered_alongside_the_catalogue`,
`test_every_rhythm_declares_its_full_contract`,
`test_every_rhythm_renders_twelve_leads`,
`test_every_rhythm_produces_a_non_flat_trace`,
`test_every_rhythm_is_deterministic_for_a_given_seed`,
`test_default_rates_are_clinically_correct`,
`test_editable_rate_ranges_are_bounded_by_physiology`,
`test_declared_pulse_matches_the_signal`,
`test_rhythms_without_a_pr_declare_it`,
`test_declared_pr_matches_what_the_measurement_reports`;
y `test_engine.py` → `test_every_catalog_rhythm_drives_the_engine`.

**RM-14 — Frecuencia de mando ≠ pulso.** `heart_rate_hz` significa siempre el
pulso ventricular. En flutter, taquicardia ventricular y bloqueo completo ese
pulso es una **consecuencia** (`derived_rate_hz`) de los mandos propios del
ritmo, no un número que el usuario escriba: la aurícula partida por el grado de
bloqueo, el foco ventricular, el escape. Mostrar 75 lpm en un bloqueo AV completo
cuyo paciente tiene un pulso de 40 es el error que esta separación existe para
impedir.
*Tests:* `test_catalog.py` →
`test_the_pulse_of_a_flutter_is_the_quotient_of_its_two_controls`,
`test_only_wenckebach_keeps_a_command_that_is_not_the_pulse`,
`test_a_complete_block_moves_its_two_pacemakers_apart`,
`test_moving_the_sinus_node_does_not_touch_the_escape`,
`test_the_ventricular_focus_beats_at_what_it_is_told`;
`apps/api/tests/unit/test_simulation_manager.py` →
`test_the_pulse_of_a_complete_block_is_its_escape`,
`test_a_flutter_conducts_what_its_controls_say`,
`test_moving_a_rhythm_control_in_flight_changes_the_pulse`;
`apps/api/tests/unit/test_ws_schemas.py` →
`test_the_start_acknowledgement_carries_the_resolved_pulse`.

**RM-15 — Mandos propios validados y filtrados.** Los valores fuera del rango
declarado se recortan; los mandos que ese ritmo no declara se descartan en vez de
guardarse como si hubieran hecho algo. Cambiar un mando estructural reconstruye
la fuente sin tocar el reloj.
*Tests:* `test_catalog.py` → `test_values_outside_the_clinical_range_are_clipped`,
`test_a_control_that_does_not_exist_in_this_rhythm_is_ignored`,
`test_changing_a_control_rebuilds_the_source_in_place`,
`test_only_three_rhythms_declare_their_own_controls`;
`apps/api/tests/integration/test_simulation_ws.py` →
`test_a_rhythm_control_outside_its_range_is_clipped_not_rejected`,
`test_a_flutter_can_be_conducted_four_to_one_over_the_socket`.

**RM-16 — Fibrilación auricular con actividad caótica, no flutter rápido.** Ondas
f a 420/min con jitter del 30 % y conducción AV irregular (RR medio 0,75 s,
dispersión 0,20 s). Con un tren regular la línea de base salía como un serrucho
perfecto, que es justo la morfología del flutter.
*Tests:* `test_catalog.py` → `test_atrial_fibrillation_has_irregular_rr`,
`test_fibrillation_waves_are_irregular_unlike_flutter`,
`test_fibrillation_waves_are_smaller_than_flutter_waves`;
`test_measurements.py` → `test_rr_standard_deviation_is_large_in_atrial_fibrillation`.

**RM-17 — Disociación AV real en la taquicardia ventricular.** Las aurículas
siguen en sinusal a 75/min, sin relación con el foco ventricular: eso *es* la
disociación que distingue una TV de una supraventricular conducida con
aberrancia.
*Tests:* `test_catalog.py` → `test_ventricular_tachycardia_is_genuinely_dissociated`,
`test_third_degree_block_produces_dissociated_trains`;
`test_measurements.py` → `test_ventricular_tachycardia_is_dissociated`,
`test_ventricular_tachycardia_has_slow_atria_and_fast_ventricles`.

**RM-18 — La fibrilación ventricular no tiene frecuencia.** Fuente sin eventos
discretos, sin línea isoeléctrica, con energía en su banda dominante (≈6 Hz) y
sin control de frecuencia ofrecido en la interfaz.
*Tests:* `test_sources.py` → `test_ventricular_fibrillation_has_no_discrete_events`,
`test_ventricular_fibrillation_energy_sits_in_its_dominant_band`,
`test_fibrillation_has_no_isoelectric_baseline`,
`test_coarse_fibrillation_has_larger_excursions_than_fine`,
`test_ventricular_fibrillation_is_continuous_across_chunks`;
`test_catalog.py` → `test_ventricular_fibrillation_exposes_no_rate_control`;
`test_measurements.py` → `test_ventricular_fibrillation_reports_neither`.

### 2.5 Conducción auriculoventricular

**RM-19 — Cinco políticas de conducción declarativas.**

| Política | Comportamiento clínico |
|---|---|
| `FixedPR` | Conduce toda P con el mismo PR. Con PR largo *es* el bloqueo de primer grado |
| `WenckebachPR` | El PR se alarga latido a latido hasta que una P no conduce; tras la pausa vuelve al basal |
| `FixedRatioBlock` | Conduce una de cada N (2:1, 3:1, 4:1); rechaza ratios menores de 2 |
| `CompleteBlock` | No conduce nada; el ventrículo late por su ritmo de escape |
| `IrregularConduction` | Respuesta ventricular irregularmente irregular, sin depender de los eventos auriculares |

**RM-20 — La conducción es determinista e independiente del troceado.** Un
Wenckebach calcula su PR a partir del índice absoluto del evento, no de cuántas
veces se le ha llamado: pedir la señal entera o por trozos da el mismo resultado
bit a bit.
*Tests (20 en `test_conduction.py`):* `test_wenckebach_lengthens_pr_until_a_beat_drops`,
`test_wenckebach_resets_pr_after_the_dropped_beat`,
`test_wenckebach_is_independent_of_chunk_boundaries`,
`test_fixed_ratio_block_conducts_one_in_n`, `test_fixed_ratio_block_supports_four_to_one`,
`test_fixed_ratio_block_rejects_a_ratio_below_two`, `test_complete_block_conducts_nothing`,
`test_irregular_conduction_is_deterministic_for_a_given_seed`,
`test_irregular_conduction_survives_chunks_shorter_than_its_beats`,
`test_irregular_conduction_indices_are_absolute_not_per_window`,
`test_irregular_conduction_rate_change_affects_only_future_beats`.

### 2.6 Medidas fisiológicas

**RM-21 — Dos frecuencias, siempre.** El sistema publica frecuencia auricular y
ventricular por separado. El pulso del paciente —lo que un clínico llama
frecuencia cardíaca— es siempre la ventricular. En un ritmo sinusal la distinción
parece pedante; en un bloqueo completo, decir «la frecuencia» sin apellido es
decir un número que no describe a nadie.
*Tests:* `test_measurements.py` → `test_sinus_rhythm_conducts_one_to_one`,
`test_complete_block_shows_atria_faster_than_ventricles`,
`test_atrial_flutter_beats_twice_per_qrs`,
`test_atrial_fibrillation_reports_no_atrial_rate`;
`apps/api/tests/unit/test_measuring.py` →
`test_sinus_rhythm_publishes_both_rates_and_a_one_to_one`,
`test_complete_block_publishes_two_different_rates`;
`apps/web/src/ui/WorkspaceInspector.test.tsx` → bloque «las dos frecuencias» (7).

**RM-22 — Medidas publicadas.** `atrial_rate_hz`, `ventricular_rate_hz`,
`rr_mean_s`, `rr_std_s`, `pr_mean_s`, `qrs_duration_s`, `qt_s` y
`r_amplitude_lead_ii_v`, más el QTc de Bazett y la relación AV como lecturas
derivadas. Los tiempos se miden sobre los **eventos**, no detectando picos en una
señal con ruido: aquí lo que se verifica es la fisiología que el motor pretende
generar.
*Tests:* `test_measurements.py` (37 casos), `test_measuring.py` (18 casos).

**RM-23 — Lo no medible viaja como hueco, nunca como número inventado.** No hay
PR cuando el ritmo no lo tiene (FA, flutter, TV, bloqueo completo) ni cuando la
dispersión de los intervalos P-QRS supera 50 ms sin patrón periódico. El motor
devuelve NaN y la API lo publica como `null`. Un PR de 49,8 ms para una FA es un
número perfectamente calculado y clínicamente inexistente.
*Tests:* `test_measurements.py` → `test_complete_block_reports_no_measurable_pr`,
`test_mixed_ventricular_morphologies_report_no_single_qrs`,
`test_measurements_without_events_report_nan_timings`;
`test_measuring.py` → `test_a_non_measurable_value_travels_as_null_and_not_as_nan`,
`test_atrial_fibrillation_has_a_hole_with_a_reason`,
`test_it_survives_a_rhythm_without_discrete_events`.

**RM-24 — Wenckebach se lee como conducción, no como disociación.** El detector
reconoce patrones periódicos de hasta 6 latidos; sin eso, la dispersión sola
confundía un ritmo perfectamente conducido con una disociación. El mismo tope
limita el ciclo de Wenckebach admitido en el paciente personalizado.
*Tests:* `test_measurements.py` → `test_wenckebach_drops_one_beat_in_four`,
`test_complete_block_is_dissociated`;
`test_patient.py` → `test_wenckebach_reads_as_conduction_and_not_as_dissociation`,
`test_a_wenckebach_cycle_longer_than_the_reading_allows_is_refused`.

**RM-25 — Relación AV en forma de informe.** `"1:1"`, `"2:1"`, `"4:3"`…;
`"variable"` cuando hay conducción sin proporción estable; `"dissociated"` cuando
nadie manda; `null` cuando falta una de las dos frecuencias. Los términos se
limitan a 6 y se admite un 3 % de error relativo, para no publicar jamás un
`22:3`.
*Tests:* `test_measurements.py` → `test_atrial_flutter_is_two_to_one`,
`test_first_degree_block_still_conducts_every_beat`,
`test_atrial_fibrillation_has_no_relationship_to_state`,
`test_a_ratio_nobody_would_write_is_variable`, `test_missing_rates_report_nothing`;
`test_measuring.py` → `test_atrial_flutter_publishes_its_two_to_one_conduction`,
`test_complete_block_is_reported_as_dissociated`.

**RM-26 — QTc por Bazett.** `QTc = QT / √RR`. Se usa a sabiendas de que
sobrecorrige en los extremos: es la fórmula de los monitores de cabecera y la que
el alumno se va a encontrar en la planta. Un valor no medible se propaga como no
medible.
*Tests:* `test_measurements.py` → `test_at_sixty_bpm_the_correction_is_the_identity`,
`test_tachycardia_stretches_the_qt`, `test_bradycardia_shrinks_the_qt`,
`test_a_non_measurable_input_stays_non_measurable`,
`test_a_degenerate_rr_is_not_measurable`, `test_it_corrects_the_qt_of_a_real_simulation`;
`test_measuring.py` → `test_it_includes_the_corrected_qt`.

**RM-27 — La actividad auricular se declara, no se deduce.** `ORGANIZED`,
`FIBRILLATORY` o `ABSENT`. Contar los eventos auriculares de una FA da 420/min,
que no es una frecuencia auricular sino el ruido de una aurícula que no se
contrae; un informe dice «actividad fibrilatoria». El flutter sí cuenta: sus
ondas F a 300/min son un hallazgo diagnóstico de primera línea.
*Tests:* `test_catalog.py` → `test_fibrillation_declares_no_measurable_pulse`;
`test_measuring.py` → `test_ventricular_fibrillation_has_neither_rate`;
`apps/web/src/ui/WorkspaceInspector.test.tsx` (etiqueta «Fibrilatoria» / «Ausente»
en lugar de un guion, que se leería como fallo del simulador).

### 2.7 Mecánica cardíaca

**RM-28 — Perfil mecánico por ritmo.** Cada ritmo declara qué hacen sus dos
cámaras: modo (`SYNCHRONOUS`, `FLUTTERING`, `FIBRILLATING`, `ABSENT`), amplitud
relativa (0–1), duración de sístole auricular (0,11 s, constante y no
dependiente de la frecuencia), fracción sistólica ventricular (0,4 del RR) y
frecuencia de temblor.

| Ritmo | Aurícula | Ventrículo |
|---|---|---|
| Los ocho «normales» | síncrona, 1,0 | síncrono, 1,0 |
| Fibrilación auricular | fibrilando, 0,06 a 7 Hz | síncrono, 1,0 |
| Flutter auricular | temblando, 0,18 a 5 Hz | síncrono, 1,0 |
| Taquicardia ventricular | síncrona, 0,5 | síncrono, 0,55 (mal llenado) |
| Fibrilación ventricular | fibrilando, 0,05 | fibrilando, 0,10 a 6 Hz |

*Tests:* `test_mechanics.py` (7) →
`test_todo_ritmo_del_catalogo_declara_su_perfil_mecanico`,
`test_fibrilacion_auricular_no_tiene_sistole_auricular_efectiva`,
`test_fibrilacion_ventricular_no_tiene_sistole`,
`test_bloqueo_completo_conserva_ambas_contracciones`,
`test_amplitudes_en_rango_unitario`, `test_duraciones_positivas`.

**RM-29 — De evento eléctrico a ventana de contracción.** `heart-engine` traduce
cada evento en un `MechanicalEvent` con inicio, pico (al 45 % de la ventana: el
corazón se contrae más deprisa de lo que se relaja) y final. La sístole auricular
empieza con el inicio de la onda P, no en su pico; la ventricular escala con el
RR. Una cámara fibrilando o ausente no produce eventos discretos.
*Tests:* `heart-engine/tests/test_events.py` (11) →
`test_la_sistole_auricular_empieza_con_la_onda_p_no_en_su_pico`,
`test_la_sistole_auricular_dura_lo_que_dice_el_perfil`,
`test_la_sistole_ventricular_escala_con_el_intervalo_rr`,
`test_el_pico_cae_dentro_de_la_ventana`,
`test_una_camara_fibrilando_no_produce_eventos_discretos`,
`test_una_camara_ausente_no_produce_eventos`,
`test_la_disociacion_av_conserva_ambos_trenes_independientes`,
`test_se_conserva_el_indice_del_evento_electrico`.

**RM-30 — Estado mecánico vigente.** Lo que no cabe en un evento —«esta aurícula
no se va a contraer, va a fibrilar a 7 Hz»— viaja como mensaje `heart_state` con
un mapa abierto de valores, para que la hemodinámica futura entre sin romper a
ningún cliente anterior.
*Tests:* `heart-engine/tests/test_heart_state.py` (5);
`apps/api/tests/test_cardiac.py` (8) →
`test_la_fibrilacion_ventricular_no_produce_eventos_pero_si_estado`,
`test_el_estado_lleva_el_ritmo_activo`,
`test_los_eventos_publicados_son_de_senal_ya_generada`,
`test_arrancar_otro_ritmo_reinicia_la_ventana_de_publicacion`.

### 2.8 Variabilidad fisiológica (señal del paciente, no ruido)

**RM-31 — Un solo oscilador respiratorio.** La arritmia sinusal respiratoria y la
variación de amplitud latido a latido salen del mismo oscilador (0,25 Hz por
defecto), porque eso es lo que ocurre de verdad: el trazo respira de forma
coherente en lugar de temblar al azar. En el pico inspiratorio el RR se
**acorta** (reflejo de Bainbridge). Valores por defecto: RSA 4 %, amplitud 3 %,
jitter RR 1,5 %.
*Tests:* `test_variability.py` (9) →
`test_rr_modulation_follows_the_same_respiratory_oscillator`,
`test_amplitude_and_rr_respond_to_the_same_oscillator`,
`test_rr_never_goes_non_positive`, `test_rr_is_deterministic_for_a_given_seed`;
`test_renderer.py` → `test_variability_modulates_amplitude_without_moving_the_peak`.

### 2.9 Overlays morfológicos

**RM-32 — Un overlay modifica morfología, jamás ritmo.** No crea, elimina ni
reordena eventos. Declara qué componentes toca y en qué derivaciones, y el motor
lo hace cumplir: una regla fuera del alcance declarado es un error de
construcción, no un aviso. Sin esa barrera, un overlay de isquemia acabaría
alterando de rebote la onda P y el trazo seguiría pareciendo plausible.
*Tests:* `test_overlays.py` (10) →
`test_overlay_rejects_a_rule_outside_its_declared_targets`,
`test_overlay_rejects_unknown_leads`, `test_overlay_requires_at_least_one_lead`,
`test_lead_mask_is_one_for_affected_leads_and_zero_elsewhere`;
`test_renderer.py` → `test_overlay_only_touches_its_declared_leads`,
`test_overlay_does_not_apply_to_atrial_events`,
`test_overlay_raises_the_st_segment_above_baseline`.

**RM-33 — IAM inferior.** Elevación del ST de 0,2 mV (2 mm a calibración
estándar, el doble del umbral diagnóstico) en II, III y aVF, sobre ritmo sinusal.
No es un ritmo distinto: es sinusal más un overlay, y ese patrón es el que servirá
para pericarditis y trastornos electrolíticos.
*Tests:* `test_overlays.py` → `test_inferior_infarct_elevates_st_in_the_inferior_leads`,
`test_st_elevation_amplitude_is_clinically_significant`;
`test_catalog.py` → `test_only_stemi_declares_the_st_elevation_overlay`.

### 2.10 Paciente personalizado

**RM-34 — El paciente se describe, no se programa.** `PatientSpec` declara lo
eléctrico; viaja con los parámetros de la sesión, se guarda con nombre y se
recarga desde el editor. Lo hemodinámico —tensión, respiración, volumen
sistólico— no está aquí: es el basal del motor farmacológico, y la API compone las
dos mitades.

| Campo | Rango admitido | Por defecto |
|---|---|---|
| `atrial_rate_bpm` | 0–400 (0 = aurícula silente) | 70 |
| `av_conduction` | `conducted` / `ratio` / `wenckebach` / `complete_block` | `conducted` |
| `conduction_ratio` | ≥ 2 (tope 6 en el contrato de la API) | 2 |
| `wenckebach_cycle` | 2–6 | 4 |
| `wenckebach_increment_ms` | — | 50 |
| `escape_rate_bpm` | 0–400 | 40 |
| `pr_ms` | 80–600 | 160 |
| `qrs_ms` | rango del motor; siempre menor que `qt_ms` | 90 |
| `qt_ms` | rango del motor | 400 |
| `st_shift_mv` | −1,0 … 1,0 (positivo es elevación) | 0,0 |
| `t_amplitude_scale` | −3,0 … 3,0 (negativo invierte la T) | 1,0 |
| `p_amplitude_scale` | 0,0 … 3,0 (0 borra la P sin quitar la despolarización) | 1,0 |

**RM-35 — Los intervalos pedidos se cumplen.** Pedir un QRS de 140 ms produce una
señal en la que `measure` mide 140 ms. Un QT menor que su propio QRS se rechaza:
no es un paciente enfermo, es una descripción imposible que pintaría la T dentro
del complejo.
*Tests (25 en `test_patient.py`):* `test_the_qrs_lasts_what_was_asked`,
`test_the_qt_lasts_what_was_asked`,
`test_the_measurement_over_the_generated_signal_agrees`,
`test_a_qt_shorter_than_its_own_qrs_is_refused`,
`test_a_wide_qrs_is_drawn_as_ventricular_not_as_a_stretched_normal`,
`test_an_inverted_t_flips_the_wave`,
`test_st_elevation_lifts_the_segment_by_what_was_asked`,
`test_the_st_sits_between_the_qrs_and_the_t`,
`test_the_st_shift_reaches_the_twelve_leads`, `test_a_flattened_p_keeps_the_beat`,
`test_a_patient_outside_the_clinical_range_is_refused`.

**RM-36 — El pulso se deriva de la conducción descrita.** Una aurícula a 80 con
bloqueo 2:1 son 40 latidos; un Wenckebach de ciclo N conduce N−1 de cada N; sin
aurícula manda el escape; sin aurícula ni escape el paciente es una asistolia, y
su perfil mecánico lo dice en vez de publicar las constantes de alguien que
camina.
*Tests:* `test_patient.py` → `test_the_announced_rate_is_the_one_that_beats`,
`test_a_healthy_patient_conducts_one_to_one`,
`test_a_fixed_ratio_drops_the_beats_it_says`,
`test_a_complete_block_dissociates_and_beats_by_escape`,
`test_without_atria_the_ventricle_beats_alone`,
`test_a_conducted_rhythm_gets_no_escape_beats`,
`test_a_patient_without_beats_is_an_asystole`,
`test_an_escape_rhythm_has_ventricles_but_no_atrial_kick`,
`test_a_conducted_patient_pumps_normally`.

**RM-37 — La plantilla se reconstruye desde su propio identificador.** El
`template_id` lleva la especificación escrita dentro, así que no hay registro
global que crezca ni golden que pierda su significado.
*Tests:* `test_patient.py` → `test_the_same_numbers_produce_the_same_identifier`,
`test_the_identifier_survives_a_round_trip_through_text`,
`test_an_unreadable_identifier_says_so`.

---

## 3. Requisitos de farmacología

### 3.1 Catálogo

**RF-1 — Quince moléculas como datos.** Cada una es un YAML con identidad,
categoría, vías admitidas, unidad y dosis de referencia, techo acumulado,
tiempos (`onset_s`, `peak_s`, `duration_s`, `half_life_s`), efectos, nota
clínica y referencias. Añadir una molécula es añadir un archivo; si alguna vez
obliga a tocar código fuera de `catalog/data/`, la arquitectura ha fallado.

| Categoría | Moléculas |
|---|---|
| Antiarrítmicos | amiodarona, lidocaína, procainamida, adenosina, digoxina |
| Betabloqueantes | metoprolol, esmolol |
| Calcioantagonistas | verapamilo, diltiazem |
| Simpaticomiméticos | adrenalina, noradrenalina, dopamina, dobutamina |
| Parasimpaticolíticos | atropina |
| Electrolitos | sulfato de magnesio |

*Tests (17 en `pharmacology-engine/tests/unit/test_catalog.py`):*
`test_la_biblioteca_base_esta_completa`, `test_todas_las_categorias_tienen_representante`,
`test_toda_molecula_tiene_nota_y_referencias`, `test_toda_molecula_tiene_efecto`,
`test_tiempos_coherentes_en_todo_el_catalogo`, `test_campos_obligatorios`,
`test_via_desconocida`, `test_categoria_desconocida`,
`test_campo_de_efecto_desconocido`, `test_slope_en_campo_multiplicativo`,
`test_multiplier_en_campo_aditivo`,
`test_intensidad_maxima_es_el_techo_de_acumulacion`.

### 3.2 Cinética

**RF-2 — Curva concentración-tiempo con cuatro constantes explicables.** Sin
compartimentos, aclaramiento renal ni unión a proteínas —fuera de alcance
declarado—. Tres tramos: cero antes del inicio de acción, rampa suave
(`3x² − 2x³`, con derivada nula en los extremos, para que el efecto no entre con
un escalón visible) hasta el pico, y decaimiento exponencial de semivida
conocida, renormalizado para llegar a cero exactamente en `duration_s`.

**RF-3 — Función pura del tiempo.** Sin estado ni aleatoriedad: dos evaluaciones
en el mismo instante devuelven el mismo número bit a bit. Es la condición para
que el replay sea exacto.
*Tests (14 en `test_kinetics.py`):* `test_sin_efecto_antes_del_inicio`,
`test_pico_exacto_en_el_pico`, `test_cero_exacto_al_agotarse`,
`test_subida_monotona`, `test_bajada_monotona`, `test_continuidad_en_el_pico`,
`test_continuidad_al_final`, `test_semivida_gobierna_el_decaimiento`,
`test_activo_incluye_la_latencia`, `test_tiempos_incoherentes_fallan`.

### 3.3 Dinámica y estado fisiológico

**RF-4 — Dos clases de efecto con neutro distinto.** Los campos **aditivos**
llevan sufijo de unidad (`_ms`, `_bpm`, `_deg`, `_mv`, `_mmhg`) y su neutro es 0;
los **multiplicativos** no llevan sufijo y su neutro es 1. Esa distinción permite
superponer efectos sin una tabla de casos, y hace que sumar el efecto nulo sea
realmente la identidad.
*Tests (12 en `test_models.py`):* `test_combinar_nada_es_el_efecto_neutro`,
`test_el_neutro_es_identidad`, `test_aditivos_se_suman_multiplicativos_se_multiplican`,
`test_la_superposicion_es_conmutativa`, `test_escalar_a_cero_es_el_neutro`,
`test_medio_multiplicador_se_interpola_desde_uno`.

**RF-5 — `PhysiologyState` es la interfaz oficial entre motores.** Frecuencia,
frecuencia sinusal, automatismo, conducción (AV, auricular, ventricular), PR,
QRS, QT, eje, desplazamiento del ST, amplitud de la T, contractilidad, volumen
sistólico, presiones sistólica y diastólica, frecuencia respiratoria y consumo
de oxígeno, más gasto cardíaco y presión media derivados. Todo se recorta a
límites fisiológicos y las dos presiones se ordenan.
*Tests:* `test_models.py` → `test_clamp_recorta_a_los_limites`,
`test_clamp_ordena_las_presiones`, `test_gasto_cardiaco_derivado`,
`test_presion_media`, `test_as_dict_incluye_los_derivados`;
`test_dynamics.py` (11) → `test_ganancia_antes_que_desplazamiento`,
`test_el_qt_sigue_a_la_frecuencia_conservando_el_qtc`,
`test_delta_de_qt_se_aplica_tras_la_correccion`,
`test_el_resultado_siempre_esta_acotado`, `test_no_divide_por_cero`.

### 3.4 Acumulación, registro y replay

**RF-6 — Las dosis se acumulan con techo.** Una segunda dosis rellena la barra;
el techo es `max_cumulative_dose` y el orden de administración no altera el
resultado. El registro no se poda nunca: una administración agotada sigue
formando parte del replay y del registro clínico.
*Tests (21 en `test_engine.py`):* `test_dos_dosis_se_acumulan`,
`test_la_acumulacion_tiene_techo`, `test_una_segunda_dosis_rellena_la_barra`,
`test_farmacos_distintos_se_superponen`,
`test_el_orden_de_administracion_no_altera_el_resultado`,
`test_consultar_es_una_funcion_pura_del_tiempo`, `test_replay_reconstruye_el_estado`,
`test_el_registro_sobrevive_al_agotamiento`, `test_el_basal_se_puede_reencuadrar`,
`test_set_baseline_no_toca_el_registro`, `test_farmaco_desconocido`,
`test_via_no_admitida`, `test_dosis_no_positiva`.

### 3.5 Interacciones

**RF-7 — Seis reglas declarativas, no condicionales dispersos.**

| Regla | Efecto docente |
|---|---|
| `ccb_beta_blocker_av` | Calcioantagonista + betabloqueante: bloqueo AV sumado, mayor que la suma simple |
| `dual_qt_prolongation` | Dos fármacos que alargan el QT: prolongación aditiva |
| `digoxin_av_potentiation` | Digoxina + frenador nodal: bloqueo AV potenciado |
| `beta_blockade_blunts_atropine` | Betabloqueante + atropina: respuesta cronotrópica atenuada |
| `unopposed_alpha` | Betabloqueante + simpaticomimético: alfa sin oposición |
| `magnesium_rescues_qt` | Magnesio + fármaco que alarga el QT: acortamiento extra |

La intensidad de una regla es la del participante más débil, y una regla no se
dispara con intensidad cero.
*Tests (15 en `test_interactions.py`):* `test_calcioantagonista_y_betabloqueante`,
`test_el_bloqueo_av_combinado_supera_a_la_suma_simple`, `test_qt_doblemente_prolongado`,
`test_magnesio_rescata_el_qt`, `test_digoxina_potenciada`,
`test_el_betabloqueo_atenua_la_atropina`, `test_alfa_sin_oposicion`,
`test_la_intensidad_es_la_del_participante_mas_debil`,
`test_una_regla_no_se_dispara_con_intensidad_cero`,
`test_las_reglas_declaradas_son_validas`, `test_ids_de_regla_unicos`.

### 3.6 Comportamiento clínico esperado (golden farmacológicos)

**RF-8 — Cada molécula deja la huella que un docente espera.**
*Tests (16 en `tests/golden/test_golden_effects.py`):*
`test_atropina_sube_la_frecuencia`, `test_amiodarona_alarga_el_qt`,
`test_adenosina_bloquea_el_nodo_av`, `test_adenosina_se_agota_en_segundos`,
`test_adrenalina_sube_la_contractilidad`,
`test_noradrenalina_sube_la_presion_sin_taquicardizar`,
`test_dobutamina_sube_el_gasto_mas_que_la_presion`,
`test_betabloqueante_frena_y_baja_el_consumo`,
`test_verapamilo_frena_el_nodo_mas_que_el_seno`,
`test_procainamida_ensancha_el_qrs`, `test_lidocaina_no_alarga_el_qt`,
`test_magnesio_acorta_el_qt`, `test_digoxina_deja_la_cubeta_digitalica`,
`test_toda_molecula_deja_huella_en_su_pico`,
`test_todo_el_catalogo_deja_al_paciente_vivo`,
`test_la_sesion_vuelve_al_basal_cuando_todo_se_agota`.

### 3.7 Proyección al motor de señal

**RF-9 — Un único punto de traducción.** `projection.py` convierte
`PhysiologyState` en `EngineParams` conservando lo que el usuario mandó (ruido,
variabilidad, desfases del eje) y traduciendo solo lo que el fármaco cambia.
*Tests (11 en `apps/api/tests/unit/test_pharmacology_projection.py`):*
`test_el_basal_toma_la_frecuencia_de_mando`, `test_el_basal_toma_la_orientacion_del_eje`,
`test_la_proyeccion_conserva_ruido_y_variabilidad`,
`test_la_proyeccion_conserva_los_desfases_de_onda`, `test_ida_y_vuelta_sin_farmacos`,
`test_no_toca_lo_que_un_farmaco_todavia_puede_cambiar`.

**RF-10 — La hemodinámica se corrige por el perfil mecánico del ritmo.** Sin
sístole ventricular no hay tensión, ni gasto, ni respiración, por mucho que la
farmacología sepa calcularlas: una fibrilación ventricular publica una parada,
no las constantes de alguien que camina.
*Tests:* `test_pharmacology_projection.py` → `test_un_ritmo_que_bombea_no_se_toca`,
`test_una_fibrilacion_ventricular_no_tiene_tension_ni_respiracion`,
`test_una_fibrilacion_ventricular_no_tiene_gasto_ni_pulso`,
`test_la_fibrilacion_auricular_si_bombea`;
`apps/api/tests/unit/test_simulation_pharmacology.py` →
`test_una_fibrilacion_ventricular_publica_una_parada`,
`test_un_ritmo_que_bombea_conserva_sus_constantes`.

**RF-11 — Administrar cambia la señal, no el mando.** El fármaco actúa sobre el
motor sin mover el control de frecuencia que el usuario ve; el efecto se agota
solo; un `update` reencuadra el basal sin retirar los fármacos vigentes.
*Tests (17 en `test_simulation_pharmacology.py`):* `test_la_atropina_acelera_el_motor`,
`test_administrar_cambia_la_senal`, `test_el_mando_no_se_mueve_al_administrar`,
`test_el_efecto_se_agota_solo`,
`test_update_reencuadra_el_basal_sin_retirar_farmacos`,
`test_se_administra_en_el_reloj_de_simulacion`,
`test_el_payload_lleva_fisiologia_completa`, `test_las_interacciones_llegan_al_payload`,
`test_start_reinicia_la_farmacologia`;
`apps/api/tests/integration/test_pharmacology_ws.py` (8) →
`test_administer_pushes_pharmacology_immediately`,
`test_update_does_not_echo_the_drugged_rate`.

---

## 4. Requisitos del motor de simulación

**RS-1 — Determinismo por semilla.** La misma semilla con los mismos parámetros
reproduce la señal bit a bit; semillas distintas producen señales distintas.
*Tests:* `test_engine.py` → `test_same_seed_and_params_reproduce_the_signal_bit_for_bit`,
`test_different_seeds_produce_different_signals`;
`test_sources.py` → `test_two_sources_with_the_same_seed_render_identically`.

**RS-2 — El troceado no cambia la señal.** Pedir 10 s de una vez o cien trozos de
100 ms da el mismo resultado, sin discontinuidad en las juntas y con las
contribuciones de los latidos anteriores a la ventana incluidas.
*Tests:* `test_engine.py` → `test_chunked_generation_equals_a_single_large_generation`,
`test_consecutive_chunks_join_without_a_discontinuity`;
`test_sources.py` → `test_render_is_continuous_across_chunk_boundaries`,
`test_render_includes_contributions_from_beats_before_the_window`;
`test_renderer.py` → `test_time_grid_splices_bit_for_bit_across_chunk_boundaries`;
`test_rhythm.py` → `test_chunked_generation_equals_whole_generation`,
`test_window_boundaries_are_half_open_so_events_are_not_duplicated`.

**RS-3 — Cambio de parámetros en caliente.** Frecuencia, ruido, eje, mandos del
ritmo y descripción del paciente se cambian sin reiniciar el reloj. Un cambio
estructural (paciente distinto, mando de ritmo distinto) reconstruye la fuente
donde iba el reloj.
*Tests:* `test_engine.py` → `test_update_params_changes_the_rate_without_restarting`,
`test_update_params_clamps_the_rate_to_the_rhythm_range`;
`test_rhythm.py` → `test_set_rate_applies_to_future_events_only`;
`test_sources.py` → `test_set_rate_reaches_the_conduction_policy`.

**RS-4 — Pausa y reanudación sin coste.** Pausar es dejar de pedir muestras: el
reloj solo avanza cuando se genera.
*Tests:* `test_engine.py` → `test_clock_advances_by_the_generated_duration`;
`apps/api/tests/unit/test_streaming.py` → `test_paused_manager_produces_no_new_frames`,
`test_a_paused_simulation_publishes_nothing`;
`apps/api/tests/integration/test_simulation_ws.py` →
`test_pause_stops_frames_and_resume_continues_them`,
`test_the_clock_does_not_run_once_a_simulation_is_active`.

**RS-5 — `reset` rebobina sin volver a fábrica.** Se reinicia el tiempo y la
aleatoriedad, no la configuración: si antes hubo un `update_params`, la señal
vuelve a empezar con la frecuencia vigente.
*Tests:* `test_engine.py` → `test_reset_returns_the_clock_and_the_signal_to_the_origin`,
`test_reset_keeps_the_parameters_in_force`.

**RS-6 — Fallo temprano y explícito.** Un ritmo desconocido, un número de muestras
no positivo, una frecuencia no positiva o una derivación mal escrita son errores
inmediatos con mensaje útil, no valores por defecto silenciosos.
*Tests:* `test_engine.py` → `test_unknown_rhythm_fails_fast`,
`test_generate_rejects_a_non_positive_sample_count`;
`test_rhythm.py` → `test_rate_must_be_positive`;
`test_leads.py` → `test_projection_from_mapping_rejects_unknown_lead`,
`test_projection_from_mapping_rejects_missing_lead`;
`test_catalog.py` → `test_unknown_rhythm_raises_with_a_helpful_message`.

**RS-7 — Ruido = artefacto de medición, nunca fisiología.** El ruido no debe
alterar los intervalos reales del evento subyacente. Cadena de orden fijo: ruido
aditivo → modulación multiplicativa → saturación.

| Artefacto | Modelo |
|---|---|
| EMG (muscular) | Ruido blanco filtrado a 20–150 Hz, independiente por derivación |
| Red eléctrica | Senoidal a 50 Hz, idéntica en las doce derivaciones |
| Deriva de línea base | Oscilador respiratorio, escalado por una ganancia propia de cada derivación |
| Movimiento | Ráfagas de Poisson (0,08/s, 0,6 s, ventana de Hanning), aditivas y multiplicativas |
| Saturación | Recorte simétrico del amplificador, último paso |

*Tests (18 en `test_noise.py`):* `test_mains_frequency_is_european`,
`test_mains_noise_sits_at_fifty_hertz`, `test_emg_noise_is_independent_across_leads`,
`test_emg_noise_does_not_silently_vanish_on_an_odd_grid`,
`test_baseline_wander_follows_the_respiratory_frequency`,
`test_baseline_wander_differs_between_leads`,
`test_motion_artifact_comes_in_bursts_not_continuously`,
`test_motion_artifact_actually_modulates_amplitude`,
`test_clipping_bounds_the_signal_symmetrically`,
`test_noise_free_params_leave_the_signal_untouched`,
`test_apply_noise_is_deterministic_for_a_given_seed`;
`test_engine.py` → `test_noise_free_engine_matches_the_clean_source`,
`test_enabling_noise_increases_signal_variance`.

**RS-8 — Frecuencia de muestreo.** 500 Hz por defecto, misma constante en motor,
API y cabecera de frame: una sola fuente de verdad, para que el servidor no
anuncie una frecuencia distinta de la que genera.
*Test:* `test_types.py` → `test_default_sample_rate`.

---

## 5. Requisitos de la API y del streaming

### 5.1 REST

| Método y ruta | Devuelve |
|---|---|
| `GET /api/health` | Estado y versión del motor |
| `GET /api/rhythms` | Los doce ritmos y el paciente personalizado |
| `GET /api/rhythms/{id}` | Contrato completo: parámetros editables, mandos propios, rangos del eje, rangos del editor de paciente, descripción y referencias |
| `GET /api/drugs` | Biblioteca farmacológica |
| `GET /api/drugs/interactions` | Reglas de interacción |
| `GET /api/drugs/{id}` | Detalle con efectos y referencias |
| `GET /api/sessions` · `GET /api/sessions/{id}` | Historial y detalle con administraciones |
| `GET/POST/PUT/DELETE /api/patients[/{id}]` | Biblioteca de casos personalizados |

*Tests:* `test_health.py` (1), `test_rhythms_router.py` (5) →
`test_list_rhythms_returns_the_twelve_mvp_rhythms_and_the_custom_patient`,
`test_get_rhythm_detail_includes_editable_parameters_and_references`,
`test_third_degree_block_declares_a_fixed_range`;
`test_drugs_router.py` (5) → `test_drug_detail_omits_neutral_effects`,
`test_interactions_endpoint_is_not_shadowed_by_the_drug_id_route`;
`test_sessions_router.py` (4); `test_patients_router.py` (9) →
`test_two_patients_cannot_share_a_name`, `test_a_blank_name_is_refused`,
`test_an_invalid_patient_is_refused_before_it_reaches_the_database`,
`test_a_session_run_with_a_saved_patient_persists_its_full_description`.

**RA-5 — Los rangos los decide el motor y viajan al cliente.** Una interfaz que
copiara los límites clínicos en su propio código acabaría ofreciendo un
deslizador que llega a donde el servidor no acepta, y ese rechazo se ve como un
fallo del programa, no como un límite fisiológico.

### 5.2 WebSocket `/ws/simulation`

**RS-9 — Mensajes de control (cliente → servidor):** `start`, `update`, `pause`,
`resume`, `stop`, `administer`, `ping` (reservado).
**RS-10 — Mensajes de servidor:** `started`, `updated`, `paused`, `resumed`,
`stopped`, `error`, `administered`, más los canales de fondo `measurements`,
`pharmacology`, `cardiac_events` y `heart_state`, y los frames binarios.

*Tests (26 en `test_ws_schemas.py`):* `test_parse_start_message_with_full_params`,
`test_parse_rejects_unknown_type`, `test_parse_rejects_invalid_json`,
`test_engine_params_payload_round_trips_to_engine_params`,
`test_non_finite_numbers_are_rejected`,
`test_an_absurd_heart_rate_is_rejected_instead_of_clamped`,
`test_free_text_has_a_ceiling`, `test_a_dose_of_zero_or_less_is_rejected`,
`test_a_seed_outside_the_servers_own_range_is_rejected`,
`test_the_rhythm_controls_travel_with_the_parameters`,
`test_a_rhythm_map_with_absurd_size_is_refused`,
`test_the_start_acknowledgement_carries_the_resolved_pulse`.

**RS-11 — Frame binario.** Cabecera fija de 40 bytes little-endian (con
`session_id` en su UUID canónico RFC 4122, sin reordenar), payload `float32`
canal-mayor. El tamaño de 40 no es arbitrario: deja el payload alineado a 4,
que es lo que exige `new Float32Array(buffer, 40, n)` en JavaScript.
*Tests (8 en `test_frames.py`):* `test_header_is_exactly_forty_bytes`,
`test_header_fields_are_little_endian_and_in_order`,
`test_session_id_bytes_are_not_reordered`,
`test_payload_is_channel_major_not_interleaved`,
`test_decode_is_the_exact_inverse_of_encode`, `test_decode_rejects_a_truncated_frame`;
`apps/web/src/simulation-runtime/frame-decoder.test.ts` (4).

**RS-12 — Cadencias.**

| Canal | Intervalo | Nota |
|---|---|---|
| Frames de señal | 0,1 s (≈10/s) | Deadline absoluto, para no acumular deriva de reloj |
| `measurements` | 1 s | Ventana de 10 s, la tira de ritmo con la que se lee un ECG real |
| `cardiac_events` | 0,25 s | Cuatro veces por segundo; el pre-roll del cliente son 500 ms |
| `pharmacology` | 1 s | Más un envío inmediato al administrar |

*Tests:* `test_streaming.py` (6) →
`test_running_manager_produces_frames_at_the_configured_cadence`,
`test_measurements_are_published_once_there_is_signal`,
`test_an_empty_window_publishes_nothing_instead_of_crashing`;
`test_measuring.py` → `test_it_forgets_what_falls_out_of_the_window`,
`test_the_payload_carries_its_own_context`, `test_the_values_are_an_open_map`;
`test_cardiac.py` → `test_el_payload_declara_su_ventana`,
`test_los_eventos_no_se_repiten_entre_llamadas`.

**RS-13 — Cola de salida con descarte del más antiguo.** 20 frames de capacidad;
cuando se llena se tira el más viejo, porque en un monitor lo que importa es lo
último.
*Tests (6 en `test_outbox.py`):* `test_put_drops_the_oldest_frame_when_full`,
`test_full_outbox_keeps_the_newest_frames_not_the_oldest`,
`test_get_returns_frames_in_fifo_order`, `test_get_waits_until_a_frame_is_available`.

**RS-14 — Ciclo de vida robusto.** Un error de dominio (ritmo desconocido,
parámetros inválidos, fármaco desconocido, vía no admitida, mensaje malformado)
se responde **sin cerrar el socket**; un fallo del motor se registra con una
referencia opaca, se avisa al cliente y se cierra con 1011. Un `start` repetido
sustituye limpiamente la sesión anterior.
*Tests (17 en `test_simulation_ws.py`):*
`test_unknown_rhythm_reports_not_found_without_closing`,
`test_update_before_start_reports_invalid_params_without_closing`,
`test_engine_failure_during_streaming_sends_error_and_closes_with_1011`,
`test_second_start_replaces_the_first_session_cleanly`,
`test_sequence_number_is_monotonic_across_several_frames`;
`test_pharmacology_ws.py` → `test_unknown_drug_is_rejected_without_closing_the_socket`,
`test_route_not_allowed_is_rejected`, `test_malformed_administer_is_rejected`,
`test_administer_before_start_is_rejected`;
`test_errors.py` (2) → `test_each_error_carries_the_documented_code`.

### 5.3 Persistencia

**RS-15 — Cuatro tablas.** `rhythms` (catálogo sembrado, con versión y commit del
motor), `sessions` (parámetros, semilla, versiones, duración), `drug_administrations`
y `custom_patients`. Migraciones Alembic `0001`–`0003`.
*Tests:* `test_migration.py` (2), `test_seed.py` (3) →
`test_seed_catalog_is_idempotent`, `test_seed_catalog_updates_engine_commit_on_reseed`;
`test_persistence.py` (4) → `test_persist_session_writes_the_documented_columns`;
`test_pharmacology_persistence.py` (5) →
`test_the_session_records_the_pharmacology_version`,
`test_the_session_detail_replays_from_the_registry`.

**RS-16 — Regla de persistencia.** Se guarda la sesión si duró al menos 5 s de
tiempo simulado, **o** si en ella se administró algo, dure lo que dure:
administrar un fármaco no es un error, es un acto clínico registrado.
*Tests:* `test_persistence.py` → `test_should_persist_is_false_under_five_seconds`,
`test_should_persist_is_true_at_or_above_five_seconds`;
`test_pharmacology_persistence.py` → `test_a_short_session_with_a_drug_is_persisted_anyway`.

**RS-17 — Esquema portable Postgres/SQLite.** JSONB y UUID nativos en Postgres;
JSON y texto en SQLite, con su pragma de claves foráneas. El mismo código y los
mismos tests corren contra los dos motores.
*Tests (8 en `test_portable_schema.py`):* `test_el_json_sigue_siendo_jsonb`,
`test_los_identificadores_siguen_siendo_uuid_nativo`,
`test_el_json_se_degrada_a_json_a_secas`, `test_los_uuid_viajan_como_texto`,
`test_el_engine_de_sqlite_activa_el_pragma`,
`test_postgres_no_recibe_pragmas_de_sqlite`.

**RS-18 — La base de datos no es requisito para simular.** Sin ella se pierde el
historial y nada más: catálogo, simulación, medición, farmacología y exportación
siguen funcionando. En un escritorio, la diferencia entre «no se guardará el
historial» y «no arranca» es toda la diferencia que hay.
*Tests (5 en `test_degraded_mode.py`):* `test_la_aplicacion_arranca_sin_base_de_datos`,
`test_el_catalogo_sigue_disponible`, `test_se_puede_simular_sin_base_de_datos`,
`test_parar_una_sesion_no_revienta_sin_base_de_datos`,
`test_el_historial_responde_que_no_esta_disponible`.

**RS-19 — Recorrido completo verificado de extremo a extremo.**
*Test:* `test_end_to_end.py` → `test_full_simulation_lifecycle_end_to_end`.

---

## 6. Requisitos de la interfaz clínica

### 6.1 Presentación del trazado

**RI-1 — Cinco formatos de pantalla:** 1 derivación (II), 3 (I-II-III), 6 (de
miembros), 12 en columna y 6×2 (dos columnas de seis, el formato en que se
imprime un ECG completo). Las dos columnas van sincronizadas al mismo instante.
*Tests:* `render/layout.test.ts` (10), `ui/LayoutPicker.test.tsx` (5).

**RI-2 — Rejilla clínica correcta.** Cuadrícula cuadrada, milímetros reales,
escalado por tema y por métricas del contenedor. El eje del tiempo tuvo que
corregirse porque la cuadrícula «mentía»: el papel es un instrumento de medida,
no un fondo decorativo.
*Tests:* `render/grid-layer.test.ts` (9) → `timeToPx / voltageToPx`,
`computeGridLines`, `drawGrid`; `render/layout-engine.test.ts` (30) → «cuadricula
cuadrada», «cadena de escalas», «segundos por pantalla», «velocidad de papel».

**RI-3 — Ganancia como en un electrocardiógrafo.** Escalones 20 / 10 / 5 / 2,5
mm/mV más un modo automático que elige la mayor que quepa. La velocidad de papel
de referencia (25 mm/s) no cambia con la ganancia. Cuando la ganancia elegida no
cabe en el alto de tira disponible, se avisa de que el trazo puede recortarse.
*Tests:* `render/layout-engine.test.ts` → «ganancia automatica», «ganancia
manual», «reparto de altura»; `ui/WorkspaceInspector.test.tsx`;
`ui/hooks/useLayoutMetrics.test.tsx` (5).

**RI-4 — Barrido tipo monitor.** Anillo de render dimensionado en segundos de
papel al ancho del canvas, banda de borrado en milímetros, sin interpolar los
huecos causados por pérdida de frame o descarte por saturación —una línea recta
sobre un hueco es señal inventada—.
*Tests:* `render/sweep-buffer.test.ts` (18), `render/sweep-clock.test.ts` (5),
`render/sweep-rebuilder.test.ts` (9), `render/lead-canvas.test.ts` (13),
`ui/hooks/useSweepRenderer.test.tsx` (3).

**RI-5 — Buffer de jitter de red separado del buffer de pantalla.** Objetivo
500 ms, rango sano 300–700 ms. Confundir los dos buffers fue la causa raíz de un
trazo de 9 px parpadeante, y por eso están documentados como cosas distintas.
*Tests:* `simulation-runtime/frame-buffer.test.ts` (33), incluidos pre-roll,
overrun, underrun y `playbackTimeS`.

**RI-6 — Dos temas.** «Monitor» (oscuro) y «Papel» (claro), con roles semánticos
de color; el renderer toma color y escala del tema, nunca de constantes propias.
*Tests:* `render/theme-contract.test.ts` (2),
`packages/ui-system/themes/themes.test.ts` (6),
`packages/ui-system/tokens/css.test.ts` (5).

### 6.2 Controles

**RI-7 — Panel básico:** selector de ritmo, frecuencia cardíaca y presets de
calidad de señal (`perfecta`, `buena`, `uci`, `urgencias`, `ambulancia`,
`muy_mala`), anclados a la amplitud real de la onda R para que la progresión
tenga sentido y la R siga distinguiéndose.
*Tests:* `ui/BasicControlPanel.test.tsx` (3), `ui/HeartRateControl.test.tsx` (7),
`ui/RhythmSelector.test.tsx` (4), `ui/noise-presets.test.ts` (5).

**RI-8 — Panel avanzado:** los cinco controles de ruido (EMG, red, deriva,
movimiento, saturación) por separado.
*Test:* `ui/AdvancedControlPanel.test.tsx` (5).

**RI-9 — Mandos propios por ritmo.** Cuando un ritmo declara sus controles, la
interfaz pinta uno por cada uno en lugar del de frecuencia: es lo que convierte
el antiguo «150 lpm (fija)» del flutter en una aurícula y un grado de bloqueo
que se pueden mover.
*Test:* `ui/RhythmControls.test.tsx` (8).

**RI-10 — Disco hexaxial del eje.** Arrastre con ratón, control por teclado,
lectura de zona y métrica del eje en el inspector.
*Tests:* `ui/AxisControl/AxisControl.test.tsx` (8),
`ui/AxisControl/hexaxial.test.ts` (2), `ui/AxisControl/axis-zones.test.ts` (3).

**RI-11 — Editor de paciente y biblioteca de casos.** Todos los campos de
`PatientSpec` con los rangos que publica el servidor, previsión de la frecuencia
ventricular mientras se editan los controles, y guardado/recarga por nombre.
*Test:* `ui/PatientEditor.test.tsx` (13) → «el editor de paciente», «la biblioteca
de casos», «la previsión de frecuencia ventricular».

**RI-12 — Panel de farmacología.** Categoría, medicamento, dosis y vía;
administración sobre el reloj de simulación; lista de fármacos vivos con tiempo
restante e intensidad, e interacciones activas.
*Test:* `ui/PharmacologyPanel.test.tsx` (17), incluidos `formatRemaining` y
`formatDose`.

**RI-13 — Inspector.** Las dos frecuencias con su relación AV, los intervalos
(RR, PR, QRS, QT, QTc) con huecos explícitos cuando no son medibles, la zona del
eje y el panel de medición.
*Tests:* `ui/WorkspaceInspector.test.tsx` (7), `ui/MeasurePanel.test.tsx` (5).

### 6.3 Congelado y medición

**RI-14 — Congelar en el mismo frame que el clic.** Sobre el congelado se mide
con tres herramientas: regla, calibre y RR.
*Tests:* `measure/session.test.ts` (13), `measure/formulas.test.ts` (8),
`ui/MeasureOverlay.test.tsx` (5), `render/measure-geometry.test.ts` (12),
`render/sample-index.test.ts` (9).

**RI-15 — Δt exacto por índices de muestra.** La distancia se calcula restando
índices enteros, no timestamps en coma flotante: el error de conversión no debe
llegar al número que se enseña. El calibre publica Δt en ms, ΔmV con signo (una
depresión del ST no es una elevación), cuadros pequeños y grandes, y el
equivalente en lpm —`null` cuando las dos marcas caen en la misma muestra—.
*Test:* `measure/formulas.test.ts` → `caliperReadout`, «formateadores».

**RI-16 — Tres modos de enganche:** a la señal, a la rejilla y al pico R
(ventana de ±150 ms, amplitud mínima 0,25 mV: es preferible no enganchar a
enganchar en un artefacto).
*Test:* `measure/snap.test.ts` (8).

**RI-17 — Zoom por velocidad de papel.** Escalones 25 / 50 / 100 mm/s, no una
escala continua: el número en pantalla tiene que ser uno que el alumno reconozca
delante de una máquina. La ventana visible no puede desplazarse a zonas nunca
escritas, que pintarían una línea plana con aspecto de señal.
*Test:* `measure/zoom.test.ts` (9) → `nextPaperSpeed`, `clampStart`.

**RI-18 — Lupa.** Aumento declarado, rejilla propia y encuadre que no corta el
pico ni oculta el punto medido.
*Test:* `render/overlay-layer.test.ts` (21) → «lupa», «encuadre de la lupa»,
«region medible».

### 6.4 Exportación

**RI-19 — PNG del puesto entero,** con las marcas de medición, la lectura, la
hora sellada en el nombre del fichero y el aviso de uso previsto incrustado.
Grabación de vídeo de la sesión.
*Tests:* `render/dom-snapshot.test.ts` (8) → `replaceCanvases`, `freezeFormState`,
`collectCss`, `buildSvgMarkup`.

### 6.5 Accesibilidad

**RI-20 — Contrato de nombres accesibles.** Los nombres de los que dependen tests
unitarios y el e2e («Seleccionar ritmo», «Derivaciones visibles», «Categoría»,
«Medicamento») están congelados: cambiarlos exige hacerlo de forma explícita y
justificarlo. Un rediseño es visual; el árbol de accesibilidad se conserva.
*Test:* `ui/accessibility-contract.test.tsx` (5).

### 6.6 Sistema de diseño

**RI-21 — `packages/ui-system` con tokens tipados, dos temas y cinco capas de
componentes** (foundation, surface, data, controls, layout) sobre una shell de
CSS Grid con divisor redimensionable.
*Tests:* 62 casos en `packages/ui-system` (`controls` 23, `layout` 11,
`foundation` 6, `data` 6, `surface` 5, `themes` 6, `tokens` 5).

---

## 7. Corazón 3D (fase D)

**R3D-1 — Modelo anatómico reconstruible.** Geometría derivada de BodyParts3D,
reconstruible con `docs/fase-d/build-heart-model.py`, con la procedencia y la
atribución documentadas. El modelo enseña el volumen sanguíneo —moldes de las
cavidades— y solo las aurículas traen además su pared; está escrito así en
`docs/fase-d/miocardio-y-fuente.md` para que nadie lo lea como músculo.

**R3D-2 — Late con el ECG.** Los mensajes `cardiac_events` y `heart_state` del
WebSocket alimentan una línea temporal de contracción; el animador deforma cada
cavidad dentro de la ventana que el servidor declara, y el cliente interpola sin
calcular ninguno de los tres instantes. Las cámaras que fibrilan tiemblan en vez
de contraerse.
*Tests:* `cardiac/cardiac-timeline.test.ts` (19) → `contractionExcursion`,
`tremorExcursion`, `CardiacTimeline`; `ui/Cardiac3D/HeartAnimator.test.ts` (8);
`ui/Cardiac3D/useCardiacTimeline.test.ts` (5);
`ui/Cardiac3D/heart-nodes.test.ts` (5) → binding por nombre;
`simulation-runtime/session-runtime.test.ts` → «mensajes de mecánica cardíaca».

**R3D-3 — Color anatómico y aislamiento por grupos.** Circuito izquierdo en rojo
y derecho en azul —la única pista visual de qué sangre lleva cada cámara—, con
acabado distinto para cámaras y grandes vasos, tres grupos conmutables
(ventrículos, aurículas, vasos) y opacidad por estructura. La paleta se eligió
midiendo el contraste entre estructuras adyacentes.
*Test:* `ui/Cardiac3D/heart-appearance.test.ts` (11) → `APPEARANCE`,
`nodesInGroup`, `visibleNodes`, `opacityFor`.

**R3D-4 — Cortes anatómicos.** Tres planos (coronal, transversal, sagital)
combinables, con una tapa de sección por plano y por estructura. El coronal es el
que más enseña —ocho de las nueve estructuras, la vista de las cuatro cámaras—;
el transversal da el eje corto. La elección se hizo barriendo la geometría y
contando, no por gusto.
*Test:* `ui/Cardiac3D/heart-cut.test.ts` (11) → «ejes de corte»,
`cutPlaneConstant`, `CAP_SIZE`, «planos combinables».

**R3D-5 — Vistas anatómicas con nombre.** Seis presets (anterior, posterior,
izquierda, derecha, superior, inferior) con su vector de «arriba» declarado y
encuadre por silueta. No hay cámara libre: una vista sin nombre no se puede
comunicar ni reproducir, y siempre se puede volver al preset.
*Test:* `ui/Cardiac3D/HeartCamera.test.ts` (8) → «silueta por vista», «encuadre
de la cámara».

**R3D-6 — Barra de escala.** Milímetros reales por unidad de modelo, elección de
longitud legible y formato.
*Test:* `ui/Cardiac3D/heart-scale.test.ts` (9) → `MM_PER_UNIT`, `pixelsPerMm`,
`chooseScaleBar`, `formatScaleLength`.

**R3D-7 — Reparto de pantalla.** ECG y corazón en 55/45 con divisor
redimensionable y pasos de teclado acumulables.
*Test:* `packages/ui-system/components/layout/layout.test.tsx` (`SplitPane`).

---

## 8. Requisitos no funcionales

### 8.1 Rendimiento

| Requisito | Umbral | Test |
|---|---|---|
| **RNF-1** Generación de 10 s de ECG | < 50 ms | `test_ten_seconds_of_ecg_generate_under_fifty_milliseconds` |
| **RNF-2** Ningún ritmo patológicamente lento | < 4× el objetivo | `test_no_rhythm_is_pathologically_slow` |
| **RNF-3** Chunk de tiempo real | < 10 ms en el peor caso | `test_realtime_chunks_stay_well_inside_their_budget` |
| **RNF-4** El coste no crece con la sesión | tardío < 4× temprano | `test_generation_cost_does_not_grow_over_a_long_session` |
| **RNF-5** Diez minutos sin degenerar | todos los valores finitos, reloj exacto | `test_ten_minutes_of_simulation_produce_finite_values_throughout` |
| **RNF-6** Sesión larga en navegador | sin caída de fps ni memoria sin límite | `apps/web/tests/e2e/streaming-performance.spec.ts` (Playwright, mide también `ArrayBufferContents`, no solo el heap) |

### 8.2 Seguridad

**RNF-7 — Aforo de conexiones.** 50 simultáneas y 5 por cliente; un intento
rechazado no reserva nada; la plaza se libera al desconectar. Detrás de un proxy
propio (`trust_proxy`) se lee el cliente real; sin proxy no se cree la cabecera,
porque hacerlo regala plazas infinitas.
*Tests:* `test_limits.py` (10), `test_simulation_ws.py` →
`test_the_server_refuses_connections_beyond_its_capacity`,
`test_a_seat_is_freed_when_the_client_disconnects`.

**RNF-8 — Tope de tamaño de mensaje:** 64 KiB. Un mensaje mayor se rechaza sin
cerrar el socket.
*Test:* `test_simulation_ws.py` → `test_an_oversized_message_is_rejected_without_closing_the_socket`.

**RNF-9 — Conexiones ociosas.** Una conexión que no arranca simulación en 300 s
se cierra, para que una pestaña olvidada suelte su plaza.
*Test:* `test_simulation_ws.py` → `test_a_connection_that_never_starts_is_closed`.

**RNF-10 — Origen comprobado en CORS y en el handshake del WebSocket.**
*Tests:* `test_cors.py` (6) → `test_ws_rejects_an_unlisted_origin`,
`test_ws_accepts_a_client_that_is_not_a_browser`;
`test_simulation_ws.py` → `test_a_websocket_from_another_site_is_refused`,
`test_a_websocket_from_the_frontend_is_accepted`.

**RNF-11 — Cabeceras de seguridad.** `nosniff`, prohibición de enmarcado y
política de referrer; HSTS se deja al proxy de TLS, no a la aplicación.
*Test:* `test_security_headers.py` (4).

**RNF-12 — Validación estricta de entrada.** Sin `NaN`/`Infinity` (que
`json.loads` acepta y el recorte de rangos deja pasar), techos para frecuencia,
ruido, ángulos, identificadores y texto libre, y rechazo de dosis no positivas y
de semillas fuera de rango.
*Test:* `test_ws_schemas.py` → `test_non_finite_numbers_are_rejected`,
`test_free_text_has_a_ceiling`, `test_an_absurd_heart_rate_is_rejected_instead_of_clamped`.

**RNF-13 — Token de escritorio.** Cuando el shell nativo genera un secreto de
arranque, la API lo exige: es lo que impide que cualquier proceso del mismo
equipo hable con un backend que escucha en 127.0.0.1. `health` sigue abierto y
el origen de Tauri solo se admite en modo escritorio.
*Test:* `test_desktop_auth.py` (11).

**RNF-14 — Cadena de suministro.** Acciones de CI fijadas por SHA, permisos
restringidos, Dependabot, CodeQL, OSSF Scorecard, `pip-audit` y `npm audit`,
`osv-scanner` en Rust, política de seguridad publicada (`SECURITY.md`).
*Workflows:* `.github/workflows/tests.yml`, `scorecard.yml`, `release.yml`.

### 8.3 Despliegue de escritorio (fase G)

**RNF-15 — El shell gobierna el backend.** Lanza `ecg-api.exe` como hijo, espera
a que anuncie su puerto (elegido por el sistema, no fijo), genera el token y mete
al hijo en un *job object* para que muera con el padre aunque el padre muera de
mala manera. Verificado con 100 ciclos abrir/cerrar sin un solo proceso huérfano.
*Tests:* `backend.rs` (3) → `reconoce_el_anuncio_del_puerto`,
`rechaza_un_puerto_imposible`, `ignora_las_lineas_de_log`.

**RNF-16 — Licencia Ed25519 verificada en Rust y sin Internet.** Un hospital sin
conexión no puede quedarse sin simulador porque un servidor de licencias no
responda; la comprobación en línea, cuando exista, será para renovar y revocar.
Sin clave pública configurada, todo queda habilitado.
*Tests:* `license.rs` (7) → `sin_clave_publica_no_se_valida_nada`,
`sin_licencia_todo_esta_habilitado`, `un_fichero_corrupto_no_pasa_por_valido`,
`sin_fichero_no_es_un_error`, `base64_rechaza_basura`, `las_fechas_iso_ordenan_como_fechas`.

**RNF-17 — Actualizaciones con freno.** Se comprueban al arrancar y nunca durante
el uso. Dos arranques fallidos consecutivos detienen las actualizaciones hasta
que alguien mire: seguir descargando la misma versión rota convierte un fallo en
un ciclo.
*Tests:* `updates.rs` (5) → `tras_varios_fallos_seguidos_se_deja_de_actualizar`,
`un_arranque_bueno_deja_el_contador_a_cero`,
`el_contador_no_se_hereda_entre_versiones`,
`un_estado_corrupto_no_bloquea_las_actualizaciones`, `una_instalacion_nueva_actualiza`.

**RNF-18 — La aplicación no habla por la red.** Se verifica que no se declara
ninguna dependencia con capacidad de red ni se registra ningún plugin de Tauri
que la tenga, y que el documento de instalación sigue prometiendo lo mismo.
*Test:* `tests/sin_conexiones_salientes.rs` (4).

**RNF-19 — Release reproducible.** Un tag produce el instalador: tests en los dos
motores de base de datos, frontend, backend empaquetado, comprobación de que el
backend viajó dentro, instalador, smoke test, comprobación de firma, huella,
attestation de procedencia y publicación.
*Workflow:* `.github/workflows/release.yml`.

### 8.4 Operación

**RNF-20 — Un solo worker de uvicorn.** El estado de simulación vive en la
memoria del proceso que sostiene cada WebSocket; varios workers romperían ese
vínculo. Es una restricción de despliegue documentada, no un accidente.

**RNF-21 — Puertos.** Frontend en 5600 y API en 8200, porque los puertos
habituales (5173 y 8000) caen en rangos que Windows reserva y el síntoma no es
«puerto ocupado» sino `WinError 10013`. `arrancar.bat` comprueba que el puerto se
pueda escuchar antes de levantar nada.

---

## 9. Estrategia de verificación

### 9.1 Niveles

| Nivel | Qué demuestra | Dónde |
|---|---|---|
| Unitario del motor | Fisiología, morfología, conducción, medidas, ruido | `packages/*/tests/unit/` |
| Golden signals | Que la señal no cambia entre versiones salvo cambio intencional | `ecg-engine/tests/golden/` |
| Golden farmacológicos | Que cada molécula sigue haciendo lo que un docente espera | `pharmacology-engine/tests/golden/` |
| Benchmarks | Presupuestos de tiempo real | `ecg-engine/tests/benchmarks/` |
| Unitario de API | Contratos, esquemas, límites, seguridad | `apps/api/tests/unit/` |
| Integración de API | WebSocket real, base de datos real, modo degradado | `apps/api/tests/integration/` |
| Unitario de frontend | Render, buffers, medición, componentes | `apps/web/src/**/*.test.ts(x)` |
| Contrato | Espejos TS↔Python y nombres accesibles congelados | `axis-zones.test.ts`, `theme-contract.test.ts`, `accessibility-contract.test.tsx` |
| E2E | Sesión larga sin degradar fps ni memoria | `apps/web/tests/e2e/` |
| Rust | Ciclo de vida del backend, licencia, updates, ausencia de red | `apps/desktop/src-tauri/` |

### 9.2 Golden signals

**RV-1 — Tres niveles por ritmo y dos suites.** Para cada una de las trece
entradas del catálogo se guardan, en suite limpia y en suite con ruido: la señal
completa (`.npy`, comparación bit a bit), la línea de eventos (JSON) y las
medidas (JSON, con los huecos como `null`). Simulación canónica: semilla
`20260725`, 10 s, 500 Hz.

**RV-2 — Regenerar los golden es un acto deliberado.** «Regenerar los golden para
arreglar un test que ha empezado a fallar equivale a borrar la alarma de
incendios porque suena.» El generador y los tests comparten exactamente el mismo
código de simulación; si divergieran, los golden dejarían de comprobar lo que
creemos.
*Tests:* `test_golden.py` (6) → `test_golden_samples_are_unchanged`,
`test_golden_events_are_unchanged`, `test_golden_measurements_are_unchanged`,
`test_every_catalog_rhythm_has_golden_files`,
`test_clean_and_noisy_suites_actually_differ`, `test_clean_suite_has_no_noise_at_all`.

### 9.3 Volumen de la red de pruebas

| Suite | Casos |
|---|---|
| `ecg-engine` (unitarios + golden + benchmarks) | 298 |
| `pharmacology-engine` | 109 |
| `heart-engine` | 16 |
| `apps/api` (unitarios + integración) | 228 |
| `apps/web` (Vitest) | 469 |
| `packages/ui-system` (Vitest) | 62 |
| `apps/web` (Playwright, e2e) | 1 |
| `apps/desktop` (Rust) | 19 |
| **Total** | **1 202** |

Los tests de API corren en CI contra **Postgres y SQLite**, con la misma batería.

### 9.4 Cómo se ejecuta

```bash
arrancar.bat
```

Levanta Postgres en Docker, aplica migraciones, arranca API y frontend en
ventanas separadas y abre el navegador. `parar.bat` detiene el contenedor.

```bash
cd packages/ecg-engine && uv run --extra viz python tools/render_rhythms.py
```

Escribe los trazados del catálogo en formato de papel de ECG en `tools/output/`,
sin montar nada más: es la forma de poner los doce ritmos delante de un
cardiólogo para que los revise.

---

## 10. Fuera de alcance y limitaciones conocidas

Declarado explícitamente, para que nadie lo lea como un defecto:

- **No hay modelo del dipolo cardíaco en 3D.** Las doce derivaciones salen de
  tablas de coeficientes por eje, suficientes para docencia y validadas contra la
  ley de Einthoven y la progresión de la R. La migración a un modelo vectorial no
  rompería la API pública del motor.
- **La farmacocinética es de una sola curva.** Sin compartimentos, sin
  aclaramiento renal, sin unión a proteínas. Cuatro constantes que un clínico
  reconoce y un docente puede explicar.
- **No se distinguen cavidades izquierda y derecha en la mecánica.** Laten juntas
  y con la misma temporización; separarlas hará falta el día que haya disincronía
  (bloqueo de rama, marcapasos), y el consumidor ya lee un enum en vez de un
  booleano para que ese día no rompa el contrato.
- **La disociación isorrítmica es genuinamente ambigua.** Con las dos cámaras al
  mismo paso, el trazado no permite distinguirla de una conducción fija; un
  cardiólogo tampoco puede sin más datos.
- **Bazett sobrecorrige en los extremos.** Se usa a propósito, por ser la fórmula
  de los monitores de cabecera.
- **La asistolia está declarada pero no en el catálogo.** El modo `ABSENT` existe
  para que el consumidor no tenga que tratarla como caso especial el día que
  llegue; hoy solo la alcanza un paciente personalizado sin aurícula ni escape.
- **Del catálogo clínico de referencia faltan** BRI/BCRD, pericarditis,
  hiper/hipopotasemia, hiper/hipocalcemia, WPW y torsades. El patrón de overlay
  que ya funciona en el IAM inferior es la vía por la que entran.
- **Sin evaluación automática del alumno ni editor de escenarios.** Son los
  niveles 2 y 3 del producto; hoy está construido el nivel de simulador clínico.
- **Fase G pendiente de terceros, no de programación:** un certificado de firma
  que hay que comprar, un servidor de actualizaciones donde publicar y un emisor
  de licencias. El código de las tres cosas está escrito y probado.

---

## 11. Anexo — mapa rápido de trazabilidad

| Bloque funcional | Implementación | Verificación |
|---|---|---|
| Ondas y plantillas | `ecg_engine/waveform.py`, `beat.py` | `test_waveform.py`, `test_beat.py` |
| Doce derivaciones y eje | `ecg_engine/leads.py`, `renderer.py` | `test_leads.py` (27), `test_renderer.py` (16) |
| Catálogo de ritmos | `ecg_engine/catalog/definitions.py` | `test_catalog.py` (39) |
| Conducción AV | `ecg_engine/conduction.py` | `test_conduction.py` (20) |
| Trenes y fuentes | `ecg_engine/rhythm.py`, `sources.py` | `test_rhythm.py` (15), `test_sources.py` (17) |
| Medidas y QTc | `ecg_engine/measurements.py` | `test_measurements.py` (37) |
| Ruido y variabilidad | `ecg_engine/noise.py`, `variability.py` | `test_noise.py` (18), `test_variability.py` (9) |
| Overlays | `ecg_engine/overlays.py` | `test_overlays.py` (10) |
| Paciente personalizado | `ecg_engine/patient.py`, `custom_beat.py` | `test_patient.py` (25) |
| Mecánica del ritmo | `ecg_engine/mechanics.py` | `test_mechanics.py` (7) |
| Orquestación del motor | `ecg_engine/engine.py` | `test_engine.py` (18), benchmarks (5) |
| Eventos mecánicos | `heart_engine/events.py`, `heart_state.py` | `test_events.py` (11), `test_heart_state.py` (5) |
| Cinética y dinámica | `pharmacology_engine/kinetics.py`, `dynamics.py` | `test_kinetics.py` (14), `test_dynamics.py` (11) |
| Catálogo de fármacos | `pharmacology_engine/catalog/` | `test_catalog.py` (17), golden (16) |
| Interacciones | `pharmacology_engine/interactions.py` | `test_interactions.py` (15) |
| Registro y replay | `pharmacology_engine/engine.py` | `test_engine.py` (21) |
| Proyección entre motores | `ecg_api/pharmacology/projection.py` | `test_pharmacology_projection.py` (11) |
| Frame binario | `ecg_api/frames.py` | `test_frames.py` (8), `frame-decoder.test.ts` |
| Streaming y cadencias | `ecg_api/streaming.py`, `outbox.py` | `test_streaming.py` (6), `test_outbox.py` (6) |
| Ciclo de vida del WS | `ecg_api/routers/simulation_ws.py` | `test_simulation_ws.py` (17), `test_pharmacology_ws.py` (8) |
| Medidas publicadas | `ecg_api/measuring.py` | `test_measuring.py` (18) |
| Mecánica publicada | `ecg_api/cardiac.py` | `test_cardiac.py` (8) |
| Persistencia | `ecg_api/db/`, `persistence.py` | `test_persistence.py`, `test_portable_schema.py`, `test_migration.py`, `test_seed.py` |
| Modo degradado | `ecg_api/main.py` | `test_degraded_mode.py` (5) |
| Seguridad de la API | `limits.py`, `security_headers.py`, `desktop_auth.py`, `config.py` | `test_limits.py`, `test_security_headers.py`, `test_desktop_auth.py`, `test_cors.py`, `test_config.py` |
| Runtime del cliente | `apps/web/src/simulation-runtime/` | 79 casos en 8 ficheros |
| Render del ECG | `apps/web/src/render/` | 146 casos en 12 ficheros |
| Medición | `apps/web/src/measure/` | 38 casos en 4 ficheros |
| Estado de sesión | `apps/web/src/state/session-store.ts` | 11 casos |
| Paneles y controles | `apps/web/src/ui/` (sin Cardiac3D) | 119 casos |
| Corazón 3D | `apps/web/src/ui/Cardiac3D/`, `src/cardiac/` | 76 casos |
| Sistema de diseño | `packages/ui-system/` | 62 casos |
| Escritorio | `apps/desktop/src-tauri/` | 19 casos |
