from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.schemas import AgentSchema, Tile


CROP_GROWTH_PER_TICK = 1.0 / 600.0 * 100.0  # ينمو 100 في 600 tick ≈ 0.167
CROP_HARVEST_AMOUNT = 5
PLANT_COST = 2
HARVEST_THRESHOLD = 100.0
PLANT_MIN_GROWTH = 0.0


# تحديث نمو المحاصيل كل tick
def tick_crops(map_grid: list[list["Tile"]]) -> None:
    for row in map_grid:
        for tile in row:
            if tile.type == 2 and tile.crop_growth > 0 and tile.crop_growth < 100:
                tile.crop_growth = min(100.0, tile.crop_growth + CROP_GROWTH_PER_TICK)


# عملية الحصاد: إذا كان الكائن على farmland ناضجة
def harvest(agent: "AgentSchema", tile: "Tile") -> bool:
    if tile.type != 2:
        return False
    if tile.crop_growth < HARVEST_THRESHOLD:
        return False
    agent.inventory.wheat += CROP_HARVEST_AMOUNT
    tile.crop_growth = 0.0
    return True


# عملية الزراعة: إذا كان الكائن على farmland فارغة ويمتلك قمح كافٍ
def plant(agent: "AgentSchema", tile: "Tile") -> bool:
    if tile.type != 2:
        return False
    if tile.crop_growth > PLANT_MIN_GROWTH:
        return False
    if agent.inventory.wheat <= PLANT_COST:
        return False
    agent.inventory.wheat -= PLANT_COST
    tile.crop_growth = CROP_GROWTH_PER_TICK
    return True
