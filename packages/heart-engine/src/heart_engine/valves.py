"""Ventanas de contracción → coreografía de las cuatro válvulas.

Una válvula no se abre porque se lo mande nadie: se abre cuando la presión de
un lado supera a la del otro. Ese es el hecho que ordena los cuatro instantes
de este módulo, y por eso viven en el servidor y no en el cliente 3D: son
fisiología, del mismo material que `pr_is_measurable` o el perfil mecánico de
un ritmo, y no la curva con que se dibuja el movimiento entre ellos.

El ciclo, para un latido:

    t_close_av      sístole ventricular. La presión del ventrículo supera a
                    la de su aurícula y la mitral y la tricúspide se cierran.
                    Es el primer ruido cardíaco.
    t_open_semi     la presión ventricular supera a la arterial: se abren la
                    aórtica y la pulmonar y empieza la eyección. Entre este
                    instante y el anterior las cuatro están cerradas — es la
                    contracción isovolumétrica.
    t_close_semi    la presión ventricular cae por debajo de la arterial y las
                    sigmoideas se cierran. Segundo ruido, fin de la sístole.
    t_open_av       la presión ventricular cae por debajo de la auricular: se
                    abren la mitral y la tricúspide y empieza el llenado.
                    Entre este instante y el anterior vuelven a estar las
                    cuatro cerradas — la relajación isovolumétrica.

Las dos parejas **no** son la una el negativo de la otra, y ese es justo el
detalle que distingue una animación fisiológica de una que alterna dos
estados: hay dos intervalos, cortos pero reales, con las cuatro cerradas.

Las aurículas no aparecen. La sístole auricular ocurre con las válvulas
auriculoventriculares ya abiertas —remata el llenado, no lo inicia—, así que
no mueve ninguna válvula. Una fibrilación auricular no cambia una sola de
estas cuatro cifras.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

from ecg_engine.mechanics import Chamber, MechanicalProfile

from .events import MechanicalEvent

MAX_ISOVOLUMETRIC_FRACTION = 0.4
"""Tope de la contracción isovolumétrica como fracción de la sístole.

Los 50 ms son sensiblemente constantes, pero la sístole se acorta con la
frecuencia: en una taquicardia ventricular a 250 lpm dura 96 ms, y sin tope
la fase isovolumétrica se comería más de la mitad. El tope garantiza que
siempre queda eyección, que es lo que la representación tiene que enseñar.
"""


@dataclass(frozen=True, slots=True)
class ValveEvent:
    """Los cuatro instantes de un ciclo ventricular.

    Ordenados por construcción: `t_close_av < t_open_semilunar <
    t_close_semilunar < t_open_av`. El cliente no calcula ninguno; solo mira
    en cuál de las ventanas cae el instante que está dibujando.
    """

    t_close_av_s: float
    t_open_semilunar_s: float
    t_close_semilunar_s: float
    t_open_av_s: float
    index: int

    def as_payload(self) -> dict:
        """Forma serializable, redondeada a milisegundos como las
        contracciones: el cliente interpola sobre estas ventanas y un
        microsegundo de más no mueve un píxel."""
        return {
            "t_close_av_s": round(self.t_close_av_s, 3),
            "t_open_semilunar_s": round(self.t_open_semilunar_s, 3),
            "t_close_semilunar_s": round(self.t_close_semilunar_s, 3),
            "t_open_av_s": round(self.t_open_av_s, 3),
            "index": self.index,
        }


def derive_valve_events(
    mechanical: Sequence[MechanicalEvent],
    profile: MechanicalProfile,
) -> list[ValveEvent]:
    """Coreografía valvular de las contracciones ventriculares dadas.

    Se parte de las contracciones ya derivadas y no de los eventos eléctricos
    porque la sístole ventricular es exactamente la ventana que ya se calculó
    ahí: recalcularla sería tener dos definiciones del mismo hecho, y el día
    que una cambie el corazón latiría a un ritmo y sus válvulas a otro.

    Las contracciones auriculares se ignoran, y no hay eventos cuando el
    ventrículo no se contrae de forma organizada: en una fibrilación
    ventricular `derive_mechanical_events` ya no produce ninguno, y sin
    sístole no hay nada que cierre una válvula. La lista sale vacía, que es la
    respuesta correcta y no un caso especial.
    """
    result: list[ValveEvent] = []

    for event in mechanical:
        if event.chamber is not Chamber.VENTRICLES:
            continue

        systole_s = event.t_end_s - event.t_start_s
        isovolumetric_s = min(
            profile.isovolumetric_contraction_s,
            systole_s * MAX_ISOVOLUMETRIC_FRACTION,
        )
        result.append(
            ValveEvent(
                t_close_av_s=event.t_start_s,
                t_open_semilunar_s=event.t_start_s + isovolumetric_s,
                t_close_semilunar_s=event.t_end_s,
                t_open_av_s=event.t_end_s + profile.isovolumetric_relaxation_s,
                index=event.index,
            )
        )

    return result
