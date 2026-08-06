/** Una muestra identificada. `timestampS` es derivado, no almacenado: guardar
 * los dos serían dos sitios donde el mismo hecho puede desincronizarse. */
export interface SamplePoint {
  /** Absoluto desde el inicio de la sesión. */
  sampleIndex: number;
  timestampS: number;
}

/** Anillo paralelo a los `SweepBuffer` con el índice absoluto de cada posición.
 *
 * La coordenada canónica del renderer es la muestra, no el segundo: el anillo,
 * el trazo y la banda de borrado ya trabajan así. Poner el segundo en el centro
 * obligaría a redondear en cada conversión y a arrastrar error de coma flotante
 * hasta el píxel. Con la muestra como origen, todo lo demás es una división.
 *
 * **Uno solo, no doce.** Las doce derivaciones se escriben en el mismo tick
 * desde el mismo trozo multicanal: comparten índice por construcción. Uno por
 * derivación serían doce copias del mismo dato con doce oportunidades de
 * desincronizarse.
 *
 * `Float64Array` y no `Int32Array`: a 500 Hz un entero de 32 bits desborda a
 * los 49 días de sesión, y `Float64` representa enteros exactos hasta 2^53. El
 * array se iba a reservar de todos modos, así que el coste es el mismo. */
export class SampleIndexRing {
  readonly capacity: number;

  private readonly indices: Float64Array;
  private cursor = 0;
  private count = 0;

  constructor(capacity: number) {
    this.capacity = Math.max(1, Math.floor(capacity));
    this.indices = new Float64Array(this.capacity);
  }

  /** Posición del anillo donde se escribirá la próxima muestra. */
  get writeCursor(): number {
    return this.cursor;
  }

  /** Muestras escritas desde el último `reset()`, saturado en `capacity`. */
  get writtenCount(): number {
    return this.count;
  }

  push(indices: Float64Array): void {
    if (indices.length === 0) {
      return;
    }
    for (let i = 0; i < indices.length; i++) {
      this.indices[this.cursor] = indices[i];
      this.cursor = this.cursor + 1 === this.capacity ? 0 : this.cursor + 1;
    }
    this.count = Math.min(this.capacity, this.count + indices.length);
  }

  /** Índice absoluto de esa posición. Acepta índices fuera de rango (incluidos
   * negativos) y los envuelve por módulo, igual que `SweepBuffer.at`. */
  at(ringPos: number): number {
    return this.indices[this.wrap(ringPos)];
  }

  /** Posición del anillo que contiene esa muestra, o `null` si ya se
   * sobrescribió o se perdió en un hueco.
   *
   * Es la dirección lenta —búsqueda binaria— y la que menos se usa: la
   * consumirá la fase F2 para colocar una anotación, una vez por latido. La
   * dirección del camino caliente, `at()`, es una lectura directa.
   *
   * El anillo está ordenado de forma ascendente en orden LÓGICO (del más viejo
   * al más nuevo), no físico: la búsqueda va sobre `k`, la distancia desde el
   * más viejo, y se traduce a posición física al leer. Los huecos de red no la
   * rompen: los índices saltan, pero siguen siendo crecientes. */
  findRingPos(sampleIndex: number): number | null {
    if (this.count === 0) {
      return null;
    }
    let lo = 0;
    let hi = this.count - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const ringPos = this.ringPosForK(mid);
      const value = this.indices[ringPos];
      if (value === sampleIndex) return ringPos;
      if (value < sampleIndex) lo = mid + 1;
      else hi = mid - 1;
    }
    return null;
  }

  /** Vacía el anillo. Al arrancar una sesión nueva el eje de tiempo empieza de
   * cero: mezclarlo con los índices de la anterior daría medidas de un trazado
   * que ya no está en pantalla. */
  reset(): void {
    this.indices.fill(0);
    this.cursor = 0;
    this.count = 0;
  }

  /** Posición física de la k-ésima muestra contando desde la más antigua. */
  private ringPosForK(k: number): number {
    return this.wrap(this.cursor - this.count + k);
  }

  private wrap(index: number): number {
    return ((index % this.capacity) + this.capacity) % this.capacity;
  }
}
