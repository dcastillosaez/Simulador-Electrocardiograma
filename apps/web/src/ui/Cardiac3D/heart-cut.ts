import { MODEL_HALF_EXTENTS } from "./HeartCamera";

/** El plano de corte anatómico.
 *
 * Se eligió el coronal midiendo, no por gusto: barriendo los tres planos sobre
 * la geometría real y contando qué estructuras aparecen en cada uno, el
 * coronal a media profundidad enseña **ocho de las nueve** —las cuatro
 * cámaras, aorta, tronco pulmonar y las dos cavas—, el transversal seis y el
 * sagital cinco. Es el plano de las cuatro cámaras de toda la vida.
 *
 * Los otros dos ejes están declarados porque el transversal tiene su uso
 * propio —comparar ventrículo izquierdo contra derecho a la altura del
 * tabique, que es la vista de eje corto— pero de momento solo el coronal
 * llega a la interfaz. */
export type CutAxis = "coronal" | "transversal" | "sagittal";

export interface CutAxisSpec {
  /** Normal del plano de Three.js. Apunta hacia la mitad que se quita.
   *
   * Three descarta la geometría donde `normal · punto + constante < 0`, así
   * que con la normal en sentido contrario al eje se conserva la mitad de
   * coordenada menor: en el coronal, la posterior, que es la que se mira desde
   * la vista anterior. */
  normal: readonly [number, number, number];
  /** Media extensión del modelo en ese eje: el recorrido del plano. */
  halfExtent: number;
}

export const CUT_AXES: Record<CutAxis, CutAxisSpec> = {
  coronal: { normal: [0, 0, -1], halfExtent: MODEL_HALF_EXTENTS.z },
  transversal: { normal: [0, -1, 0], halfExtent: MODEL_HALF_EXTENTS.y },
  sagittal: { normal: [-1, 0, 0], halfExtent: MODEL_HALF_EXTENTS.x },
};

export const DEFAULT_CUT_AXIS: CutAxis = "coronal";

/** Orden en que se ofrecen. El coronal primero por ser el que más enseña. */
export const CUT_AXIS_ORDER = ["coronal", "transversal", "sagittal"] as const;

export const CUT_AXIS_LABELS: Record<CutAxis, string> = {
  coronal: "Coronal",
  transversal: "Transversal",
  sagittal: "Sagital",
};

/** Un plano activo: por qué eje corta y por dónde.
 *
 * Son varios y no uno porque los cortes **no son excluyentes**: Three.js
 * acepta una lista de planos y conserva la geometría que está del lado bueno
 * de todos, así que dos planos abren una esquina y tres abren un octante. Es
 * el corte de esquina de cualquier atlas, y para ver la relación entre cámaras
 * dice más que un plano solo. */
export interface ActiveCut {
  axis: CutAxis;
  position: number;
}

/** Dónde arranca el plano, de 0 a 1 sobre el recorrido del eje.
 *
 * Medido barriendo el eje y midiendo el área que ocupa cada cámara en la
 * sección. En 0,58 la más pequeña llega al 1,5% del encuadre y las cuatro
 * suman un 18,4%, que es el mejor reparto que da este plano.
 *
 * Y no da más: **ningún corte coronal enseña las cuatro cámaras por igual**.
 * En el barrido, donde el ventrículo izquierdo y la aurícula derecha están en
 * su mejor momento —hacia el 48%— el derecho todavía no ha aparecido, y cuando
 * el derecho manda —hacia el 80%— la aurícula izquierda ya se ha ido. No es un
 * defecto del modelo: la vista de cuatro cámaras de la ecocardiografía es un
 * plano **oblicuo**, no ortogonal, precisamente por esto. Un plano de
 * orientación libre lo resolvería y es el siguiente paso natural. */
export const DEFAULT_CUT_POSITION = 0.58;

/** Márgenes del recorrido. En los extremos exactos el plano deja el modelo
 * entero o lo quita entero, y las dos cosas se leen como un fallo. */
export const MIN_CUT_POSITION = 0.05;
export const MAX_CUT_POSITION = 0.95;

/** Constante del plano de Three.js para esa posición del mando.
 *
 * `position` va de 0 a 1 y recorre el eje de lado a lado del modelo, que está
 * centrado en el origen. Devolver la coordenada directamente funciona porque
 * las tres normales apuntan en sentido contrario a su eje. */
export function cutPlaneConstant(axis: CutAxis, position: number): number {
  const { halfExtent } = CUT_AXES[axis];
  const clamped = Math.min(MAX_CUT_POSITION, Math.max(MIN_CUT_POSITION, position));
  return halfExtent * (2 * clamped - 1);
}

/** Lado del cuadrado que tapa la sección.
 *
 * Tiene que pasarse de grande: no se ve nunca entero —solo asoma por donde el
 * stencil dice que hay corte— y quedarse corto dejaría cámaras sin tapar por
 * los bordes. Cuatro veces la media altura del modelo sobra para cualquier
 * eje. */
export const CAP_SIZE = MODEL_HALF_EXTENTS.y * 4;
