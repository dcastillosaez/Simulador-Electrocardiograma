import { ECGWorkspace } from "./ui/ECGWorkspace";

const params = new URLSearchParams(window.location.search);

/** Apuntar a otro backend desde la barra de direcciones es comodidad de
 * desarrollo, y solo eso. Publicado, un enlace `…/?api=https://el-del-atacante`
 * haria que esta interfaz --la de confianza-- hablara con un servidor ajeno:
 * senal falsa presentada como buena, y cualquier credencial futura enviada a
 * quien mando el enlace. Fuera de `dev` mandan las variables de entorno. */
const override = (name: string) => (import.meta.env.DEV ? params.get(name) : null);

const API_BASE_URL =
  override("api") ?? import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
const WS_URL =
  override("ws") ?? import.meta.env.VITE_WS_URL ?? "ws://localhost:8000/ws/simulation";

export function App() {
  return <ECGWorkspace wsUrl={WS_URL} apiBaseUrl={API_BASE_URL} />;
}
