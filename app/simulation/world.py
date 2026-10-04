from __future__ import annotations

import asyncio
import json
import random
from typing import TYPE_CHECKING

from app.config import settings
from app.schemas import (
    AgentDelta,
    AgentSchema,
    EventItem,
    Inventory,
    SSEData,
    Tile,
    Traits,
    WorldUpdate,
)
from app.simulation.agent import create_random_agent, run_agent_ai, snapshot_agent
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
        self.next_agent_id: int = 1
        self.sse_clients: set[Queue[str]] = set()
        self._current_events: list[EventItem] = []
        self._lock = asyncio.Lock()
        self.ecology: EcologyManager = EcologyManager()
        # --- اقتصاد مصغر ---
        self.market_price: dict[str, float] = {"wheat": 1.0, "wood": 1.0, "stone": 1.0}
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
                    t = 3  # غابة / Forest — مأوى في العواصف
                row.append(Tile(type=t, crop_growth=0.0, owner_id=None))
            grid.append(row)
        return grid

    def _spawn_initial_agents(self) -> dict[int, AgentSchema]:
        agents: dict[int, AgentSchema] = {}
        for i in range(self.agent_count):
            agent = create_random_agent(i + 1, self.map_grid, self.grid_size)
            agents[agent.id] = agent
        self.next_agent_id = self.agent_count + 1
        return agents

    def reset_world(self) -> None:
        self.tick = 0
        self.map_grid = self._generate_map()
        self.agents = self._spawn_initial_agents()
        self._current_events = [
            EventItem(
                tick=0, agent_id=a.id, type="spawn",
                text=f"Agent {a.id} ({a.name}) spawned at ({a.x},{a.y})",
                payload={"name": a.name, "x": a.x, "y": a.y, "gender": a.gender},
            )
            for a in self.agents.values()
        ]

    def serialize_map_to_dict(self) -> list[list[dict]]:
        return [[tile.model_dump() for tile in row] for row in self.map_grid]

    def serialize_agents_to_dict(self) -> dict[int, dict]:
        return {aid: ag.model_dump(mode="json") for aid, ag in self.agents.items()}

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
            return True

    async def save_world_state(self) -> None:
        from app.database import get_session_factory
        from app.models import WorldState as WorldStateModel

        factory = get_session_factory()
        async with factory() as session:
            async with session.begin():
                ws = await session.get(WorldStateModel, 1)
                payload = {
                    "id": 1,
                    "tick": self.tick,
                    "map_json": self.serialize_map_to_dict(),
                    "agents_json": self.serialize_agents_to_dict(),
                }
                if ws is None:
                    from sqlalchemy import insert
                    await session.execute(insert(WorldStateModel).values(**payload))
                else:
                    ws.tick = self.tick
                    ws.map_json = payload["map_json"]
                    ws.agents_json = payload["agents_json"]

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
        """Realism: سعر القمح ينخفض فقط إذا كان المخزون الكلي > 200 وحدة."""
        total_wheat = 0
        total_wood = 0
        total_stone = 0
        for a in self.agents.values():
            total_wheat += int(a.inventory.wheat or 0)
            total_wood += int(a.inventory.wood or 0)
            total_stone += int(a.inventory.stone or 0)

        new_wheat = 1.0
        if total_wheat > 200:
            ratio = 200.0 / max(1.0, total_wheat)
            new_wheat = max(0.25, min(1.0, ratio))
        elif total_wheat < 30:
            new_wheat = min(2.5, 1.0 + (30 - total_wheat) * 0.03)

        new_prices = {
            "wheat": round(new_wheat, 3),
            "wood": round(1.0 + max(0, 20 - total_wood) * 0.02, 3),
            "stone": round(1.0 + max(0, 10 - total_stone) * 0.04, 3),
        }

        changed = (
            self._last_market_price is None
            or abs(new_prices["wheat"] - self.market_price.get("wheat", 1.0)) > 0.01
            or abs(new_prices["wood"] - self.market_price.get("wood", 1.0)) > 0.01
            or abs(new_prices["stone"] - self.market_price.get("stone", 1.0)) > 0.01
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
        for agent in list(self.agents.values()): 
            evs = run_agent_ai(agent, self.map_grid, self.grid_size, self.tick, self.agents) 
            all_events.extend(evs) 
            
        # ✅ التصحيح: تراكم الأحداث بدلاً من الاستبدال 
        self._current_events.extend(all_events) 
        
        # 2. حساب Deltas 
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
            if prev["inventory_wheat"] != agent.inventory.wheat: d.inventory, changed = agent.inventory.model_copy(), True 
            if changed: deltas.append(d) 
            
        # 3. بث SSE فوري (لحظي) 
        sse_data = SSEData(tick=self.tick, agents_delta=deltas, new_events=all_events) 
        await self._broadcast_sse(sse_data) 
        
        # 4. حفظ دوري (Batch) كل 60 tick 
        if self.tick % settings.SAVE_INTERVAL_TICKS == 0: 
            await self.save_world_state() 
            await self.persist_profiles() 
            await self.persist_events(self._current_events) 
            self._current_events.clear() # ✅ مسح القائمة بعد الحفظ 