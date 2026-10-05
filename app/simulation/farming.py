from __future__ import annotations

from typing import TYPE_CHECKING

from app.config import CATEGORY_TO_INVENTORY_FIELD, CROP_PROPERTIES

if TYPE_CHECKING:
    from app.schemas import AgentSchema, Tile


DEFAULT_CROP_TYPE = "wheat"
PLANT_COST = 2
HARVEST_THRESHOLD = 100.0
PLANT_MIN_GROWTH = 0.0


def _crop_growth_rate(crop_type: str | None) -> float:
    if not crop_type:
        return 1.0 / 600.0 * 100.0
    props = CROP_PROPERTIES.get(crop_type)
    if not props:
        return 1.0 / 600.0 * 100.0
    gt = float(props.get("growth_time", 600))
    return 100.0 / max(1.0, gt)


def _crop_yield(crop_type: str | None) -> int:
    if not crop_type:
        return 5
    props = CROP_PROPERTIES.get(crop_type)
    if not props:
        return 5
    return int(props.get("yield", 5))


def _crop_category(crop_type: str | None) -> str:
    if not crop_type:
        return "grain"
    props = CROP_PROPERTIES.get(crop_type)
    if not props:
        return "grain"
    return str(props.get("category", "grain"))


def _add_to_category_inventory(agent: "AgentSchema", category: str, amount: int) -> None:
    field_name = CATEGORY_TO_INVENTORY_FIELD.get(category, category)
    cur = int(getattr(agent.inventory, field_name, 0) or 0)
    setattr(agent.inventory, field_name, cur + amount)


def _get_from_category_inventory(agent: "AgentSchema", category: str) -> int:
    field_name = CATEGORY_TO_INVENTORY_FIELD.get(category, category)
    return int(getattr(agent.inventory, field_name, 0) or 0)


def _sub_from_category_inventory(agent: "AgentSchema", category: str, amount: int) -> bool:
    field_name = CATEGORY_TO_INVENTORY_FIELD.get(category, category)
    cur = int(getattr(agent.inventory, field_name, 0) or 0)
    if cur < amount:
        return False
    setattr(agent.inventory, field_name, cur - amount)
    return True


def tick_crops(map_grid: list[list["Tile"]]) -> None:
    for row in map_grid:
        for tile in row:
            if tile.type == 2 and 0 < tile.crop_growth < 100:
                rate = _crop_growth_rate(getattr(tile, "crop_type", None))
                tile.crop_growth = min(100.0, tile.crop_growth + rate)


def harvest(agent: "AgentSchema", tile: "Tile") -> bool:
    if tile.type != 2:
        return False
    if tile.crop_growth < HARVEST_THRESHOLD:
        return False
    crop_type = getattr(tile, "crop_type", None) or DEFAULT_CROP_TYPE
    category = _crop_category(crop_type)
    amount = _crop_yield(crop_type)
    _add_to_category_inventory(agent, category, amount)
    if category == "grain":
        current_wheat = int(getattr(agent.inventory, "wheat", 0) or 0)
        setattr(agent.inventory, "wheat", current_wheat + amount)
    tile.crop_growth = 0.0
    tile.crop_type = None
    return True


def plant(agent: "AgentSchema", tile: "Tile") -> bool:
    if tile.type != 2:
        return False
    if tile.crop_growth > PLANT_MIN_GROWTH:
        return False
    crop_type = DEFAULT_CROP_TYPE
    category = _crop_category(crop_type)
    if not _sub_from_category_inventory(agent, category, PLANT_COST):
        alt_cat = _get_from_category_inventory(agent, category)
        wheat_backwards = int(getattr(agent.inventory, "wheat", 0) or 0)
        if wheat_backwards >= PLANT_COST:
            setattr(agent.inventory, "wheat", wheat_backwards - PLANT_COST)
            if category == "grain":
                pass
            else:
                return False
        else:
            return False
    tile.crop_growth = _crop_growth_rate(crop_type)
    tile.crop_type = crop_type
    return True
