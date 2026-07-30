import { useEffect } from "react";
import type { SessionRuntime } from "../../simulation-runtime/session-runtime";
import { useSessionStore } from "../../state/session-store";

/** Engancha el runtime al store y abre la conexión.
 *
 * `attachRuntime` devuelve `detach`, y devolverlo en el cleanup no es opcional:
 * React StrictMode monta, limpia y vuelve a montar el mismo efecto en
 * desarrollo sin recrear `runtime`, así que sin desuscribir se duplican los
 * listeners sobre la misma instancia y `framesLost` cuenta el doble. */
export function useSimulationRuntime(runtime: SessionRuntime): void {
  useEffect(() => {
    const detach = useSessionStore.getState().attachRuntime(runtime);
    runtime.connect();
    return () => {
      detach();
      runtime.disconnect();
    };
  }, [runtime]);
}
