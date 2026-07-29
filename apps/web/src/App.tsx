import { ECGWorkspace } from "./ui/ECGWorkspace";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:8000/ws/simulation";

export function App() {
  return <ECGWorkspace wsUrl={WS_URL} apiBaseUrl={API_BASE_URL} />;
}
