from __future__ import annotations

import random
from typing import TYPE_CHECKING

from app.config import settings

if TYPE_CHECKING:
    from app.schemas import AnimalSchema, Tile


def create_random_animal(
    animal_id: int,
    animal_type: str,
    grid: list[list["Tile"]],
    grid_size: int,
) -> "AnimalSchema":
    from app.config import ANIMAL_NAMES_POOL
    from app.schemas import AnimalSchema, AnimalTraits

    while True:
        x = random.randint(0, grid_size - 1)
        y = random.randint(0, grid_size - 1)
        if grid[y][x].type in (0, 3):
            break

    name_pool = ANIMAL_NAMES_POOL.get(animal_type, ["Generic"])
    name = random.choice(name_pool)

    trait_values = {t: round(random.random(), 2) for t in [
        "speed", "strength", "endurance", "eyesight", "smell",
        "size", "weight", "color_variant", "disease_resistance", "milk_production",
        "egg_production", "wool_production", "intelligence", "tameness", "aggressiveness",
        "trainability", "adaptability", "lifespan", "fertility", "health",
    ]}

    return AnimalSchema(
        id=animal_id,
        type=animal_type,
        name=name,
        x=x,
        y=y,
        gender=random.choice(["male", "female"]),
        age=random.randint(500, 5000),
        hp=100.0,
        hunger=float(random.randint(0, 30)),
        energy=float(random.randint(70, 100)),
        state="idle",
        traits=AnimalTraits(**trait_values),
        owner_id=None,
        pregnancy_ticks=0,
        mother_id=None,
        father_id=None,
    )


def _random_walk_animal(animal: "AnimalSchema", grid: list[list["Tile"]], grid_size: int) -> None:
    """حركة عشوائية بسيطة للحيوان"""
    directions = [(0, -1), (1, 0), (0, 1), (-1, 0)]
    random.shuffle(directions)
    for dx, dy in directions[:2]:
        nx = animal.x + dx
        ny = animal.y + dy
        if 0 <= nx < grid_size and 0 <= ny < grid_size:
            tile = grid[ny][nx]
            if tile.type != 1:
                animal.x = nx
                animal.y = ny
                animal.state = "walking"
                return


def run_animal_ai(
    animal: "AnimalSchema",
    grid: list[list["Tile"]],
    grid_size: int,
) -> list:
    """منطق حيوان بسيط: جوع → أكل → تجول → نوم"""
    if animal.state == "dead":
        return []

    animal.age += 1

    HUNGER_RATE = 0.15
    ENERGY_RECOVERY = 0.6
    ENERGY_USE = 0.05

    animal.hunger = min(100.0, animal.hunger + HUNGER_RATE)

    tile_here = grid[animal.y][animal.x]
    is_grass_or_farm = tile_here.type in (0, 2) or (tile_here.crop_growth or 0) > 0.3

    # 1. جوع شديد و غابة/زرع هنا → أكل
    if animal.hunger > 60.0 and is_grass_or_farm:
        animal.state = "eating"
        animal.hunger = max(0.0, animal.hunger - 40.0)
        animal.energy = min(100.0, animal.energy + 10.0)
        if tile_here.crop_growth and tile_here.crop_growth > 0:
            tile_here.crop_growth = max(0.0, tile_here.crop_growth - 0.2)
        return []

    # 2. طاقة منخفضة → نوم
    if animal.energy < 25.0:
        animal.state = "sleeping"
        animal.energy = min(100.0, animal.energy + ENERGY_RECOVERY)
        return []

    # 3. استيقاظ تدريجي
    if animal.state == "sleeping" and animal.energy > 70.0:
        animal.state = "idle"

    # 4. تجول عشوائي (غالبية الوقت)
    if animal.state != "sleeping":
        if random.random() < 0.3:
            _random_walk_animal(animal, grid, grid_size)
        else:
            if animal.state == "walking":
                animal.state = "idle"
        animal.energy = max(0.0, animal.energy - ENERGY_USE)

    # 5. موت بسبب الجوع الشديد
    if animal.hunger > 98.0:
        animal.hp = max(0.0, animal.hp - 1.0)
        if animal.hp <= 0:
            animal.state = "dead"

    return []
