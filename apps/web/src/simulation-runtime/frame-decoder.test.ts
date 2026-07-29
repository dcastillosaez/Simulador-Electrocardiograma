import { describe, expect, it } from "vitest";
import { decodeFrame, HEADER_SIZE_BYTES } from "./frame-decoder";

// Construye un frame de prueba con los mismos offsets que `frames.py`
// (HEADER_FORMAT = "<HHBBHIId16s"): version u16, sample_rate_hz u16,
// n_channels u8, reservado u8, n_samples_per_channel u16,
// sequence_number u32, reservado2 u32, t_start_s f64, session_id 16 bytes.
function buildFrame(options: {
  version?: number;
  sampleRateHz?: number;
  nChannels?: number;
  nSamplesPerChannel?: number;
  sequenceNumber?: number;
  tStartS?: number;
  sessionIdBytes?: number[];
  samples?: number[][]; // [canal][muestra], channel-major
}): ArrayBuffer {
  const nChannels = options.nChannels ?? 2;
  const nSamplesPerChannel = options.nSamplesPerChannel ?? 3;
  const samples =
    options.samples ??
    Array.from({ length: nChannels }, (_, ch) =>
      Array.from({ length: nSamplesPerChannel }, (_, i) => ch * 10 + i)
    );
  const payloadBytes = nChannels * nSamplesPerChannel * 4;
  const buffer = new ArrayBuffer(HEADER_SIZE_BYTES + payloadBytes);
  const view = new DataView(buffer);

  view.setUint16(0, options.version ?? 1, true);
  view.setUint16(2, options.sampleRateHz ?? 500, true);
  view.setUint8(4, nChannels);
  view.setUint8(5, 0);
  view.setUint16(6, nSamplesPerChannel, true);
  view.setUint32(8, options.sequenceNumber ?? 0, true);
  view.setUint32(12, 0, true);
  view.setFloat64(16, options.tStartS ?? 0, true);

  const sessionIdBytes =
    options.sessionIdBytes ??
    // UUID "12345678-1234-5678-1234-567812345678" sin guiones, por pares
    [0x12, 0x34, 0x56, 0x78, 0x12, 0x34, 0x56, 0x78, 0x12, 0x34, 0x56, 0x78, 0x12, 0x34, 0x56, 0x78];
  new Uint8Array(buffer, 24, 16).set(sessionIdBytes);

  let offset = HEADER_SIZE_BYTES;
  for (const channel of samples) {
    for (const value of channel) {
      view.setFloat32(offset, value, true);
      offset += 4;
    }
  }

  return buffer;
}

describe("decodeFrame", () => {
  it("decodifica la cabecera con los offsets exactos del contrato", () => {
    const buffer = buildFrame({
      version: 1,
      sampleRateHz: 500,
      nChannels: 2,
      nSamplesPerChannel: 3,
      sequenceNumber: 42,
      tStartS: 1.5,
    });

    const frame = decodeFrame(buffer);

    expect(frame.version).toBe(1);
    expect(frame.sampleRateHz).toBe(500);
    expect(frame.nChannels).toBe(2);
    expect(frame.nSamplesPerChannel).toBe(3);
    expect(frame.sequenceNumber).toBe(42);
    expect(frame.tStartS).toBeCloseTo(1.5);
    expect(frame.sessionId).toBe("12345678-1234-5678-1234-567812345678");
  });

  it("interpreta el payload como float32 channel-major", () => {
    const buffer = buildFrame({
      nChannels: 2,
      nSamplesPerChannel: 3,
      samples: [
        [1, 2, 3],
        [10, 20, 30],
      ],
    });

    const frame = decodeFrame(buffer);

    expect(Array.from(frame.channelsV)).toEqual([1, 2, 3, 10, 20, 30]);
  });

  it("rechaza un buffer más corto que la cabecera", () => {
    const buffer = new ArrayBuffer(HEADER_SIZE_BYTES - 1);
    expect(() => decodeFrame(buffer)).toThrow(/demasiado corto/);
  });

  it("rechaza un payload incompleto", () => {
    const buffer = buildFrame({ nChannels: 2, nSamplesPerChannel: 3 });
    const truncated = buffer.slice(0, HEADER_SIZE_BYTES + 4);
    expect(() => decodeFrame(truncated)).toThrow(/payload incompleto/);
  });
});
