type Listener<T> = (payload: T) => void;

// `Events extends object` (no `Record<string, unknown>`): un `interface`
// normal, sin firma de índice explícita, no es asignable a
// `Record<string, unknown>` bajo el chequeo de restricciones genéricas de
// TypeScript — exigiría añadir `[key: string]: unknown` a cada mapa de
// eventos consumidor solo para satisfacer una restricción que la clase
// nunca necesitó (no itera claves desconocidas, solo accede vía `K extends
// keyof Events`).
export class TypedEventEmitter<Events extends object> {
  private listeners = new Map<keyof Events, Set<Listener<unknown>>>();

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
    const set = this.listeners.get(event) ?? new Set<Listener<unknown>>();
    set.add(listener as Listener<unknown>);
    this.listeners.set(event, set);
  }

  off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
    this.listeners.get(event)?.delete(listener as Listener<unknown>);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    this.listeners.get(event)?.forEach((listener) => listener(payload));
  }
}
