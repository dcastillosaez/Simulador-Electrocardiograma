# -*- coding: utf-8 -*-
"""Vuelca los doce ritmos del catálogo a PNG, en formato de papel de ECG.

Existe para que un clínico pueda mirar lo que genera el motor sin montar
antes la API ni el frontend. El criterio de aceptación 7 de la fase 1 exige
esa revisión, y no se puede hacer leyendo ficheros `.npy`.

    uv run --extra viz python tools/render_rhythms.py

Escribe un PNG por ritmo en `tools/output/`, con la disposición clínica
estándar: las doce derivaciones en cuatro columnas de 2,5 s y una tira de
ritmo de la derivación II abajo, a 25 mm/s y 10 mm/mV.
"""

from __future__ import annotations

import pathlib

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.ticker import MultipleLocator  # noqa: E402

from ecg_engine import (  # noqa: E402
    LEAD_ORDER,
    AtrialActivity,
    EcgEngine,
    EngineParams,
    NoiseParams,
    list_rhythms,
    measure,
)

SEED = 20260725
SAMPLE_RATE_HZ = 500
DURATION_S = 10.0

MM_PER_S = 25.0       # velocidad de papel estándar
MM_PER_MV = 10.0      # calibración estándar

COLUMN_S = 2.5        # cada columna del panel de doce muestra 2,5 s
ROW_HEIGHT_MM = 32.0
STRIP_HEIGHT_MM = 34.0

# Disposición clínica: filas de cuatro, empezando por las de miembros.
PANEL = [
    ["I", "aVR", "V1", "V4"],
    ["II", "aVL", "V2", "V5"],
    ["III", "aVF", "V3", "V6"],
]
RHYTHM_LEAD = "II"

# Rejilla de papel de ECG: cuadrícula menor de 1 mm, mayor de 5 mm.
GRID_MINOR = "#f4c7c3"
GRID_MAJOR = "#e07a70"
TRACE_COLOR = "#1a1a1a"

# Ruido suave, para que el trazo no parezca sintético. Son niveles bajos:
# lo que se juzga aquí es la morfología, no la calidad del filtrado.
DISPLAY_NOISE = NoiseParams(emg_v=6e-6, mains_v=2e-6, baseline_v=2e-5)


def _draw_paper(ax, width_mm: float, height_mm: float) -> None:
    ax.set_xlim(0.0, width_mm)
    ax.set_ylim(-height_mm / 2.0, height_mm / 2.0)
    ax.xaxis.set_minor_locator(MultipleLocator(1.0))
    ax.xaxis.set_major_locator(MultipleLocator(5.0))
    ax.yaxis.set_minor_locator(MultipleLocator(1.0))
    ax.yaxis.set_major_locator(MultipleLocator(5.0))
    ax.grid(which="minor", color=GRID_MINOR, linewidth=0.4)
    ax.grid(which="major", color=GRID_MAJOR, linewidth=0.8)
    ax.set_xticklabels([])
    ax.set_yticklabels([])
    ax.tick_params(length=0)
    for spine in ax.spines.values():
        spine.set_visible(False)
    ax.set_aspect("equal")


def _plot_segment(ax, signal_v, lead, t0_s, t1_s, x_offset_mm, y_offset_mm):
    """Dibuja un tramo de una derivación desplazado dentro del panel."""
    row = LEAD_ORDER.index(lead)
    i0 = int(t0_s * SAMPLE_RATE_HZ)
    i1 = int(t1_s * SAMPLE_RATE_HZ)
    trace_mv = signal_v[row, i0:i1] * 1000.0

    x_mm = x_offset_mm + np.arange(i1 - i0) / SAMPLE_RATE_HZ * MM_PER_S
    y_mm = y_offset_mm + trace_mv * MM_PER_MV

    ax.plot(x_mm, y_mm, color=TRACE_COLOR, linewidth=0.9, solid_joinstyle="round")
    ax.text(
        x_offset_mm + 1.5,
        y_offset_mm + 9.0,
        lead,
        fontsize=8,
        fontweight="bold",
        color=TRACE_COLOR,
    )


def _caption(definition, measurements) -> str:
    """Pie con lo que un clínico contrastaría de un vistazo."""
    pulse = definition.ventricular_rate_hz * 60.0
    parts = [f"pulso {pulse:.0f} lpm" if pulse else "sin pulso medible"]

    # La auricular solo cuando aporta algo: en un ritmo conducido 1:1 repetir
    # el mismo número dos veces es ruido, y en una FA no hay número. Se
    # compara con la ventricular MEDIDA y no con el pulso nominal del
    # catálogo: los dos números medidos salen de la misma ventana de diez
    # segundos, y contra el nominal cualquier redondeo delataría una
    # diferencia que no existe.
    atrial_bpm = measurements.atrial_rate_hz * 60.0
    ventricular_bpm = measurements.ventricular_rate_hz * 60.0
    if not np.isnan(atrial_bpm) and (
        np.isnan(ventricular_bpm) or abs(atrial_bpm - ventricular_bpm) > 2.0
    ):
        parts.append(f"aurículas {atrial_bpm:.0f} lpm")

    if definition.pr_is_measurable and not np.isnan(measurements.pr_mean_s):
        parts.append(f"PR {measurements.pr_mean_s * 1000:.0f} ms")
    else:
        parts.append("sin PR")

    if not np.isnan(measurements.qrs_duration_s):
        parts.append(f"QRS {measurements.qrs_duration_s * 1000:.0f} ms")
    if not np.isnan(measurements.rr_std_s):
        parts.append(f"desviación RR {measurements.rr_std_s * 1000:.0f} ms")

    return " · ".join(parts)


def render(definition, out_dir: pathlib.Path) -> pathlib.Path:
    engine = EcgEngine(
        rhythm_id=definition.rhythm_id, seed=SEED, sample_rate_hz=SAMPLE_RATE_HZ
    )
    engine.update_params(
        EngineParams(
            heart_rate_hz=engine.params.heart_rate_hz, noise=DISPLAY_NOISE
        )
    )
    signal_v = engine.generate(int(DURATION_S * SAMPLE_RATE_HZ))

    source = engine.source
    events = source.events(0.0, DURATION_S) if hasattr(source, "events") else []
    measurements = measure(
        events,
        signal_v,
        SAMPLE_RATE_HZ,
        definition.pr_is_measurable,
        definition.atrial_activity is AtrialActivity.ORGANIZED,
    )

    width_mm = DURATION_S * MM_PER_S
    height_mm = len(PANEL) * ROW_HEIGHT_MM + STRIP_HEIGHT_MM

    fig, ax = plt.subplots(figsize=(width_mm / 25.4, height_mm / 25.4), dpi=160)
    _draw_paper(ax, width_mm, height_mm)

    top_mm = height_mm / 2.0
    for r, row_leads in enumerate(PANEL):
        y = top_mm - ROW_HEIGHT_MM * (r + 0.5)
        for c, lead in enumerate(row_leads):
            _plot_segment(
                ax,
                signal_v,
                lead,
                c * COLUMN_S,
                (c + 1) * COLUMN_S,
                c * COLUMN_S * MM_PER_S,
                y,
            )

    strip_y = top_mm - len(PANEL) * ROW_HEIGHT_MM - STRIP_HEIGHT_MM / 2.0
    _plot_segment(ax, signal_v, RHYTHM_LEAD, 0.0, DURATION_S, 0.0, strip_y)

    ax.set_title(
        f"{definition.display_name}\n{_caption(definition, measurements)}",
        fontsize=11,
        fontweight="bold",
        color=TRACE_COLOR,
        pad=12,
    )
    fig.text(
        0.99,
        0.01,
        "25 mm/s · 10 mm/mV",
        ha="right",
        fontsize=7,
        color="#666666",
    )

    out_path = out_dir / f"{definition.rhythm_id}.png"
    fig.savefig(out_path, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    return out_path


def main() -> None:
    out_dir = pathlib.Path(__file__).parent / "output"
    out_dir.mkdir(exist_ok=True)

    for definition in list_rhythms():
        path = render(definition, out_dir)
        print(f"  {path.name}")

    print(f"\n{len(list_rhythms())} trazados escritos en {out_dir}")


if __name__ == "__main__":
    main()
