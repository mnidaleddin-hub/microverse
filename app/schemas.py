from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class CropCategory(str, Enum):
    GRAIN = "grain"
    VEGETABLE = "vegetable"
    FRUIT = "fruit"
    INDUSTRIAL = "industrial"


class MaterialCategory(str, Enum):
    WOOD = "wood"
    STONE = "stone"
    METAL = "metal"
    ANIMAL_PRODUCT = "animal_product"
    CHEMICAL = "chemical"


class AnimalType(str, Enum):
    COW = "cow"
    SHEEP = "sheep"
    CHICKEN = "chicken"
    PIG = "pig"
    HORSE = "horse"
    DOG = "dog"
    CAT = "cat"
    DUCK = "duck"
    GOOSE = "goose"
    GOAT = "goat"
    CAMEL = "camel"
    DONKEY = "donkey"
    RABBIT = "rabbit"
    FOX = "fox"
    WOLF = "wolf"
    BEAR = "bear"
    ELEPHANT = "elephant"
    GIRAFFE = "giraffe"
    LION = "lion"
    TIGER = "tiger"


class Tile(BaseModel):
    type: int = 0
    crop_growth: float = 0.0
    crop_type: str | None = None
    owner_id: int | None = None


class Traits(BaseModel):
    courage: float = 0.5
    intelligence: float = 0.5
    fertility: float = 0.5
    aggression: float = 0.5
    greed: float = 0.5
    generosity: float = 0.5
    loyalty: float = 0.5
    betrayal: float = 0.5
    patience: float = 0.5
    curiosity: float = 0.5
    leadership: float = 0.5
    empathy: float = 0.5
    optimism: float = 0.5
    pessimism: float = 0.5
    creativity: float = 0.5
    introversion: float = 0.5
    honesty: float = 0.5
    wisdom: float = 0.5
    temperance: float = 0.5
    diligence: float = 0.5
    charisma: float = 0.5
    discipline: float = 0.5
    resilience: float = 0.5


class Inventory(BaseModel):
    money: float = 50.0
    grain: int = 0
    vegetable: int = 0
    fruit: int = 0
    industrial: int = 0
    wood: int = 0
    stone: int = 0
    metal: int = 0
    animal_product: int = 0
    chemical: int = 0
    wheat: int = 0


AGENT_STATES = (
    "idle",
    "walking",
    "eating",
    "sleeping",
    "farming",
    "pregnant",
    "dead",
)


ANIMAL_STATES = (
    "idle",
    "walking",
    "eating",
    "sleeping",
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
    chat_bubble_text: str | None = None
    chat_bubble_ticks_left: int = 0


class AnimalTraits(BaseModel):
    speed: float = 0.5
    strength: float = 0.5
    endurance: float = 0.5
    eyesight: float = 0.5
    smell: float = 0.5
    size: float = 0.5
    weight: float = 0.5
    color_variant: float = 0.5
    disease_resistance: float = 0.5
    milk_production: float = 0.5
    egg_production: float = 0.5
    wool_production: float = 0.5
    intelligence: float = 0.5
    tameness: float = 0.5
    aggressiveness: float = 0.5
    trainability: float = 0.5
    adaptability: float = 0.5
    lifespan: float = 0.5
    fertility: float = 0.5
    health: float = 0.5


class AnimalSchema(BaseModel):
    id: int
    type: str
    name: str
    x: int
    y: int
    gender: str
    age: int = 0
    hp: float = 100.0
    hunger: float = 0.0
    energy: float = 100.0
    state: str = "idle"
    traits: AnimalTraits = Field(default_factory=AnimalTraits)
    owner_id: int | None = None
    pregnancy_ticks: int = 0
    mother_id: int | None = None
    father_id: int | None = None


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
    chat_bubble_text: str | None = None


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
    animals: list[AnimalSchema] = []
    world_state: "WorldUpdate | None" = None


class ControlRequest(BaseModel):
    action: str
    value: float | None = None
    payload: Any | None = None


class HealthResponse(BaseModel):
    status: str
    tick: int
    agents_count: int
    animals_count: int = 0


class WorldUpdate(BaseModel):
    season: str | None = None
    weather: str | None = None
    grid_delta: list[dict] | None = None
    market_price: dict[str, float] | None = None


class SSEData(BaseModel):
    tick: int
    agents_delta: list[AgentDelta] = Field(default_factory=list)
    new_events: list[EventItem] = Field(default_factory=list)
    world_update: WorldUpdate | None = None


class AdminEditAgentRequest(BaseModel):
    agent_id: int
    updates: dict[str, Any]


class EditAgentRequest(BaseModel):
    agent_id: int
    updates: dict[str, Any]


class EditTileRequest(BaseModel):
    x: int
    y: int
    tile_type: int = 0
    crop_growth: float = 0.0


class GodModeCommand(BaseModel):
    action: str
    value: Any = None
