import { describe, expect, it, vi } from "vitest";
import { CatalogClient } from "./catalog-client";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("CatalogClient", () => {
  it("listRhythms llama a GET /api/rhythms y devuelve el JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse([{ rhythm_id: "sinus_normal", display_name: "Sinusal", category: "sinus", ventricular_rate_hz: 1.1667, pr_is_measurable: true }])
    );
    const client = new CatalogClient({ baseUrl: "http://api.test", fetchImpl });

    const rhythms = await client.listRhythms();

    expect(fetchImpl).toHaveBeenCalledWith("http://api.test/api/rhythms");
    expect(rhythms).toHaveLength(1);
    expect(rhythms[0].rhythm_id).toBe("sinus_normal");
  });

  it("getRhythm llama a GET /api/rhythms/{id} codificando el id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        rhythm_id: "sinus_normal",
        display_name: "Sinusal",
        category: "sinus",
        ventricular_rate_hz: 1.1667,
        pr_is_measurable: true,
        default_parameters: { heart_rate_hz: 1.1667 },
        editable_parameters: { heart_rate_hz: { minimum: 1.0, maximum: 1.6667, default: 1.1667 } },
        clinical_description: "...",
        references: [],
        allowed_overlays: [],
      })
    );
    const client = new CatalogClient({ baseUrl: "http://api.test/", fetchImpl });

    const detail = await client.getRhythm("sinus_normal");

    expect(fetchImpl).toHaveBeenCalledWith("http://api.test/api/rhythms/sinus_normal");
    expect(detail.editable_parameters.heart_rate_hz.maximum).toBeCloseTo(1.6667);
  });

  it("lanza si la respuesta no es ok", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, false, 404));
    const client = new CatalogClient({ baseUrl: "http://api.test", fetchImpl });

    await expect(client.getRhythm("no_existe")).rejects.toThrow(/404/);
  });
});
