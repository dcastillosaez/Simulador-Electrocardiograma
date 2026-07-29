import { describe, expect, it, vi } from "vitest";
import { TypedEventEmitter } from "./event-emitter";

interface TestEvents {
  greeting: { message: string };
  count: number;
}

describe("TypedEventEmitter", () => {
  it("llama a los listeners suscritos con el payload emitido", () => {
    const emitter = new TypedEventEmitter<TestEvents>();
    const listener = vi.fn();
    emitter.on("greeting", listener);

    emitter.emit("greeting", { message: "hola" });

    expect(listener).toHaveBeenCalledWith({ message: "hola" });
  });

  it("soporta varios listeners para el mismo evento", () => {
    const emitter = new TypedEventEmitter<TestEvents>();
    const first = vi.fn();
    const second = vi.fn();
    emitter.on("count", first);
    emitter.on("count", second);

    emitter.emit("count", 5);

    expect(first).toHaveBeenCalledWith(5);
    expect(second).toHaveBeenCalledWith(5);
  });

  it("off() deja de llamar al listener retirado", () => {
    const emitter = new TypedEventEmitter<TestEvents>();
    const listener = vi.fn();
    emitter.on("count", listener);
    emitter.off("count", listener);

    emitter.emit("count", 1);

    expect(listener).not.toHaveBeenCalled();
  });

  it("emitir un evento sin listeners no lanza", () => {
    const emitter = new TypedEventEmitter<TestEvents>();
    expect(() => emitter.emit("count", 1)).not.toThrow();
  });
});
