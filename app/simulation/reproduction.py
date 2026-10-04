from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.schemas import AgentSchema, Traits


PREGNANCY_DURATION_TICKS = 300  # 5 دقائق بسرعة 1x


# الفحص الشروط للتكاثر — فارغ حالياً
def check_reproduction(agent: "AgentSchema") -> bool:
    return False


# إجراء عملية الولادة — فارغة حالياً، تُملأ في المرحلة 3
def give_birth(mother: "AgentSchema", father: "AgentSchema") -> "AgentSchema | None":
    return None


# توريث الصفات — حالياً تعيد متوسط الصفات
def inherit_traits(mother: "AgentSchema", father: "AgentSchema") -> "Traits":
    from app.schemas import Traits

    return Traits(
        courage=(mother.traits.courage + father.traits.courage) / 2.0,
        intelligence=(mother.traits.intelligence + father.traits.intelligence) / 2.0,
        fertility=(mother.traits.fertility + father.traits.fertility) / 2.0,
        aggression=(mother.traits.aggression + father.traits.aggression) / 2.0,
    )
