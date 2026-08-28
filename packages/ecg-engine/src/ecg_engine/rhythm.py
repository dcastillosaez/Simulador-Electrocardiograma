"""Trenes de eventos cardíacos.

Un tren emite eventos a su propia frecuencia y no sabe nada de conducción.
El tren auricular emite ondas P; el de escape ventricular emite QRS cuando
el nodo AV no conduce nada.

Dos implementaciones:

- `EventTrain` incorpora variabilidad fisiológica, así que su jitter consume
  el RNG de forma secuencial. La línea temporal se genera hacia adelante
  desde el origen y se cachea; esa caché es lo que garantiza que renderizar
  por chunks dé el mismo resultado que renderizar de una vez.
- `RegularTrain` es un metrónomo puro, sin estado ni RNG. Sirve para el
  flutter a 300/min y para los escapes, donde la variabilidad no aporta
  realismo sino confusión.

Las ventanas son semiabiertas `[t0, t1)`, de modo que chunks consecutivos
nunca duplican un evento.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from .types import CardiacEvent, EventKind, VariabilityParams
from .variability import next_rr_s


class EventTrain:
    """Tren con variabilidad fisiológica y línea temporal cacheada."""

    def __init__(
        self,
        kind: EventKind,
        template_id: str,
        rate_hz: float,
        variability: VariabilityParams,
        rng: np.random.Generator,
    ) -> None:
        if rate_hz <= 0.0:
            raise ValueError(f"rate_hz debe ser positivo, recibido {rate_hz}")
        self.kind = kind
        self.template_id = template_id
        self._rate_hz = rate_hz
        self._variability = variability
        self._rng = rng
        self._times_s: list[float] = [0.0]

    def set_rate_hz(self, rate_hz: float) -> None:
        """Cambia la frecuencia. Solo afecta a los eventos aún no generados."""
        if rate_hz <= 0.0:
            raise ValueError(f"rate_hz debe ser positivo, recibido {rate_hz}")
        self._rate_hz = rate_hz

    def _extend_until(self, t_s: float) -> None:
        while self._times_s[-1] < t_s:
            last_s = self._times_s[-1]
            rr_s = next_rr_s(
                base_rr_s=1.0 / self._rate_hz,
                t_s=last_s,
                params=self._variability,
                rng=self._rng,
            )
            self._times_s.append(last_s + rr_s)

    def events(self, t0_s: float, t1_s: float) -> list[CardiacEvent]:
        self._extend_until(t1_s)
        return [
            CardiacEvent(
                kind=self.kind,
                t_s=t_s,
                template_id=self.template_id,
                index=index,
            )
            for index, t_s in enumerate(self._times_s)
            if t0_s <= t_s < t1_s
        ]


@dataclass(frozen=True, slots=True)
class SilentTrain:
    """Un tren que no emite nada.

    Existe para poder decir «esta cámara no despolariza» sin inventar un caso
    especial aguas abajo: `BeatBasedSource` sigue teniendo un tren auricular,
    la política de conducción sigue recibiendo una lista, y quien late es el
    escape. Es la forma que toma una aurícula parada —y, el día que llegue,
    la asistolia completa— sin un solo `if` fuera de aquí.
    """

    kind: EventKind = EventKind.ATRIAL

    def set_rate_hz(self, rate_hz: float) -> None:
        """Sin eventos que espaciar, la frecuencia no significa nada."""
        return None

    def events(self, t0_s: float, t1_s: float) -> list[CardiacEvent]:
        return []


@dataclass(frozen=True, slots=True)
class RegularTrain:
    """Tren perfectamente regular: sin variabilidad, sin estado, sin RNG."""

    kind: EventKind
    template_id: str
    rate_hz: float

    def __post_init__(self) -> None:
        if self.rate_hz <= 0.0:
            raise ValueError(f"rate_hz debe ser positivo, recibido {self.rate_hz}")

    def set_rate_hz(self, rate_hz: float) -> None:
        """No hace nada: la frecuencia de un tren regular es estructural.

        El flutter despolariza la aurícula a 300 por minuto y un escape
        ventricular late a 40. Esos números definen el ritmo; no son un
        ajuste del usuario. Quien controla la frecuencia que el usuario sí
        puede tocar es el catálogo, mediante `editable_parameters`.
        """
        return None

    def events(self, t0_s: float, t1_s: float) -> list[CardiacEvent]:
        interval_s = 1.0 / self.rate_hz
        # El rango candidato se ensancha un índice a cada lado a propósito,
        # de modo que el filtro de abajo sea el único árbitro y use la misma
        # operación `index * interval_s` que decide la pertenencia. Calcular
        # los extremos por división y filtrar por multiplicación son dos
        # redondeos distintos: un evento cuyo instante caiga a un ULP de una
        # frontera se escapa por la grieta entre dos trozos y no aparece en
        # ninguno. A 200 lpm eso perdía el 10 % de los latidos.
        first = max(0, math.floor(t0_s / interval_s) - 1)
        last = math.ceil(t1_s / interval_s) + 1
        return [
            CardiacEvent(
                kind=self.kind,
                t_s=index * interval_s,
                template_id=self.template_id,
                index=index,
            )
            for index in range(first, last)
            if t0_s <= index * interval_s < t1_s
        ]
