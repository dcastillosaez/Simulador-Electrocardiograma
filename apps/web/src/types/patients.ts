/** El paciente personalizado, tal y como viaja por la red.
 *
 * Un solo objeto para lo eléctrico y lo hemodinámico. La frontera entre los
 * dos motores existe en el servidor —`PatientSpec` para el de señal, el basal
 * para el farmacológico— y no tiene por qué asomar aquí: para quien configura,
 * todo esto es «el paciente».
 *
 * Los límites de cada campo NO están en este fichero. Los sirve la API en
 * `patient_parameters` del detalle del ritmo, porque son fisiología y no
 * presentación: una copia local acabaría ofreciendo un deslizador que llega
 * a donde el servidor rechaza, y eso se lee como un fallo del programa.
 */

export type AvConductionName =
  | "conducted"
  | "ratio"
  | "wenckebach"
  | "complete_block";

export interface PatientPayload {
  atrial_rate_bpm: number;
  av_conduction: AvConductionName;
  conduction_ratio: number;
  wenckebach_cycle: number;
  wenckebach_increment_ms: number;
  escape_rate_bpm: number;

  pr_ms: number;
  qrs_ms: number;
  qt_ms: number;

  st_shift_mv: number;
  t_amplitude_scale: number;
  p_amplitude_scale: number;

  systolic_bp_mmhg: number;
  diastolic_bp_mmhg: number;
  respiratory_rate_bpm: number;
  stroke_volume_ml: number;
}

/** Un adulto sano en ritmo sinusal.
 *
 * Quien abre el editor parte de alguien normal y lo enferma, que es como se
 * construye un caso clínico. Estos números son los mismos que el motor toma
 * por defecto; si alguno se moviera allí, aquí solo cambiaría el punto de
 * partida de la interfaz, nunca lo que se genera.
 */
export const DEFAULT_PATIENT: PatientPayload = {
  atrial_rate_bpm: 70,
  av_conduction: "conducted",
  conduction_ratio: 2,
  wenckebach_cycle: 4,
  wenckebach_increment_ms: 50,
  escape_rate_bpm: 40,
  pr_ms: 160,
  qrs_ms: 90,
  qt_ms: 400,
  st_shift_mv: 0,
  t_amplitude_scale: 1,
  p_amplitude_scale: 1,
  systolic_bp_mmhg: 120,
  diastolic_bp_mmhg: 75,
  respiratory_rate_bpm: 14,
  stroke_volume_ml: 70,
};

export interface CustomPatientSummary {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface CustomPatientDetail extends CustomPatientSummary {
  engine_semver: string;
  patient: PatientPayload;
}

/** La frecuencia que va a tener el ventrículo, calculada sin generar nada.
 *
 * Duplica la aritmética de `PatientSpec.ventricular_rate_bpm` en el servidor,
 * y es la única duplicación que este módulo se permite: el editor tiene que
 * poder decir «esto son 40 latidos» mientras se mueve el deslizador, sin
 * esperar diez segundos a que la medida real llegue por el WebSocket. Es una
 * previsión, no una medida — el panel derecho sigue siendo el que manda.
 */
export function anticipatedVentricularRate(patient: PatientPayload): number {
  if (patient.atrial_rate_bpm <= 0) return patient.escape_rate_bpm;
  switch (patient.av_conduction) {
    case "complete_block":
      return patient.escape_rate_bpm;
    case "ratio":
      return patient.atrial_rate_bpm / patient.conduction_ratio;
    case "wenckebach":
      return (
        (patient.atrial_rate_bpm * (patient.wenckebach_cycle - 1)) /
        patient.wenckebach_cycle
      );
    default:
      return patient.atrial_rate_bpm;
  }
}
