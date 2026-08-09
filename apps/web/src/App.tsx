import { useEffect, useState } from "react";
import { ECGWorkspace } from "./ui/ECGWorkspace";
import { resolveBackendUrls, type BackendUrls } from "./simulation-runtime/runtime-mode";

/** Arranque de la aplicación.
 *
 * La dirección del backend ya no se resuelve al importar el módulo. En
 * escritorio el backend es un proceso que el propio programa arranca en un
 * puerto efímero, así que no se conoce hasta que responde: hay que
 * preguntársela al shell. Mientras tanto se enseña que se está arrancando, en
 * vez de una pantalla en blanco o —peor— una conexión al puerto equivocado.
 */
export function App() {
  const [urls, setUrls] = useState<BackendUrls | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    resolveBackendUrls()
      .then((resueltas) => {
        if (vigente) setUrls(resueltas);
      })
      .catch(() => {
        if (vigente) setError("No se pudo localizar el motor de simulación.");
      });
    return () => {
      vigente = false;
    };
  }, []);

  if (error) {
    return (
      <p role="alert" style={{ padding: "2rem" }}>
        {error}
      </p>
    );
  }

  if (!urls) {
    return (
      <p role="status" style={{ padding: "2rem" }}>
        Arrancando el simulador…
      </p>
    );
  }

  return <ECGWorkspace wsUrl={urls.wsUrl} apiBaseUrl={urls.apiBaseUrl} />;
}
