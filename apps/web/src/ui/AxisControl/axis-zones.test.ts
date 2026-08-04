import { describe, expect, it } from "vitest";
import { normalizeDeg, zoneFor } from "./axis-zones";

describe("zoneFor — espejo de zone_for del motor", () => {
  it("clasifica cada frontera por ambos lados", () => {
    expect(zoneFor(-30)).toBe("normal");
    expect(zoneFor(-31)).toBe("left");
    expect(zoneFor(90)).toBe("normal");
    expect(zoneFor(91)).toBe("right");
    expect(zoneFor(-90)).toBe("left");
    expect(zoneFor(-91)).toBe("extreme");
    expect(zoneFor(180)).toBe("right");
  });

  it("normaliza antes de clasificar: +270 = −90", () => {
    expect(zoneFor(270)).toBe(zoneFor(-90));
    expect(normalizeDeg(270)).toBe(-90);
    expect(normalizeDeg(-180)).toBe(180);
  });

  it("cubre el círculo entero sin huecos", () => {
    for (let deg = -180; deg <= 180; deg++) {
      expect(["normal", "left", "right", "extreme"]).toContain(zoneFor(deg));
    }
  });
});
