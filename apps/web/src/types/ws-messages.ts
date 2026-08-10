import type { EngineParamsPayload } from "./engine-params";
import type {
  ActiveDrug,
  DrugAdministrationRecord,
  FiredInteraction,
} from "./drugs";

export interface StartMessage {
  type: "start";
  rhythm_id: string;
  params?: EngineParamsPayload;
  seed?: number;
}

export interface UpdateMessage {
  type: "update";
  params: EngineParamsPayload;
}

export interface PauseMessage {
  type: "pause";
}

export interface ResumeMessage {
  type: "resume";
}

export interface StopMessage {
  type: "stop";
}

/** Administracion de un farmaco (fase F).
 *
 * Sin instante: se administra en el momento del reloj de simulacion en que
 * el mensaje llega al servidor. Dejar que el cliente eligiera el `t_s`
 * abriria la puerta a administraciones en el pasado, que romperian la
 * monotonia que el replay da por hecha. */
export interface AdministerMessage {
  type: "administer";
  drug_id: string;
  dose: number;
  route?: string;
  operator?: string | null;
  notes?: string | null;
}

export interface PingMessage {
  // Reservado: el backend lo reconoce pero no lo despacha en fase 1 (mide
  // latencia de ida y vuelta, hará falta en fase 2). No hay UI que lo
  // envíe todavía, pero el tipo existe para no romper el contrato cuando
  // se implemente.
  type: "ping";
}

export type ClientMessage =
  | StartMessage
  | UpdateMessage
  | PauseMessage
  | ResumeMessage
  | StopMessage
  | AdministerMessage
  | PingMessage;

export interface StartedMessage {
  type: "started";
  session_id: string;
  seed: number;
  sample_rate_hz: number;
  channels: number;
}

export interface UpdatedMessage {
  type: "updated";
  params: EngineParamsPayload;
}

export interface PausedMessage {
  type: "paused";
}

export interface ResumedMessage {
  type: "resumed";
}

export interface StoppedMessage {
  type: "stopped";
  duration_s: number;
}

export interface ErrorMessage {
  type: "error";
  code: string;
  detail: string;
}

/** Medidas fisiológicas de la ventana de señal, calculadas en el servidor.
 *
 * `values` es un mapa abierto y no un objeto de campos fijos: el contrato
 * está pensado para crecer —eje eléctrico, frecuencia auricular, y lo que
 * necesiten el corazón 3D y el módulo de farmacología— sin que un cliente
 * anterior deje de funcionar. Un valor `null` significa «no medible en este
 * ritmo», no «error»: un flutter no tiene PR y una FV no tiene QT.
 *
 * Las unidades van en el nombre de la clave a propósito. El frontend no
 * convierte ni corrige nada: esas son fórmulas clínicas y viven en el motor.
 */
export interface MeasurementsMessage {
  type: "measurements";
  t_s: number;
  window_s: number;
  values: Record<string, number | null>;
}

/** Acuse de una administracion concreta. Llega antes que el
 * `pharmacology` que refleja su efecto. */
export interface AdministeredMessage {
  type: "administered";
  administration: DrugAdministrationRecord;
}

/** Estado farmacologico completo, a 1 Hz mientras la simulacion corre.
 *
 * Canal aparte del de medidas, a la misma cadencia pero con su propio
 * contrato: fusionarlos obligaria a versionar el payload de medidas cada vez
 * que la farmacologia anadiera un campo.
 *
 * `physiology` es un mapa abierto por la misma razon que `values` en
 * `MeasurementsMessage`: lleva lo que `EngineParams` no sabe representar
 * —PR, QRS, QT, conduccion AV, contractilidad, presion, gasto cardiaco— y
 * crecera con el corazon 3D sin romper a un cliente anterior. */
export interface PharmacologyMessage {
  type: "pharmacology";
  t_s: number;
  active: ActiveDrug[];
  interactions: FiredInteraction[];
  physiology: Record<string, number>;
}

/** Espejo de `MechanicalEvent.as_payload()` en `heart-engine`.
 *
 * Se mantiene a mano, igual que la cabecera binaria de 40 bytes es espejo de
 * `frames.py`: es el patrón que este repositorio ya usa para los contratos
 * entre Python y TypeScript. Un cambio en el lado Python que no se refleje
 * aquí lo caza el test de contrato del runtime. */
export interface MechanicalEventPayload {
  chamber: "atria" | "ventricles";
  t_start_s: number;
  t_peak_s: number;
  t_end_s: number;
  amplitude: number;
  index: number;
}

export interface CardiacEventsMessage {
  type: "cardiac_events";
  t_start_s: number;
  t_end_s: number;
  events: MechanicalEventPayload[];
}

export type ContractionModeName =
  | "synchronous"
  | "fluttering"
  | "fibrillating"
  | "absent";

/** `values` es un mapa de campos conocidos y no `Record<string, unknown>`:
 * al contrario que `measurements`, aquí el cliente necesita cada campo con su
 * tipo para animar. Los campos hemodinámicos que llegarán después (volumen
 * sistólico, contractilidad) se añaden como opcionales cuando existan. */
export interface HeartStateMessage {
  type: "heart_state";
  values: {
    rhythm_id: string;
    heart_rate_bpm: number | null;
    atrial_mode: ContractionModeName;
    ventricular_mode: ContractionModeName;
    atrial_amplitude: number;
    ventricular_amplitude: number;
    flutter_hz: number;
  };
}

export type ServerMessage =
  | StartedMessage
  | UpdatedMessage
  | PausedMessage
  | ResumedMessage
  | StoppedMessage
  | MeasurementsMessage
  | AdministeredMessage
  | PharmacologyMessage
  | CardiacEventsMessage
  | HeartStateMessage
  | ErrorMessage;
