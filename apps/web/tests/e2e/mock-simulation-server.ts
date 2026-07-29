import { WebSocketServer, type WebSocket } from "ws";

const HEADER_SIZE_BYTES = 40;
const N_CHANNELS = 12;
const N_SAMPLES_PER_CHUNK = 50;
const SAMPLE_RATE_HZ = 500;
const SESSION_ID_BYTES = new Array(16).fill(0x11);

function encodeFrame(sequenceNumber: number, tStartS: number): Buffer {
  const payloadBytes = N_CHANNELS * N_SAMPLES_PER_CHUNK * 4;
  const buffer = Buffer.alloc(HEADER_SIZE_BYTES + payloadBytes);
  buffer.writeUInt16LE(1, 0); // version
  buffer.writeUInt16LE(SAMPLE_RATE_HZ, 2);
  buffer.writeUInt8(N_CHANNELS, 4);
  buffer.writeUInt8(0, 5);
  buffer.writeUInt16LE(N_SAMPLES_PER_CHUNK, 6);
  buffer.writeUInt32LE(sequenceNumber, 8);
  buffer.writeUInt32LE(0, 12);
  buffer.writeDoubleLE(tStartS, 16);
  Buffer.from(SESSION_ID_BYTES).copy(buffer, 24);

  let offset = HEADER_SIZE_BYTES;
  for (let ch = 0; ch < N_CHANNELS; ch++) {
    for (let i = 0; i < N_SAMPLES_PER_CHUNK; i++) {
      const t = tStartS + i / SAMPLE_RATE_HZ;
      buffer.writeFloatLE(0.001 * Math.sin(2 * Math.PI * 1.2 * t + ch), offset);
      offset += 4;
    }
  }
  return buffer;
}

export function startMockSimulationServer(port: number): { close: () => void } {
  const wss = new WebSocketServer({ port });

  wss.on("connection", (ws: WebSocket) => {
    let sequenceNumber = 0;
    let intervalHandle: NodeJS.Timeout | null = null;

    ws.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === "start") {
        ws.send(
          JSON.stringify({
            type: "started",
            session_id: "11111111-1111-1111-1111-111111111111",
            seed: message.seed ?? 1,
            sample_rate_hz: SAMPLE_RATE_HZ,
            channels: N_CHANNELS,
          })
        );
        // Sin `setTimeout` pausado a 100ms: envía tan rápido como el event
        // loop lo permita, para comprimir muchos minutos de contenido en
        // pocos segundos de reloj real (ver sección 9 del spec de esta fase).
        intervalHandle = setInterval(() => {
          const tStartS = sequenceNumber * (N_SAMPLES_PER_CHUNK / SAMPLE_RATE_HZ);
          ws.send(encodeFrame(sequenceNumber, tStartS));
          sequenceNumber++;
        }, 0);
      } else if (message.type === "stop") {
        if (intervalHandle) clearInterval(intervalHandle);
        ws.send(JSON.stringify({ type: "stopped", duration_s: sequenceNumber * 0.1 }));
      }
    });

    ws.on("close", () => {
      if (intervalHandle) clearInterval(intervalHandle);
    });
  });

  return { close: () => wss.close() };
}
