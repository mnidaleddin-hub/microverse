from __future__ import annotations

import random
from typing import TYPE_CHECKING

from app.config import DIALOG_TEMPLATES, settings
from app.simulation.farming import harvest as do_harvest, plant as do_plant
from app.simulation.pathfinding import bfs_next_step
from app.simulation.reproduction import PREGNANCY_DURATION_TICKS, check_reproduction, give_birth

if TYPE_CHECKING:
    from app.schemas import AgentSchema, EventItem, Tile


NAMES_POOL = [
    "Adam", "Nour", "Layla", "Omar", "Sara", "Khalid", "Amira", "Youssef",
    "Huda", "Tariq", "Mariam", "Zaid", "Noor", "Ali", "Fatima", "Hassan",
    "Zainab", "Hamza", "Aisha", "Bilal", "Dina", "Sami", "Rania", "Karim",
    "Jana", "Mahmoud", "Salma", "Abdullah", "Reem", "Faisal", "Maya",
    "Yasin", "Hana", "Malik", "Dana", "Rami", "Lina", "Saif", "Rowan",
    "Ahmad", "Leen", "Bakr", "Tala", "Ibrahim", "Nadine", "Jamil", "Sama",
    "Farah", "Zakaria",
]


def random_name() -> str:
    return random.choice(NAMES_POOL)


def random_gender() -> str:
    return random.choice(["male", "female"])


def create_random_agent(
    agent_id: int, grid: list[list["Tile"]], grid_size: int
) -> "AgentSchema":
    from app.schemas import AgentSchema, Inventory, Traits

    while True:
        x = random.randint(0, grid_size - 1)
        y = random.randint(0, grid_size - 1)
        if grid[y][x].type == 0:
            break

    return AgentSchema(
        id=agent_id,
        name=random_name(),
        x=x,
        y=y,
        gender=random_gender(),
        age=random.randint(18, 40),
        hp=100.0,
        hunger=float(random.randint(0, 30)),
        energy=float(random.randint(70, 100)),
        mood=float(random.randint(-10, 30)),
        money=50.0,
        inventory=Inventory(wheat=random.randint(0, 3), wood=0, stone=0),
        traits=Traits(
            courage=random.random(),
            intelligence=random.random(),
            fertility=random.random(),
            aggression=random.random(),
        ),
        state="idle",
        pregnancy_ticks=0,
        pregnancy_partner_id=None,
        mother_id=None,
        father_id=None,
        relationships={},
        last_decision_tick=0,
    )


def _random_walk(agent: "AgentSchema", grid: list[list["Tile"]], grid_size: int) -> None:
    directions = [(0, -1), (1, 0), (0, 1), (-1, 0)]
    random.shuffle(directions)
    for dx, dy in directions:
        nx = agent.x + dx
        ny = agent.y + dy
        if 0 <= nx < grid_size and 0 <= ny < grid_size:
            tile = grid[ny][nx]
            if tile.type != 1:
                agent.x = nx
                agent.y = ny
                agent.state = "walking"
                return


def snapshot_agent(agent: "AgentSchema") -> dict:
    return {
        "x": agent.x,
        "y": agent.y,
        "hunger": agent.hunger,
        "energy": agent.energy,
        "hp": agent.hp,
        "mood": agent.mood,
        "state": agent.state,
        "age": agent.age,
        "inventory_wheat": agent.inventory.wheat,
        "pregnancy_ticks": agent.pregnancy_ticks,
        "chat_bubble_text": agent.chat_bubble_text,
    }


def _increase_trust(agent_a: "AgentSchema", agent_b: "AgentSchema", amount: float = 1.0) -> None:
    def _clamp(v: float) -> float:
        return max(-100.0, min(100.0, v))

    cur_ab = agent_a.relationships.get(agent_b.id, 0.0)
    agent_a.relationships[agent_b.id] = _clamp(cur_ab + amount)

    cur_ba = agent_b.relationships.get(agent_a.id, 0.0)
    agent_b.relationships[agent_a.id] = _clamp(cur_ba + amount)


def _set_chat_bubble(agent: "AgentSchema", text: str, ticks: int = 180) -> None:
    agent.chat_bubble_text = text
    agent.chat_bubble_ticks_left = ticks


def _social_interaction(
    agent: "AgentSchema",
    all_agents: dict[int, "AgentSchema"],
    tick: int,
) -> list["EventItem"]:
    from app.schemas import EventItem

    events: list[EventItem] = []
    if agent.state == "dead":
        return events
    if agent.pregnancy_ticks > 0:
        return events

    partners_here = [
        a for a in all_agents.values()
        if a.id != agent.id
        and a.state != "dead"
        and a.x == agent.x
        and a.y == agent.y
    ]
    if not partners_here:
        return events

    for partner in partners_here:
        _increase_trust(agent, partner, amount=1.0)

        avg_trust = (
            agent.relationships.get(partner.id, 0.0)
            + partner.relationships.get(agent.id, 0.0)
        ) / 2.0

        if avg_trust >= 0.0 and random.random() < 0.18:
            text = random.choice(DIALOG_TEMPLATES)
            _set_chat_bubble(agent, text)
            events.append(EventItem(
                tick=tick, agent_id=agent.id, type="chat",
                text=f"Agent {agent.id} ({agent.name}) says: {text}",
                payload={"partner_id": partner.id, "text": text},
            ))

        social_states = {"idle", "walking"}
        if agent.state in social_states and partner.state in social_states:
            if check_reproduction(agent, partner):
                female = agent if agent.gender == "female" else partner
                male = partner if agent.gender == "female" else agent

                if female.pregnancy_ticks == 0:
                    female.pregnancy_ticks = PREGNANCY_DURATION_TICKS
                    female.pregnancy_partner_id = male.id
                    female.state = "pregnant"
                    female.mood = min(100.0, female.mood + 20.0)
                    male.mood = min(100.0, male.mood + 20.0)

                    preg_text = f"🤰 {female.name} is now pregnant by {male.name}!"
                    _set_chat_bubble(female, preg_text)

                    events.append(EventItem(
                        tick=tick, agent_id=female.id, type="pregnant",
                        text=preg_text,
                        payload={
                            "mother_id": female.id,
                            "father_id": male.id,
                            "duration": PREGNANCY_DURATION_TICKS,
                        },
                    ))
                    break

    return events


def run_agent_ai(
    agent: "AgentSchema",
    grid: list[list["Tile"]],
    grid_size: int,
    tick: int,
    all_agents: dict[int, "AgentSchema"],
) -> list["EventItem"]:
    from app.schemas import EventItem

    events: list[EventItem] = []

    if agent.state == "dead":
        return events
    if agent.hp <= 0:
        agent.state = "dead"
        events.append(EventItem(
            tick=tick, agent_id=agent.id, type="death",
            text=f"Agent {agent.id} ({agent.name}) died",
            payload={"agent_id": agent.id, "name": agent.name},
        ))
        return events

    agent.last_decision_tick = tick
    agent.age += 0

    # 0. ⭐ أولاً: التفاعل الاجتماعي بناءً على الموقع الحالي (قبل أي حركة)
    #    مهم جداً: لأن أي حركة لاحقة ستغيّر x,y وستفوت فرصة اللقاء
    events.extend(_social_interaction(agent, all_agents, tick))

    # 1. فحص الحمل والولادة
    if agent.pregnancy_ticks > 0:
        agent.state = "pregnant"
        agent.pregnancy_ticks -= 1
        if agent.pregnancy_ticks == 0:
            father = None
            if agent.pregnancy_partner_id is not None:
                father = all_agents.get(agent.pregnancy_partner_id)
            if father is not None:
                next_id = max(list(all_agents.keys()) + [settings.AGENT_COUNT]) + 1
                baby = give_birth(agent, father, next_id)
                if baby is not None:
                    events.append(EventItem(
                        tick=tick, agent_id=baby.id, type="birth",
                        text=f"Baby {baby.id} ({baby.name}) born to {agent.name} & {father.name}",
                        payload={"baby_id": baby.id, "mother_id": agent.id, "father_id": father.id},
                    ))
                    all_agents[baby.id] = baby
            agent.pregnancy_partner_id = None
        return events

    # 2. فحص انخفاض الطاقة → نوم
    if agent.energy < 20:
        agent.state = "sleeping"
        agent.energy = min(100.0, agent.energy + 0.5)
        agent.hunger = min(100.0, agent.hunger + 0.2)
        events.append(EventItem(
            tick=tick, agent_id=agent.id, type="sleep",
            text=f"Agent {agent.id} ({agent.name}) is sleeping",
            payload={"agent_id": agent.id, "energy": agent.energy},
        ))
        return events

    agent.hunger = min(100.0, agent.hunger + 0.3)
    agent.energy = max(0.0, agent.energy - 0.1)
    if agent.hunger >= 100:
        agent.hp = max(0.0, agent.hp - 0.2)

    # 3. فحص الجوع المرتفع → أكل أو البحث عن مزرعة
    if agent.hunger > 70:
        if agent.inventory.wheat > 0:
            agent.inventory.wheat -= 1
            agent.hunger = max(0.0, agent.hunger - 30)
            agent.state = "eating"
            events.append(EventItem(
                tick=tick, agent_id=agent.id, type="eat",
                text=f"Agent {agent.id} ({agent.name}) ate wheat",
                payload={"agent_id": agent.id, "wheat_left": agent.inventory.wheat},
            ))
            return events
        else:
            def ripe_farmland(x: int, y: int, tile: "Tile") -> bool:
                return tile.type == 2 and tile.crop_growth >= 100.0

            step = bfs_next_step(grid, (agent.x, agent.y), ripe_farmland, grid_size)
            if step is not None:
                agent.x, agent.y = step
                agent.state = "walking"
                events.append(EventItem(
                    tick=tick, agent_id=agent.id, type="move",
                    text=f"Agent {agent.id} ({agent.name}) searching for food",
                    payload={"agent_id": agent.id, "x": agent.x, "y": agent.y},
                ))
                return events

    # 4. إذا واقف على farmland ناضجة → احصد
    current_tile = grid[agent.y][agent.x]
    if current_tile.type == 2 and current_tile.crop_growth >= 100.0:
        if do_harvest(agent, current_tile):
            agent.state = "farming"
            events.append(EventItem(
                tick=tick, agent_id=agent.id, type="harvest",
                text=f"Agent {agent.id} ({agent.name}) harvested wheat",
                payload={"agent_id": agent.id, "wheat": agent.inventory.wheat},
            ))
            return events

    # 5. إذا واقف على farmland فارغة ويمتلك قمح كافٍ → ازرع
    if current_tile.type == 2 and current_tile.crop_growth <= 0.0:
        if do_plant(agent, current_tile):
            agent.state = "farming"
            events.append(EventItem(
                tick=tick, agent_id=agent.id, type="plant",
                text=f"Agent {agent.id} ({agent.name}) planted wheat",
                payload={"agent_id": agent.id, "wheat_left": agent.inventory.wheat},
            ))
            return events

    # 6. لا شيء آخر → تجول عشوائي
    _random_walk(agent, grid, grid_size)
    if agent.state != "walking":
        agent.state = "idle"

    return events
