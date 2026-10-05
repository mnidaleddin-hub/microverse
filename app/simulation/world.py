from __future__ import annotations

import asyncio
import json
import random
from typing import TYPE_CHECKING

from app.config import FRIENDLY_ANIMALS, settings
from app.schemas import (
    AgentDelta,
    AgentSchema,
    AnimalSchema,
    EventItem,
    Inventory,
    SSEData,
    Tile,
    Traits,
    WorldUpdate,
)
from app.simulation.agent import create_random_agent, run_agent_ai, snapshot_agent
from app.simulation.animal_ai import create_random_animal, run_animal_ai
from app.simulation.ecology import EcologyManager
from app.simulation.farming import tick_crops

if TYPE_CHECKING:
    from asyncio import Queue


class World:
    def __init__(self) -> None:
        self.grid_size: int = settings.GRID_SIZE
        self.agent_count: int = settings.AGENT_COUNT
        self.tick: int = 0
        self.tick_interval: float = settings.INITIAL_TICK_INTERVAL
        self.paused: bool = False
        self.map_grid: list[list[Tile]] = []
        self.agents: dict[int, AgentSchema] = {}
        self.animals: dict[int, AnimalSchema] = {}
        self.next_agent_id: int = 1
        self.next_animal_id: int = 1
        self.sse_clients: set[Queue[str]] = set()
        self._current_events: list[EventItem] = []
        self._lock = asyncio.Lock()
        self.ecology: EcologyManager = EcologyManager()
        self.market_price: dict[str, float] = {"wheat": 1.0, "wood": 1.0, "stone": 1.0, "grain": 1.0, "vegetable": 1.0, "fruit": 1.0, "industrial": 1.0}
        self._last_market_price: dict[str, float] | None = None

    def _generate_map(self) -> list[list[Tile]]:
        grid: list[list[Tile]] = []
        for _ in range(self.grid_size):
            row: list[Tile] = []
            for _ in range(self.grid_size):
                r = random.random()
                if r < 0.6:
                    t = 0
                elif r < 0.7:
                    t = 1
                elif r < 0.85:
                    t = 2
                else:
                    t = 3
                row.append(Tile(type=t, crop_growth=0.0, crop_type=None, owner_id=None))
            grid.append(row)
        return grid

    def _spawn_initial_agents(self) -> dict[int, AgentSchema]:
        agents: dict[int, AgentSchema] = {}
        for i in range(self.agent_count):
            agent = create_random_agent(i + 1, self.map_grid, self.grid_size)
            agents[agent.id] = agent
        self.next_agent_id = self.agent_count + 1
        return agents

    def _spawn_initial_animals(self) -> dict[int, AnimalSchema]:
        animals: dict[int, AnimalSchema] = {}
        count = max(3, min(10, int(settings.INITIAL_ANIMALS_COUNT)))
        aid = 1
        for i in range(count):
            atype = random.choice(FRIENDLY_ANIMALS)
            a = create_random_animal(aid, atype, self.map_grid, self.grid_size)
            animals[a.id] = a
            aid += 1
        self.next_animal_id = aid
        return animals

    def reset_world(self) -> None:
        self.tick = 0
        self.map_grid = self._generate_map()
        self.agents = self._spawn_initial_agents()
        self.animals = self._spawn_initial_animals()
        self._current_events = [
            EventItem(
                tick=0, agent_id=a.id, type="spawn",
                text=f"Agent {a.id} ({a.name}) spawned at ({a.x},{a.y})",
                payload={"name": a.name, "x": a.x, "y": a.y, "gender": a.gender},
            )
            for a in self.agents.values()
        ] + [
            EventItem(
                tick=0, agent_id=None, type="animal_spawn",
                text=f"Animal {an.id} ({an.type}: {an.name}) spawned at ({an.x},{an.y})",
                payload={"animal_id": an.id, "animal_type": an.type, "name": an.name, "x": an.x, "y": an.y},
            )
            for an in self.animals.values()
        ]

    def serialize_map_to_dict(self) -> list[list[dict]]:
        return [[tile.model_dump() for tile in row] for row in self.map_grid]

    def serialize_agents_to_dict(self) -> dict[int, dict]:
        return {aid: ag.model_dump(mode="json") for aid, ag in self.agents.items()}

    def serialize_animals_to_dict(self) -> dict[int, dict]:
        return {aid: an.model_dump(mode="json") for aid, an in self.animals.items()}

    def load_map_from_dict(self, data: list[list[dict]]) -> None:
        self.map_grid = [[Tile(**t) for t in row] for row in data]

    def load_agents_from_dict(self, data: dict[str, dict]) -> None:
        agents: dict[int, AgentSchema] = {}
        max_id = 0
        for k, v in data.items():
            inv = v.pop("inventory", {})
            tr = v.pop("traits", {})
            rels = v.get("relationships") or {}
            ag = AgentSchema(
                **{
                    **v,
                    "inventory": Inventory(**inv) if isinstance(inv, dict) else inv,
                    "traits": Traits(**tr) if isinstance(tr, dict) else tr,
                    "relationships": {int(k2): float(v2) for k2, v2 in rels.items()},
                }
            )
            agents[ag.id] = ag
            if ag.id > max_id:
                max_id = ag.id
        self.agents = agents
        self.next_agent_id = max_id + 1

    def load_animals_from_dict(self, data: dict[str, dict] | list[dict]) -> None:
        from app.schemas import AnimalTraits

        animals: dict[int, AnimalSchema] = {}
        max_id = 0

        if isinstance(data, list):
            items = {str(a["id"]): a for a in data}
        elif isinstance(data, dict):
            items = data
        else:
            items = {}

        for k, v in items.items():
            tr = v.pop("traits", {})
            an = AnimalSchema(
                **{
                    **v,
                    "traits": AnimalTraits(**tr) if isinstance(tr, dict) else AnimalTraits(),
                }
            )
            animals[an.id] = an
            if an.id > max_id:
                max_id = an.id
        self.animals = animals
        self.next_animal_id = max_id + 1

    async def load_from_db(self) -> bool:
        from app.database import get_session_factory
        from app.models import WorldState as WorldStateModel

        factory = get_session_factory()
        async with factory() as session:
            ws = await session.get(WorldStateModel, 1)
            if ws is None:
                return False
            self.tick = ws.tick
            self.load_map_from_dict(ws.map_json)

            agents_data = ws.agents_json
            if isinstance(agents_data, list):
                agents_dict = {str(a["id"]): a for a in agents_data}
            elif isinstance(agents_data, dict):
                agents_dict = agents_data
            else:
                agents_dict = {}
            self.load_agents_from_dict(agents_dict)

            ws_dict = ws.__dict__ if hasattr(ws, "__dict__") else {}
            animals_data = None
            if isinstance(ws_dict, dict):
                animals_data = ws_dict.get("animals_json") or None
            if animals_data is None:
                try:
                    animals_data = getattr(ws, "animals_json", None)
                except Exception:
                    animals_data = None
            if animals_data is None:
                self.animals = {}
            else:
                self.load_animals_from_dict(animals_data)
            return True

    async def save_world_state(self) -> None:
        from app.database import get_session_factory
        from app.models import WorldState as WorldStateModel

        factory = get_session_factory()
        async with factory() as session:
            async with session.begin():
                ws = await session.get(WorldStateModel, 1)
                animals_json_payload = self.serialize_animals_to_dict()
                payload = {
                    "id": 1,
                    "tick": self.tick,
                    "map_json": self.serialize_map_to_dict(),
                    "agents_json": self.serialize_agents_to_dict(),
                    "animals_json": animals_json_payload,
                }
                if ws is None:
                    from sqlalchemy import insert
                    await session.execute(insert(WorldStateModel).values(**payload))
                else:
                    ws.tick = self.tick
                    ws.map_json = payload["map_json"]
                    ws.agents_json = payload["agents_json"]
                    try:
                        ws.animals_json = payload["animals_json"]
                    except Exception:
                        pass

    async def persist_events(self, events: list[EventItem]) -> None:
        if not events:
            return
        from app.database import get_session_factory
        from app.models import EventsLog as EventsLogModel

        factory = get_session_factory()
        async with factory() as session:
            async with session.begin():
                from sqlalchemy import insert
                rows = [
                    {
                        "tick": e.tick,
                        "agent_id": e.agent_id,
                        "event_type": e.type,
                        "payload_json": e.payload,
                    }
                    for e in events
                    if e.type in (
                        "spawn", "eat", "sleep", "wake", "plant", "harvest",
                        "birth", "death", "pregnant", "capped", "chat",
                        "animal_spawn",
                    )
                ]
                if rows:
                    await session.execute(insert(EventsLogModel).values(rows))

    async def persist_profiles(self) -> None:
        from app.database import get_session_factory
        from app.models import AgentProfile as AgentProfileModel

        factory = get_session_factory()
        async with factory() as session:
            async with session.begin():
                rows = []
                for ag in self.agents.values():
                    rows.append({
                        "id": ag.id,
                        "name": ag.name,
                        "gender": ag.gender,
                        "age": ag.age,
                        "mother_id": ag.mother_id,
                        "father_id": ag.father_id,
                        "traits_json": ag.traits.model_dump(mode="json"),
                        "relationships_json": {str(k): v for k, v in ag.relationships.items()},
                    })
                if not rows:
                    return
                if "postgresql" in settings.DATABASE_URL:
                    from sqlalchemy.dialects.postgresql import insert as pg_insert
                    stmt = (
                        pg_insert(AgentProfileModel)
                        .values(rows)
                        .on_conflict_do_update(
                            index_elements=["id"],
                            set_={
                                "name": pg_insert(AgentProfileModel).excluded.name,
                                "gender": pg_insert(AgentProfileModel).excluded.gender,
                                "age": pg_insert(AgentProfileModel).excluded.age,
                                "traits_json": pg_insert(AgentProfileModel).excluded.traits_json,
                                "relationships_json": pg_insert(AgentProfileModel).excluded.relationships_json,
                            },
                        )
                    )
                    await session.execute(stmt)
                else:
                    from sqlalchemy.dialects.sqlite import insert as sqlite_insert
                    stmt = (
                        sqlite_insert(AgentProfileModel)
                        .values(rows)
                        .on_conflict_do_update(
                            index_elements=["id"],
                            set_={
                                "name": sqlite_insert(AgentProfileModel).excluded.name,
                                "gender": sqlite_insert(AgentProfileModel).excluded.gender,
                                "age": sqlite_insert(AgentProfileModel).excluded.age,
                                "traits_json": sqlite_insert(AgentProfileModel).excluded.traits_json,
                                "relationships_json": sqlite_insert(AgentProfileModel).excluded.relationships_json,
                            },
                        )
                    )
                    await session.execute(stmt)

    def set_speed(self, value: float) -> None:
        self.tick_interval = max(0.001, float(value))

    def pause(self) -> None:
        self.paused = True

    def resume(self) -> None:
        self.paused = False

    def edit_agent(self, agent_id: int, updates: dict) -> AgentDelta | None:
        agent = self.agents.get(agent_id)
        if agent is None:
            return None
        is_dead = agent.state == "dead"
        allowed_if_dead = {"revive", "hp", "state"}
        delta = AgentDelta(id=agent_id)
        changed = False
        for key, val in updates.items():
            if not hasattr(agent, key):
                continue
            if is_dead:
                action = updates.get("__action") or ""
                if action != "revive" and key not in allowed_if_dead:
                    continue
                if key == "state" and val != "idle" and val != "alive" and val != "dead":
                    if action != "revive":
                        continue
            if key == "inventory":
                try:
                    if isinstance(val, dict):
                        inv = agent.inventory.model_copy(update=val)
                        setattr(agent, key, inv)
                        delta.inventory = inv
                        changed = True
                except Exception:
                    pass
                continue
            if key == "traits":
                try:
                    if isinstance(val, dict):
                        tr = agent.traits.model_copy(update=val)
                        setattr(agent, key, tr)
                        changed = True
                except Exception:
                    pass
                continue
            prev = getattr(agent, key, None)
            try:
                setattr(agent, key, type(prev)(val) if prev is not None else val)
            except Exception:
                try:
                    setattr(agent, key, val)
                except Exception:
                    continue
            new_val = getattr(agent, key, None)
            if hasattr(delta, key):
                setattr(delta, key, new_val)
            changed = True
        if is_dead and (updates.get("__action") == "revive" or updates.get("state") not in (None, "dead")):
            if (updates.get("state") and updates["state"] != "dead") or (updates.get("hp", 0) > 0 and updates.get("__action") == "revive"):
                if agent.state == "dead" and updates.get("state"):
                    agent.state = updates["state"]
                    delta.state = updates["state"]
                    changed = True
                if agent.hp <= 0:
                    agent.hp = max(1.0, float(updates.get("hp", 50.0)))
                    delta.hp = agent.hp
                    changed = True
        return delta if changed else None

    def edit_tile(self, x: int, y: int, tile_type: int, crop_growth: float = 0.0) -> dict | None:
        if x < 0 or y < 0 or x >= self.grid_size or y >= self.grid_size:
            return None
        tile = self.map_grid[y][x]
        old_type = tile.type
        old_growth = tile.crop_growth
        valid_types = {0, 1, 2, 3, 4, 5, 6}
        if tile_type not in valid_types:
            return None
        tile.type = int(tile_type)
        tile.crop_growth = max(0.0, min(1.0, float(crop_growth)))
        if tile.type != 2:
            tile.crop_type = None
            tile.crop_growth = 0.0
        changed = (old_type != tile.type) or (abs(old_growth - tile.crop_growth) > 1e-6)
        if not changed:
            return None
        return {"x": x, "y": y, "type": tile.type, "crop_growth": tile.crop_growth,
                "crop_type": tile.crop_type, "owner_id": tile.owner_id}

    def execute_god_command(self, action: str, value: Any = None) -> dict:
        action = (action or "").lower()
        result: dict[str, Any] = {"action": action, "ok": True}
        if action == "kill_all":
            killed_ids: list[int] = []
            for ag in self.agents.values():
                if ag.state != "dead":
                    ag.state = "dead"
                    ag.hp = 0.0
                    killed_ids.append(ag.id)
                    ev = EventItem(
                        tick=self.tick, agent_id=ag.id, type="death",
                        text=f"Agent {ag.id} ({ag.name}) killed by God command",
                        payload={"cause": "god_kill"},
                    )
                    self._current_events.append(ev)
            result["killed_agents"] = len(killed_ids)
            result["killed_ids"] = killed_ids
        elif action == "kill_all_animals":
            for an in self.animals.values():
                if an.state != "dead":
                    an.state = "dead"
                    an.hp = 0.0
            result["killed_animals"] = len(self.animals)
        elif action == "revive_all":
            revived = 0
            for ag in self.agents.values():
                if ag.state == "dead":
                    ag.state = "idle"
                    ag.hp = 80.0
                    ag.energy = 100.0
                    ag.hunger = 20.0
                    revived += 1
            result["revived_agents"] = revived
        elif action == "force_weather":
            weather = str(value or "clear").lower()
            ok = self.force_weather(weather)
            if not ok:
                result["ok"] = False
                result["error"] = "invalid weather"
            result["weather"] = self.ecology.weather
        elif action == "force_season":
            season = str(value or "spring").lower()
            ok = self.force_season(season)
            if not ok:
                result["ok"] = False
                result["error"] = "invalid season"
            result["season"] = self.ecology.season
        elif action == "spawn_animals":
            count = max(0, int(value or 5))
            spawned = self.spawn_animals(count)
            result["spawned_count"] = len(spawned)
            result["total_animals"] = len(self.animals)
        elif action == "fill_all_needs":
            filled = 0
            for ag in self.agents.values():
                if ag.state != "dead":
                    ag.hp = 100.0
                    ag.energy = 100.0
                    ag.hunger = 0.0
                    ag.mood = 80.0
                    filled += 1
            result["filled_count"] = filled
        elif action == "give_money_all":
            amount = float(value or 100.0)
            count = 0
            for ag in self.agents.values():
                if ag.state != "dead":
                    ag.money = float(ag.money or 0.0) + amount
                    count += 1
            result["count"] = count
            result["amount_per_agent"] = amount
        else:
            result["ok"] = False
            result["error"] = f"unknown action: {action}"
        return result

    def force_weather(self, weather: str) -> bool:
        valid = {"clear", "rain", "snow"}
        if weather not in valid:
            return False
        self.ecology.weather = weather
        self.ecology._weather_changed = True
        return True

    def force_season(self, season: str) -> bool:
        valid = {"spring", "summer", "autumn", "winter"}
        if season not in valid:
            return False
        self.ecology.season = season
        self.ecology._season_changed = True
        return True

    def spawn_animals(self, count: int) -> list[AnimalSchema]:
        from app.config import FRIENDLY_ANIMALS
        import random as _r
        spawned: list[AnimalSchema] = []
        for _ in range(max(0, int(count))):
            atype = _r.choice(FRIENDLY_ANIMALS)
            a = create_random_animal(self.next_animal_id, atype, self.map_grid, self.grid_size)
            self.animals[a.id] = a
            self.next_animal_id += 1
            spawned.append(a)
            ev = EventItem(
                tick=self.tick, agent_id=None, type="animal_spawn",
                text=f"Animal {a.id} ({a.type}: {a.name}) spawned at ({a.x},{a.y})",
                payload={"animal_id": a.id, "animal_type": a.type, "name": a.name, "x": a.x, "y": a.y},
            )
            self._current_events.append(ev)
        return spawned

    def add_sse_client(self, q: "Queue[str]") -> None:
        self.sse_clients.add(q)

    def remove_sse_client(self, q: "Queue[str]") -> None:
        self.sse_clients.discard(q)

    async def _broadcast_sse(self, sse_data: SSEData) -> None:
        payload = "data: " + json.dumps(sse_data.model_dump(mode="json"), ensure_ascii=False) + "\n\n"
        dead: set[Queue[str]] = set()
        for q in list(self.sse_clients):
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                pass
            except Exception:
                dead.add(q)
        for q in dead:
            self.sse_clients.discard(q)

    def _recalc_market_price(self) -> bool:
        total_grain = 0
        total_wood = 0
        total_stone = 0
        total_vegetable = 0
        total_fruit = 0
        total_industrial = 0
        for a in self.agents.values():
            inv = a.inventory
            total_grain += int((inv.grain or 0) + (inv.wheat or 0))
            total_wood += int(inv.wood or 0)
            total_stone += int(inv.stone or 0)
            total_vegetable += int(inv.vegetable or 0)
            total_fruit += int(inv.fruit or 0)
            total_industrial += int(inv.industrial or 0)

        new_grain = 1.0
        total_food = total_grain + total_vegetable + total_fruit
        if total_food > 300:
            ratio = 300.0 / max(1.0, total_food)
            new_grain = max(0.25, min(1.0, ratio))
        elif total_food < 40:
            new_grain = min(2.5, 1.0 + (40 - total_food) * 0.025)

        new_prices = {
            "wheat": round(new_grain, 3),
            "grain": round(new_grain, 3),
            "vegetable": round(new_grain * 1.1, 3),
            "fruit": round(new_grain * 1.2, 3),
            "industrial": round(1.3 + max(0, 20 - total_industrial) * 0.03, 3),
            "wood": round(1.0 + max(0, 20 - total_wood) * 0.02, 3),
            "stone": round(1.0 + max(0, 10 - total_stone) * 0.04, 3),
        }

        def _changed(a, b, key):
            return abs(a - b.get(key, 1.0)) > 0.01

        changed = (
            self._last_market_price is None
            or any(_changed(new_prices[k], self.market_price, k) for k in new_prices)
        )

        self._last_market_price = dict(self.market_price)
        self.market_price = new_prices
        return changed

    async def do_tick(self) -> None: 
        self.tick += 1 
        tick_crops(self.map_grid) 

        # 1. Snapshots قبل الحركة 
        snapshots = {aid: snapshot_agent(a) for aid, a in self.agents.items()} 

        all_events = [] 

        # 2. Agents AI
        for agent in list(self.agents.values()): 
            evs = run_agent_ai(agent, self.map_grid, self.grid_size, self.tick, self.agents) 
            all_events.extend(evs) 

        # 3. Animals AI
        for animal in list(self.animals.values()):
            run_animal_ai(animal, self.map_grid, self.grid_size)

        self._current_events.extend(all_events) 

        # 4. حساب Deltas 
        deltas = [] 
        for aid, agent in self.agents.items(): 
            prev = snapshots.get(aid) 
            if not prev: continue 
            d = AgentDelta(id=aid) 
            changed = False 
            if prev["x"] != agent.x: d.x, changed = agent.x, True 
            if prev["y"] != agent.y: d.y, changed = agent.y, True 
            if abs(prev["hunger"] - agent.hunger) > 0.05: d.hunger, changed = round(agent.hunger, 2), True 
            if abs(prev["energy"] - agent.energy) > 0.05: d.energy, changed = round(agent.energy, 2), True 
            if abs(prev["hp"] - agent.hp) > 0.05: d.hp, changed = round(agent.hp, 2), True 
            if prev["state"] != agent.state: d.state, changed = agent.state, True 
            try:
                prev_wheat = prev.get("inventory_wheat", 0)
                cur_grain = int(getattr(agent.inventory, "wheat", 0) or 0) + int(getattr(agent.inventory, "grain", 0) or 0)
                if prev_wheat != cur_grain:
                    d.inventory, changed = agent.inventory.model_copy(), True
            except Exception:
                pass
            if changed: deltas.append(d) 

        # 5. بث SSE فوري
        sse_data = SSEData(tick=self.tick, agents_delta=deltas, new_events=all_events) 
        await self._broadcast_sse(sse_data) 

        # 6. حفظ دوري
        if self.tick % settings.SAVE_INTERVAL_TICKS == 0: 
            await self.save_world_state() 
            await self.persist_profiles() 
            await self.persist_events(self._current_events) 
            self._current_events.clear() 
