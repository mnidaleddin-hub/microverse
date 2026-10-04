from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class Tile(BaseModel):
    type: int = 0
    crop_growth: float = 0.0
    owner_id: int | None = None


class Traits(BaseModel):
    courage: float = 0.5
    intelligence: float = 0.5
    fertility: float = 0.5
    aggression: float = 0.5


class Inventory(BaseModel):
    wheat: int = 0
    wood: int = 0
    stone: int = 0


AGENT_STATES = (
    "idle",
    "walking",
    "eating",
    "sleeping",
    "farming",
    "pregnant",
    "dead",
)


class AgentSchema(BaseModel):
    id: int
    name: str
    x: int
    y: int
    gender: str
    age: int = 0
    hp: float = 100.0
    hunger: float = 0.0
    energy: float = 100.0
    mood: float = 0.0
    money: float = 50.0
    inventory: Inventory = Field(default_factory=Inventory)
    traits: Traits = Field(default_factory=Traits)
    state: str = "idle"
    pregnancy_ticks: int = 0
    pregnancy_partner_id: int | None = None
    mother_id: int | None = None
    father_id: int | None = None
    relationships: dict[int, float] = Field(default_factory=dict)
    last_decision_tick: int = 0
    chat_bubble_text: str | None = None    # MICRO-B: نص الفقاعة أو None للإخفاء الفوري
    chat_bubble_ticks_left: int = 0        # كم tick متبقي لإظهار الفقاعة (عند 0 يصير الـ text = None مرة واحدة في Delta)


class AgentDelta(BaseModel):
    id: int
    x: int | None = None
    y: int | None = None
    hunger: float | None = None
    energy: float | None = None
    hp: float | None = None
    mood: float | None = None
    state: str | None = None
    age: int | None = None
    inventory: Inventory | None = None
    pregnancy_ticks: int | None = None
    chat_bubble_text: str | None = None  # MICRO-B: إرسال None عند انتهاء الفقاعة لإخفائها فوراً في Frontend


class EventItem(BaseModel):
    tick: int
    agent_id: int | None
    type: str
    text: str
    payload: dict[str, Any] = Field(default_factory=dict)


class WorldInitResponse(BaseModel):
    tick: int
    map: list[list[Tile]]
    agents: list[AgentSchema]
    world_state: WorldUpdate | None = None  # (الفصل + الطقس) عند الـ init للبدء مباشرة بالواجهة الصحيحة


class ControlRequest(BaseModel):
    action: str
    value: float | None = None


class HealthResponse(BaseModel):
    status: str
    tick: int
    agents_count: int


class WorldUpdate(BaseModel):
    season: str | None = None
    weather: str | None = None
    grid_delta: list[dict] | None = None  # اختياري: {"x":.. ,"y":.. ,"tile": Tile.model_dump()}
    market_price: dict[str, float] | None = None  # اختياري: أسعار الموارد {"wheat": 1.0, ...}


class SSEData(BaseModel):
    tick: int
    agents_delta: list[AgentDelta] = Field(default_factory=list)
    new_events: list[EventItem] = Field(default_factory=list)
    world_update: WorldUpdate | None = None  # يُرسل فقط عند تغيير فصل/طقس (لا كل tick)
