from __future__ import annotations

import random
from typing import TYPE_CHECKING

from app.config import settings

if TYPE_CHECKING:
    from app.schemas import AgentSchema, Traits


PREGNANCY_DURATION_TICKS = 7200  # ساعتين بسرعة 1x


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
    # السماح بـ idle / walking للسماح باللقاء عند الوصول إلى tile معاً
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
    fertility = female_agent.traits.fertility
    if random.random() > max(0.15, min(0.85, fertility)):
        return False

    return True


def give_birth(mother: "AgentSchema", father: "AgentSchema", next_agent_id: int) -> "AgentSchema | None":
    """إجراء عملية الولادة — خلق كائن جديد بجينات الأبوين + طفرة عشوائية"""
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
        inventory=Inventory(wheat=0, wood=0, stone=0),
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


def inherit_traits(mother: "AgentSchema", father: "AgentSchema") -> "Traits":
    """توريث الصفات: متوسط صفات الأبوين ± طفرة عشوائية [-0.1, 0.1] لكل صفة"""
    from app.schemas import Traits

    def _clamp(v: float) -> float:
        return max(0.0, min(1.0, v))

    mutation = lambda: random.uniform(-0.1, 0.1)

    return Traits(
        courage=_clamp(((mother.traits.courage + father.traits.courage) / 2.0) + mutation()),
        intelligence=_clamp(((mother.traits.intelligence + father.traits.intelligence) / 2.0) + mutation()),
        fertility=_clamp(((mother.traits.fertility + father.traits.fertility) / 2.0) + mutation()),
        aggression=_clamp(((mother.traits.aggression + father.traits.aggression) / 2.0) + mutation()),
    )


def random_name() -> str:
    from app.simulation.agent import NAMES_POOL
    return random.choice(NAMES_POOL)
