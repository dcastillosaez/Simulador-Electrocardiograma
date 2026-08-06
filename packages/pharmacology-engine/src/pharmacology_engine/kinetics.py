"""Farmacocinética simplificada: cuánta molécula hay activa en el instante t.

No hay compartimentos, ni aclaramiento renal, ni unión a proteínas — la
Fase F los declara explícitamente fuera de alcance. Lo que sí hay es una
curva concentración-tiempo con las cuatro constantes que un clínico
reconoce y que un docente puede explicar: inicio, pico, semivida y
duración.

La curva es una función pura del tiempo transcurrido. No guarda estado, no
usa aleatoriedad y no depende de cuántas veces se le llame: dos
evaluaciones en el mismo `t` devuelven el mismo número bit a bit, que es
la condición para que el replay sea exacto.
"""

from __future__ import annotations

from dataclasses import dataclass


def _smoothstep(x: float) -> float:
    """Rampa suave 0→1 con derivada nula en ambos extremos.

    Una rampa lineal produciría un codo en el inicio de acción: la
    frecuencia daría un salto de pendiente visible en el trazado justo al
    minuto de administrar. `3x² − 2x³` arranca y termina plana, así que el
    efecto entra y satura sin escalones.
    """
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    return x * x * (3.0 - 2.0 * x)


@dataclass(frozen=True, slots=True)
class ConcentrationCurve:
    """Curva concentración-tiempo normalizada a [0, 1].

    Tres tramos:

    * antes de `onset_s`: cero. El fármaco está administrado pero no actúa.
    * de `onset_s` a `peak_s`: rampa suave hasta el 100 %.
    * de `peak_s` a `duration_s`: decaimiento exponencial de semivida
      `half_life_s`, **renormalizado** para llegar a cero exactamente en
      `duration_s`.

    Esa renormalización es la parte no obvia. Un decaimiento exponencial
    puro nunca llega a cero, así que o se trunca —y entonces el efecto
    desaparece de golpe, con un escalón en el ECG— o se deja vivo para
    siempre y la lista de fármacos activos crece sin fin durante una
    guardia. Restar el valor terminal y reescalar da una curva continua,
    monótona decreciente, que vale 1.0 en el pico y 0.0 en la duración.
    """

    onset_s: float
    peak_s: float
    duration_s: float
    half_life_s: float

    def __post_init__(self) -> None:
        if not 0.0 <= self.onset_s <= self.peak_s <= self.duration_s:
            raise ValueError(
                "la curva exige 0 ≤ onset ≤ peak ≤ duration, recibido "
                f"onset={self.onset_s}, peak={self.peak_s}, "
                f"duration={self.duration_s}"
            )
        if self.half_life_s <= 0.0:
            raise ValueError(f"half_life debe ser positiva, recibido {self.half_life_s}")

    def _decay(self, elapsed_s: float) -> float:
        return 0.5 ** ((elapsed_s - self.peak_s) / self.half_life_s)

    def at(self, elapsed_s: float) -> float:
        """Concentración normalizada tras `elapsed_s` desde la administración."""
        if elapsed_s < self.onset_s or elapsed_s >= self.duration_s:
            return 0.0
        if elapsed_s < self.peak_s:
            span = self.peak_s - self.onset_s
            if span <= 0.0:
                return 1.0
            return _smoothstep((elapsed_s - self.onset_s) / span)
        terminal = self._decay(self.duration_s)
        if terminal >= 1.0:  # semivida absurdamente larga frente a la duración
            return 1.0
        return max(0.0, (self._decay(elapsed_s) - terminal) / (1.0 - terminal))

    def remaining_s(self, elapsed_s: float) -> float:
        """Segundos que le quedan al fármaco. Cero si ya se agotó."""
        return max(0.0, self.duration_s - elapsed_s)

    def is_active(self, elapsed_s: float) -> bool:
        """Un fármaco administrado pero aún en periodo de latencia cuenta
        como activo: el usuario acaba de darlo y tiene que verlo en la
        lista, aunque su concentración sea todavía cero."""
        return 0.0 <= elapsed_s < self.duration_s


def default_half_life_s(duration_s: float, peak_s: float) -> float:
    """Semivida implícita cuando el catálogo no la declara.

    Un quinto de la ventana de decaimiento: al llegar a `duration_s` el
    decaimiento crudo vale 2⁻⁵ ≈ 3 %, así que la renormalización de
    `ConcentrationCurve` apenas deforma la curva. Elegir la mitad, en
    cambio, dejaría un 25 % de efecto residual en el instante del corte y la
    renormalización sería visible.
    """
    window = max(duration_s - peak_s, 1.0)
    return window / 5.0
