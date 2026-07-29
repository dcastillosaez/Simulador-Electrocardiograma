export const HEADER_SIZE_BYTES = 40;

export interface DecodedFrame {
  version: number;
  sampleRateHz: number;
  nChannels: number;
  nSamplesPerChannel: number;
  sequenceNumber: number;
  tStartS: number;
  sessionId: string;
  channelsV: Float32Array;
}

export function decodeFrame(buffer: ArrayBuffer): DecodedFrame {
  if (buffer.byteLength < HEADER_SIZE_BYTES) {
    throw new Error(`frame demasiado corto: ${buffer.byteLength} bytes`);
  }

  const view = new DataView(buffer);
  const version = view.getUint16(0, true);
  const sampleRateHz = view.getUint16(2, true);
  const nChannels = view.getUint8(4);
  // byte 5: reservado
  const nSamplesPerChannel = view.getUint16(6, true);
  const sequenceNumber = view.getUint32(8, true);
  // bytes 12-15: reservado2
  const tStartS = view.getFloat64(16, true);
  const sessionId = formatSessionId(new Uint8Array(buffer, 24, 16));

  const expectedPayloadBytes = nChannels * nSamplesPerChannel * 4;
  if (buffer.byteLength < HEADER_SIZE_BYTES + expectedPayloadBytes) {
    const actualPayloadBytes = buffer.byteLength - HEADER_SIZE_BYTES;
    throw new Error(
      `payload incompleto: esperados ${expectedPayloadBytes} bytes, recibidos ${actualPayloadBytes}`
    );
  }

  // La cabecera de 40 bytes deja el payload alineado a 4 — requisito de
  // `Float32Array` sobre un `ArrayBuffer` compartido, no un tamaño arbitrario.
  const channelsV = new Float32Array(
    buffer,
    HEADER_SIZE_BYTES,
    nChannels * nSamplesPerChannel
  );

  return {
    version,
    sampleRateHz,
    nChannels,
    nSamplesPerChannel,
    sequenceNumber,
    tStartS,
    sessionId,
    channelsV,
  };
}

function formatSessionId(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
