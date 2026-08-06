"""Interacciones farmacológicas, como reglas declarativas.

Una interacción es un dato: qué participantes la disparan y qué efecto
extra añade. No hay ni un `if` que nombre una molécula. Añadir la
interacción entre dos fármacos nuevos es añadir una `InteractionRule` a
`INTERACTION_RULES`, y ninguna otra parte del sistema se entera.

El módulo recibe la lista de fármacos activos con su intensidad y devuelve
un efecto **adicional**: nunca reescribe el efecto de nadie. Eso mantiene la
superposición asociativa y hace que quitar una regla del catálogo devuelva
exactamente el comportamiento anterior.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Mapping

from .models import DrugCategory, DrugEffect, combine, scale


@dataclass(frozen=True, slots=True)
class Participant:
    """Quién puede ocupar una plaza de la regla.

    Por id, por categoría, o por ambos: `drug_ids` y `categories` se unen,
    no se intersecan. Es lo que permite escribir «cualquier betabloqueante»
    sin enumerarlos y «verapamilo o diltiazem» sin inventar una categoría.
    """

    drug_ids: frozenset[str] = frozenset()
    categories: frozenset[DrugCategory] = frozenset()

    def matches(self, drug_id: str, category: DrugCategory) -> bool:
        return drug_id in self.drug_ids or category in self.categories


@dataclass(frozen=True, slots=True)
class InteractionRule:
    """Una interacción. Se dispara si todas sus plazas quedan cubiertas por
    fármacos **distintos**.

    Lo de «distintos» importa: sin esa restricción, la regla
    «betabloqueante + calcioantagonista» se dispararía con verapamilo solo
    si alguien lo listara en las dos plazas por error, y la de
    «antiarrítmico + antiarrítmico» se dispararía con una sola amiodarona.
    """

    rule_id: str
    description: str
    participants: tuple[Participant, ...]
    effect: DrugEffect
    clinical_note: str = ""
    references: tuple[str, ...] = field(default=())

    def __post_init__(self) -> None:
        if len(self.participants) < 2:
            raise ValueError(
                f"{self.rule_id}: una interacción necesita al menos dos "
                "participantes"
            )


@dataclass(frozen=True, slots=True)
class FiredInteraction:
    """Una regla que se disparó, con la intensidad resultante. Es lo que la
    interfaz muestra al usuario: «esto está pasando y por esto»."""

    rule_id: str
    description: str
    intensity: float
    drug_ids: tuple[str, ...]


def _assign(
    rule: InteractionRule, active: Mapping[str, tuple[DrugCategory, float]]
) -> tuple[float, tuple[str, ...]] | None:
    """Empareja plazas con fármacos activos, sin repetir fármaco.

    Emparejamiento voraz por orden de plaza, eligiendo en cada una el
    candidato de mayor intensidad. Con dos o tres plazas —el tamaño de toda
    interacción real— el voraz coincide con el óptimo, y a cambio el
    algoritmo es trivialmente determinista, que es lo que exige el replay.
    """
    used: set[str] = set()
    chosen: list[str] = []
    intensities: list[float] = []
    for participant in rule.participants:
        candidates = [
            (intensity, drug_id)
            for drug_id, (category, intensity) in active.items()
            if drug_id not in used and participant.matches(drug_id, category)
        ]
        if not candidates:
            return None
        intensity, drug_id = max(candidates, key=lambda c: (c[0], c[1]))
        used.add(drug_id)
        chosen.append(drug_id)
        intensities.append(intensity)
    return min(intensities), tuple(chosen)


def evaluate(
    active: Mapping[str, tuple[DrugCategory, float]],
    rules: tuple[InteractionRule, ...] | None = None,
) -> tuple[DrugEffect, tuple[FiredInteraction, ...]]:
    """Efecto adicional por interacciones, y el detalle de qué se disparó.

    La intensidad de una regla es la **mínima** de sus participantes: una
    interacción no puede ser más fuerte que el más débil de los fármacos que
    la producen. Con la máxima, una traza de verapamilo residual daría el
    bloqueo AV completo de la interacción a plena potencia.
    """
    rules = INTERACTION_RULES if rules is None else rules
    effects: list[DrugEffect] = []
    fired: list[FiredInteraction] = []
    for rule in rules:
        assignment = _assign(rule, active)
        if assignment is None:
            continue
        intensity, drug_ids = assignment
        if intensity <= 0.0:
            continue
        effects.append(scale(rule.effect, min(intensity, 1.0)))
        fired.append(
            FiredInteraction(
                rule_id=rule.rule_id,
                description=rule.description,
                intensity=round(min(intensity, 1.0), 4),
                drug_ids=drug_ids,
            )
        )
    return combine(effects), tuple(fired)


_RATE_CONTROL_CCB = Participant(drug_ids=frozenset({"verapamil", "diltiazem"}))
_BETA_BLOCKER = Participant(categories=frozenset({DrugCategory.BETA_BLOCKER}))
_QT_PROLONGING = Participant(
    drug_ids=frozenset({"amiodarone", "procainamide", "digoxin"})
)


INTERACTION_RULES: tuple[InteractionRule, ...] = (
    InteractionRule(
        rule_id="ccb_beta_blocker_av",
        description="Calcioantagonista + betabloqueante: bloqueo AV sumado",
        participants=(_RATE_CONTROL_CCB, _BETA_BLOCKER),
        effect=DrugEffect(
            av_conduction=0.70,
            pr_delta_ms=25.0,
            heart_rate_delta_bpm=-8.0,
            contractility=0.85,
            blood_pressure_delta_mmhg=-10.0,
        ),
        clinical_note=(
            "La combinación clásica que hay que evitar por vía intravenosa: "
            "el freno nodal y el inotrópico negativo se suman y pueden acabar "
            "en bloqueo completo con hipotensión."
        ),
        references=("ESC 2020 — Atrial fibrillation",),
    ),
    InteractionRule(
        rule_id="dual_qt_prolongation",
        description="Dos fármacos que alargan el QT: prolongación aditiva",
        participants=(
            Participant(drug_ids=frozenset({"amiodarone"})),
            Participant(drug_ids=frozenset({"procainamide"})),
        ),
        effect=DrugEffect(qt_delta_ms=25.0, ventricular_conduction=0.92),
        clinical_note=(
            "Amiodarona con un clase Ia multiplica el riesgo de torsade. El "
            "QT extra de esta regla es el que no se explica sumando los dos "
            "efectos por separado."
        ),
        references=("ESC 2022 — Ventricular arrhythmias",),
    ),
    InteractionRule(
        rule_id="digoxin_av_potentiation",
        description="Digoxina + frenador nodal: bloqueo AV potenciado",
        participants=(
            Participant(drug_ids=frozenset({"digoxin"})),
            Participant(
                drug_ids=frozenset({"verapamil", "diltiazem", "amiodarone"}),
                categories=frozenset({DrugCategory.BETA_BLOCKER}),
            ),
        ),
        effect=DrugEffect(
            av_conduction=0.75,
            pr_delta_ms=20.0,
            automaticity=1.30,
            heart_rate_delta_bpm=-6.0,
        ),
        clinical_note=(
            "Verapamilo y amiodarona elevan la digoxinemia. El resultado "
            "docente es el patrón de intoxicación digitálica: bloqueo AV con "
            "automatismo ectópico aumentado."
        ),
        references=("ESC 2021 — Heart failure",),
    ),
    InteractionRule(
        rule_id="beta_blockade_blunts_atropine",
        description="Betabloqueante + atropina: respuesta cronotrópica atenuada",
        participants=(
            _BETA_BLOCKER,
            Participant(categories=frozenset({DrugCategory.PARASYMPATHOLYTIC})),
        ),
        effect=DrugEffect(heart_rate_delta_bpm=-12.0, sinus_rate=0.92),
        clinical_note=(
            "Retirar el freno vagal no sirve de nada si el freno simpático "
            "sigue puesto: la atropina apenas sube la frecuencia en un "
            "paciente betabloqueado."
        ),
        references=("AHA ACLS 2020 — Adult Bradycardia Algorithm",),
    ),
    InteractionRule(
        rule_id="unopposed_alpha",
        description="Betabloqueante + simpaticomimético: alfa sin oposición",
        participants=(
            _BETA_BLOCKER,
            Participant(drug_ids=frozenset({"epinephrine", "norepinephrine"})),
        ),
        effect=DrugEffect(
            blood_pressure_delta_mmhg=22.0,
            heart_rate_delta_bpm=-10.0,
            oxygen_consumption=1.15,
        ),
        clinical_note=(
            "Con los receptores beta bloqueados, la vasodilatación beta-2 "
            "desaparece y solo queda la vasoconstricción alfa: sube la "
            "presión más de lo esperado y baja la frecuencia."
        ),
        references=("AHA ACLS 2020 — Adult Cardiac Arrest Algorithm",),
    ),
    InteractionRule(
        rule_id="magnesium_rescues_qt",
        description="Magnesio + fármaco que alarga el QT: acortamiento extra",
        participants=(
            Participant(drug_ids=frozenset({"magnesium_sulfate"})),
            _QT_PROLONGING,
        ),
        effect=DrugEffect(qt_delta_ms=-20.0, automaticity=0.90),
        clinical_note=(
            "La única interacción del catálogo que corrige en vez de agravar: "
            "es el antídoto del QT largo adquirido y el simulador debe "
            "mostrar que funciona."
        ),
        references=("AHA ACLS 2020 — Torsades de pointes",),
    ),
)
