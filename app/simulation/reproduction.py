from __future__ import annotations

import random
from typing import TYPE_CHECKING

from app.config import HUMAN_TRAITS, HUMAN_TRAITS_EXTRA, settings

if TYPE_CHECKING:
    from app.schemas import AgentSchema, Traits


PREGNANCY_DURATION_TICKS = 7200  # ساعتين بسرعة 1x

MUTATION_RATE = 0.05
MUTATION_MAGNITUDE = 0.15
NEW_TRAIT_CHANCE = 0.005


def check_reproduction(agent: "AgentSchema", partner: "AgentSchema") -> bool:
    """التحقق من تحقق جميع شروط التكاثر بين كائنين"""
    from app.schemas import AGENT_STATES

    if agent is None or partner is None:
        return False
    if agent.state == "dead" or partner.state == "dead":
        return False
    if agent.gender == partner.gender:
        return False
    if agent.pregnancy_ticks != 0 or partner.pregnancy_ticks != 0:
        return False
    social_ok = {"idle", "walking"}
    if agent.state not in social_ok or partner.state not in social_ok:
        return False
    if agent.x != partner.x or agent.y != partner.y:
        return False

    trust_1_to_2 = agent.relationships.get(partner.id, 0.0)
    trust_2_to_1 = partner.relationships.get(agent.id, 0.0)
    if trust_1_to_2 < 50.0 or trust_2_to_1 < 50.0:
        return False

    female_agent = agent if agent.gender == "female" else partner
    fertility = getattr(female_agent.traits, "fertility", 0.5)
    if random.random() > max(0.15, min(0.85, float(fertility))):
        return False

    return True


def give_birth(mother: "AgentSchema", father: "AgentSchema", next_agent_id: int) -> "AgentSchema | None":
    """إجراء عملية الولادة — خلق كائن جديد بجينات الأبوين + طفرة"""
    from app.schemas import AgentSchema, Inventory

    if mother.gender != "female":
        return None

    baby_traits = inherit_traits(mother, father)

    new_x = max(0, min(settings.GRID_SIZE - 1, mother.x + random.randint(-1, 1)))
    new_y = max(0, min(settings.GRID_SIZE - 1, mother.y + random.randint(-1, 1)))

    baby = AgentSchema(
        id=next_agent_id,
        name=random_name(),
        x=new_x,
        y=new_y,
        gender=random.choice(["male", "female"]),
        age=0,
        hp=100.0,
        hunger=float(random.randint(0, 20)),
        energy=float(random.randint(80, 100)),
        mood=float(random.randint(0, 30)),
        money=25.0,
        inventory=Inventory(),
        traits=baby_traits,
        state="idle",
        pregnancy_ticks=0,
        pregnancy_partner_id=None,
        mother_id=mother.id,
        father_id=father.id,
        relationships={},
        last_decision_tick=0,
    )
    return baby


def _traits_to_dict(traits_obj: "Traits") -> dict:
    """تحويل كائن Traits (BaseModel) إلى قاموس عادي"""
    try:
        return {k: float(v) for k, v in traits_obj.model_dump().items()}
    except Exception:
        return {}


def inherit_traits(mother: "AgentSchema", father: "AgentSchema") -> "Traits":
    """توريث الصفات من الأبوين مع نظام الطفرات الجينية
    - 5% فرصة طفرة لكل صفة بمقدار ±0.15
    - 0.5% فرصة لظهور صفة إضافية جديدة (charisma/discipline/resilience)
    """
    from app.schemas import Traits

    mother_traits_d = _traits_to_dict(mother.traits)
    father_traits_d = _traits_to_dict(father.traits)

    all_possible = HUMAN_TRAITS + HUMAN_TRAITS_EXTRA

    def _clamp(v: float) -> float:
        return max(0.0, min(1.0, v))

    final_values: dict[str, float] = {}

    for trait in all_possible:
        m_val = float(mother_traits_d.get(trait, 0.5))
        f_val = float(father_traits_d.get(trait, 0.5))
        base_val = (m_val + f_val) / 2.0

        final_val = base_val
        if random.random() < MUTATION_RATE:
            mutation = random.uniform(-MUTATION_MAGNITUDE, MUTATION_MAGNITUDE)
            final_val = _clamp(base_val + mutation)

        if trait not in HUMAN_TRAITS and random.random() < NEW_TRAIT_CHANCE:
            final_val = random.uniform(0.3, 0.7)

        final_values[trait] = round(final_val, 2)

    return Traits(**final_values)


def random_name() -> str:
    from app.simulation.agent import NAMES_POOL
    return random.choice(NAMES_POOL)
