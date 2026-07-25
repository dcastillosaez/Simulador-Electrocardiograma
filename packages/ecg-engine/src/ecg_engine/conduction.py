"""Políticas de conducción auriculoventricular.

El tren auricular emite ondas P y no sabe nada de bloqueos. Estas políticas
consumen esos eventos y deciden cuáles conducen y con qué PR.

Toda política es determinista **a partir del índice del evento**, nunca del
número de llamadas recibidas. Ese detalle es lo que permite renderizar la
señal por chunks sin que el resultado dependa de dónde caigan las fronteras.

Añadir Mobitz II o preexcitación consiste en escribir una política nueva
aquí, sin tocar los trenes.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, Sequence, runtime_checkable

import numpy as np

from .types import CardiacEvent, EventKind


@runtime_checkable
class ConductionPolicy(Protocol):
    """Convierte eventos auriculares en eventos ventriculares."""

    def conduct(
        self, atrial: Sequence[CardiacEvent], rng: np.random.Generator
    ) -> list[CardiacEvent]: ...


def _ventricular(source: CardiacEvent, pr_s: float, template_id: str) -> CardiacEvent:
    """Crea el QRS que resulta de conducir una P, conservando su índice."""
    return CardiacEvent(
        kind=EventKind.VENTRICULAR,
        t_s=source.t_s + pr_s,
        template_id=template_id,
        index=source.index,
    )


@dataclass(frozen=True, slots=True)
class FixedPR:
    """Conducción 1:1 con PR constante.

    Cubre el ritmo sinusal, las taquicardias y bradicardias sinusales, la
    TSV y —con un `pr_s` largo— el bloqueo AV de primer grado. El bloqueo de
    primer grado no merece una política propia: es exactamente esto.
    """

    pr_s: float
    template_id: str = "normal_qrst"

    def conduct(
        self, atrial: Sequence[CardiacEvent], rng: np.random.Generator
    ) -> list[CardiacEvent]:
        return [_ventricular(p, self.pr_s, self.template_id) for p in atrial]


@dataclass(frozen=True, slots=True)
class WenckebachPR:
    """Mobitz I: el PR se alarga hasta que un latido no conduce.

    Dentro de cada ciclo de `cycle_length` ondas P, la posición `i` conduce
    con `pr_base_s + i * pr_increment_s`, salvo la última, que se bloquea.
    Tras la caída, el PR vuelve al valor base.
    """

    pr_base_s: float
    pr_increment_s: float
    cycle_length: int
    template_id: str = "normal_qrst"

    def __post_init__(self) -> None:
        if self.cycle_length < 2:
            raise ValueError(
                f"cycle_length debe ser al menos 2, recibido {self.cycle_length}"
            )

    def conduct(
        self, atrial: Sequence[CardiacEvent], rng: np.random.Generator
    ) -> list[CardiacEvent]:
        conducted: list[CardiacEvent] = []
        for p in atrial:
            position = p.index % self.cycle_length
            if position == self.cycle_length - 1:
                continue  # latido caído
            pr_s = self.pr_base_s + position * self.pr_increment_s
            conducted.append(_ventricular(p, pr_s, self.template_id))
        return conducted


@dataclass(frozen=True, slots=True)
class FixedRatioBlock:
    """Conducción n:1 con PR constante.

    Es la política del flutter auricular (2:1, 4:1) y serviría igual para un
    Mobitz II, que no entra en el MVP.
    """

    ratio: int
    pr_s: float
    template_id: str = "normal_qrst"

    def __post_init__(self) -> None:
        if self.ratio < 2:
            raise ValueError(f"ratio debe ser al menos 2, recibido {self.ratio}")

    def conduct(
        self, atrial: Sequence[CardiacEvent], rng: np.random.Generator
    ) -> list[CardiacEvent]:
        return [
            _ventricular(p, self.pr_s, self.template_id)
            for p in atrial
            if p.index % self.ratio == 0
        ]


@dataclass(frozen=True, slots=True)
class CompleteBlock:
    """BAV de tercer grado: ninguna P alcanza el ventrículo.

    Los QRS no desaparecen: los aporta una fuente de escape ventricular
    independiente, configurada en el catálogo. Aquí simplemente no se
    conduce nada, que es justo lo que ocurre en el nodo AV.
    """

    def conduct(
        self, atrial: Sequence[CardiacEvent], rng: np.random.Generator
    ) -> list[CardiacEvent]:
        return []


class IrregularConduction:
    """Conducción irregular de la fibrilación auricular.

    Es la única política **con estado**, y por dos motivos independientes.

    El primero es clínico: en la FA la frecuencia que importa es la respuesta
    ventricular, y esa la fija el nodo AV, no la aurícula. Controlar la
    frecuencia de una FA significa mover `mean_rr_s`, que es justo lo que hace
    un frenador del nodo AV. De ahí que sea mutable.

    El segundo es de determinismo. Las demás políticas derivan su
    comportamiento del índice del evento auricular, así que son puras. Esta no
    puede: la irregularidad del RR sale del RNG, y sortear en cada llamada
    haría que el resultado dependiera de dónde caigan las fronteras de chunk.
    Por eso mantiene una línea temporal cacheada que solo crece hacia adelante,
    exactamente el mismo patrón que `EventTrain`. Sin esa caché, renderizar
    10 s de una vez y renderizar cien chunks de 100 ms darían señales
    distintas, y los golden de muestras y de eventos describirían latidos
    diferentes sin que ningún test lo delatara.

    La actividad auricular en la FA es caótica y de alta frecuencia; el nodo AV
    deja pasar impulsos de forma impredecible. El resultado es un RR
    genuinamente irregular, no un RR regular con ruido encima.
    """

    _MIN_RR_S: float = 0.24

    def __init__(
        self,
        mean_rr_s: float,
        rr_spread_s: float,
        template_id: str = "normal_qrst",
    ) -> None:
        self.mean_rr_s = mean_rr_s
        self.rr_spread_s = rr_spread_s
        self.template_id = template_id
        self._times_s: list[float] = [0.0]

    def set_rate_hz(self, rate_hz: float) -> None:
        """Ajusta la respuesta ventricular media.

        Solo afecta a los latidos aún no generados: la caché ya emitida no se
        reescribe, igual que en `EventTrain`.
        """
        if rate_hz <= 0.0:
            raise ValueError(f"rate_hz debe ser positivo, recibido {rate_hz}")
        self.mean_rr_s = 1.0 / rate_hz

    def _extend_until(self, t_s: float, rng: np.random.Generator) -> None:
        while self._times_s[-1] < t_s:
            step_s = float(rng.normal(self.mean_rr_s, self.rr_spread_s))
            self._times_s.append(self._times_s[-1] + max(step_s, self._MIN_RR_S))

    def conduct(
        self, atrial: Sequence[CardiacEvent], rng: np.random.Generator
    ) -> list[CardiacEvent]:
        if not atrial:
            return []
        start_s = atrial[0].t_s
        end_s = atrial[-1].t_s
        self._extend_until(end_s, rng)
        return [
            CardiacEvent(
                kind=EventKind.VENTRICULAR,
                t_s=t_s,
                template_id=self.template_id,
                index=index,
            )
            for index, t_s in enumerate(self._times_s)
            if start_s <= t_s <= end_s
        ]
