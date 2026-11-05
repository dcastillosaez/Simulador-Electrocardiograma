"""Estado mecánico vigente del corazón.

Lo que no cabe en un evento: el modo de cada cámara y los parámetros del
temblor. Un evento dice "contráete ahora"; el estado dice "esta aurícula no
va a contraerse en absoluto, va a fibrilar a 7 Hz".

`values` es un mapa abierto, igual que en `measurements`: cuando exista el
modelo hemodinámico, `stroke_volume` y `contractility` entran aquí sin
romper a ningún cliente anterior, que se limita a ignorar lo que no conoce.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ecg_engine.mechanics import ContractionMode, MechanicalProfile


@dataclass(frozen=True, slots=True)
class HeartState:
    rhythm_id: str
    heart_rate_bpm: float | None
    atrial_mode: ContractionMode
    ventricular_mode: ContractionMode
    atrial_amplitude: float
    ventricular_amplitude: float
    flutter_hz: float

    @classmethod
    def from_profile(
        cls,
        profile: MechanicalProfile,
        rhythm_id: str,
        heart_rate_bpm: float | None,
    ) -> HeartState:
        return cls(
            rhythm_id=rhythm_id,
            heart_rate_bpm=heart_rate_bpm,
            atrial_mode=profile.atrial_mode,
            ventricular_mode=profile.ventricular_mode,
            atrial_amplitude=profile.atrial_amplitude,
            ventricular_amplitude=profile.ventricular_amplitude,
            flutter_hz=profile.flutter_hz,
        )

    def as_payload(self, t_s: float | None = None) -> dict[str, Any]:
        """`t_s` es el instante de simulación al que corresponde el estado.

        Con él el cliente guarda los cambios como tramos constantes, y el
        repaso recupera el modo de cada cámara en cualquier instante del
        papel: si el ritmo cambió hace seis segundos, volver atrás devuelve el
        corazón de entonces. Opcional para no romper a quien no lo pase."""
        payload: dict[str, Any] = {
            "type": "heart_state",
            "values": {
                "rhythm_id": self.rhythm_id,
                "heart_rate_bpm": self.heart_rate_bpm,
                "atrial_mode": self.atrial_mode.value,
                "ventricular_mode": self.ventricular_mode.value,
                "atrial_amplitude": self.atrial_amplitude,
                "ventricular_amplitude": self.ventricular_amplitude,
                "flutter_hz": self.flutter_hz,
            },
        }
        if t_s is not None:
            payload["t_s"] = round(t_s, 3)
        return payload
