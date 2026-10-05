from __future__ import annotations

import asyncio
import os
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse

from app.config import settings
from app.database import create_tables, get_db
from app.schemas import (
    AdminEditAgentRequest,
    ControlRequest,
    EditAgentRequest,
    EditTileRequest,
    GodModeCommand,
    HealthResponse,
    WorldInitResponse,
    WorldUpdate,
)
from app.simulation.world import World

WORLD: World | None = None
_TICK_TASK: asyncio.Task[Any] | None = None


async def _tick_loop() -> None:
    assert WORLD is not None
    while True:
        try:
            if not WORLD.paused:
                async with WORLD._lock:
                    await WORLD.do_tick()
            await asyncio.sleep(WORLD.tick_interval)
        except Exception as exc:  # noqa: BLE001
            print(f"[tick_loop] error: {exc!r}", flush=True)
            await asyncio.sleep(1.0)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    global WORLD, _TICK_TASK

    await create_tables()

    WORLD = World()
    loaded = await WORLD.load_from_db()
    if not loaded:
        WORLD.reset_world()
        await WORLD.persist_events(WORLD._current_events)
        await WORLD.persist_profiles()
        await WORLD.save_world_state()

    _TICK_TASK = asyncio.create_task(_tick_loop())

    yield

    if _TICK_TASK is not None and not _TICK_TASK.done():
        _TICK_TASK.cancel()
        try:
            await _TICK_TASK
        except Exception:
            pass


app = FastAPI(title="Microverse", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

_STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")


@app.get("/", response_class=HTMLResponse)
async def index() -> FileResponse:
    path = os.path.join(_STATIC_DIR, "index.html")
    if os.path.isfile(path):
        return FileResponse(path)
    return HTMLResponse("<html><body><h1>Microverse is running</h1></body></html>")


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    assert WORLD is not None
    return HealthResponse(
        status="alive",
        tick=WORLD.tick,
        agents_count=len(WORLD.agents),
        animals_count=len(WORLD.animals),
    )


@app.get("/api/world/init", response_model=WorldInitResponse)
async def world_init() -> WorldInitResponse:
    assert WORLD is not None
    async with WORLD._lock:
        eco_state = WORLD.ecology.get_state()
        return WorldInitResponse(
            tick=WORLD.tick,
            map=[row[:] for row in WORLD.map_grid],
            agents=list(WORLD.agents.values()),
            animals=list(WORLD.animals.values()),
            world_state=WorldUpdate(
                season=eco_state.get("season"),
                weather=eco_state.get("weather"),
                grid_delta=None,
                market_price=dict(WORLD.market_price),
            ),
        )


@app.get("/api/world/stream")
async def world_stream(request: Request) -> StreamingResponse:
    assert WORLD is not None
    queue: asyncio.Queue[str] = asyncio.Queue(maxsize=100)
    WORLD.add_sse_client(queue)

    async def event_generator() -> AsyncGenerator[str, None]:
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    data = await asyncio.wait_for(queue.get(), timeout=5.0)
                    yield data
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
        finally:
            WORLD.remove_sse_client(queue)

    return StreamingResponse(
        event_generator(),
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            "Content-Type": "text/event-stream",
        },
    )


@app.post("/api/world/control")
async def world_control(body: ControlRequest) -> dict[str, Any]:
    assert WORLD is not None
    action = body.action.lower()
    result: dict[str, Any] = {"ok": True, "action": action, "tick": WORLD.tick, "paused": WORLD.paused, "speed": WORLD.tick_interval}
    async with WORLD._lock:
        if action == "pause":
            WORLD.pause()
        elif action == "resume":
            WORLD.resume()
        elif action == "reset":
            WORLD.reset_world()
            await WORLD.persist_events(WORLD._current_events)
            WORLD._current_events.clear()
            await WORLD.persist_profiles()
            await WORLD.save_world_state()
        elif action == "set_speed":
            if body.value is not None:
                WORLD.set_speed(float(body.value))
        elif action == "force_weather":
            valid = {"clear", "rain", "snow"}
            weather = body.payload if isinstance(body.payload, str) else (str(body.value) if body.value is not None else "")
            weather = weather.lower()
            if weather not in valid:
                return {"ok": False, "error": f"invalid weather: {weather}, valid: {valid}"}
            ok = WORLD.force_weather(weather)
            result["weather"] = WORLD.ecology.weather
            if not ok:
                return {"ok": False, "error": "force_weather failed"}
        elif action == "force_season":
            valid = {"spring", "summer", "autumn", "winter"}
            season = body.payload if isinstance(body.payload, str) else (str(body.value) if body.value is not None else "")
            season = season.lower()
            if season not in valid:
                return {"ok": False, "error": f"invalid season: {season}, valid: {valid}"}
            ok = WORLD.force_season(season)
            result["season"] = WORLD.ecology.season
            if not ok:
                return {"ok": False, "error": "force_season failed"}
        elif action == "spawn_animals":
            count = int(body.value) if body.value is not None else 5
            spawned = WORLD.spawn_animals(count)
            result["spawned_count"] = len(spawned)
            result["animals_count"] = len(WORLD.animals)
        elif action in {"kill_all", "kill_all_animals", "revive_all", "fill_all_needs", "give_money_all"}:
            cmd = WORLD.execute_god_command(action, body.value if body.value is not None else body.payload)
            result.update(cmd)
            if not cmd.get("ok"):
                return {"ok": False, "error": cmd.get("error", f"{action} failed")}
            if action in {"kill_all", "revive_all", "fill_all_needs", "give_money_all"}:
                from app.schemas import SSEData, AgentDelta, EventItem
                deltas = []
                events = []
                for ag in WORLD.agents.values():
                    d = AgentDelta(id=ag.id, hp=ag.hp, energy=ag.energy, hunger=ag.hunger,
                                   mood=ag.mood, state=ag.state, inventory=ag.inventory)
                    deltas.append(d)
                if deltas:
                    sse = SSEData(tick=WORLD.tick, agents_delta=deltas, new_events=[
                        EventItem(tick=WORLD.tick, agent_id=None, type="god_command",
                                  text=f"God command executed: {action}",
                                  payload={"action": action, **cmd})
                    ])
                    await WORLD._broadcast_sse(sse)
        else:
            return {"ok": False, "error": f"unknown action: {body.action}"}
    return result


@app.post("/api/admin/edit_agent")
async def admin_edit_agent(body: AdminEditAgentRequest) -> dict[str, Any]:
    assert WORLD is not None
    async with WORLD._lock:
        delta = WORLD.edit_agent(body.agent_id, body.updates)
        if delta is None:
            agent = WORLD.agents.get(body.agent_id)
            if agent is None:
                return {"ok": False, "error": f"agent {body.agent_id} not found"}
            return {"ok": True, "changed": False, "agent": agent.model_dump(mode="json")}
        from app.schemas import SSEData, EventItem
        sse = SSEData(tick=WORLD.tick, agents_delta=[delta], new_events=[
            EventItem(tick=WORLD.tick, agent_id=body.agent_id, type="admin_edit",
                      text=f"Admin edited agent #{body.agent_id}: {list(body.updates.keys())}",
                      payload={"updates": list(body.updates.keys())})
        ])
        await WORLD._broadcast_sse(sse)
        agent = WORLD.agents.get(body.agent_id)
        return {"ok": True, "changed": True, "delta": delta.model_dump(mode="json"),
                "agent": agent.model_dump(mode="json") if agent else None}


@app.patch("/api/admin/agent")
async def patch_admin_agent(body: EditAgentRequest) -> dict[str, Any]:
    assert WORLD is not None
    async with WORLD._lock:
        delta = WORLD.edit_agent(body.agent_id, body.updates)
        if delta is None:
            agent = WORLD.agents.get(body.agent_id)
            if agent is None:
                return {"ok": False, "error": f"agent {body.agent_id} not found"}
            return {"ok": True, "changed": False, "agent": agent.model_dump(mode="json")}
        from app.schemas import SSEData, EventItem
        sse = SSEData(tick=WORLD.tick, agents_delta=[delta], new_events=[
            EventItem(tick=WORLD.tick, agent_id=body.agent_id, type="admin_edit",
                      text=f"Admin PATCH agent #{body.agent_id}: {list(body.updates.keys())}",
                      payload={"updates": list(body.updates.keys())})
        ])
        await WORLD._broadcast_sse(sse)
        agent = WORLD.agents.get(body.agent_id)
        return {"ok": True, "changed": True, "delta": delta.model_dump(mode="json"),
                "agent": agent.model_dump(mode="json") if agent else None}


@app.patch("/api/admin/tile")
async def patch_admin_tile(body: EditTileRequest) -> dict[str, Any]:
    assert WORLD is not None
    async with WORLD._lock:
        tile_delta = WORLD.edit_tile(body.x, body.y, body.tile_type, body.crop_growth)
        if tile_delta is None:
            if body.x < 0 or body.y < 0 or body.x >= WORLD.grid_size or body.y >= WORLD.grid_size:
                return {"ok": False, "error": f"tile ({body.x},{body.y}) out of bounds (grid_size={WORLD.grid_size})"}
            return {"ok": True, "changed": False, "tile": WORLD.map_grid[body.y][body.x].model_dump(mode="json")}
        from app.schemas import SSEData, WorldUpdate, EventItem
        wu = WorldUpdate(grid_delta=[tile_delta])
        sse = SSEData(tick=WORLD.tick, world_update=wu, new_events=[
            EventItem(tick=WORLD.tick, agent_id=None, type="tile_edit",
                      text=f"Tile ({body.x},{body.y}) changed to type={tile_delta['type']}",
                      payload=tile_delta)
        ])
        await WORLD._broadcast_sse(sse)
        return {"ok": True, "changed": True, "tile": tile_delta}


@app.post("/api/admin/god_command")
async def admin_god_command(body: GodModeCommand) -> dict[str, Any]:
    assert WORLD is not None
    async with WORLD._lock:
        cmd = WORLD.execute_god_command(body.action, body.value)
        if not cmd.get("ok"):
            return {"ok": False, "error": cmd.get("error", "command failed")}
        action = body.action
        if action in {"kill_all", "revive_all", "fill_all_needs", "give_money_all"}:
            from app.schemas import SSEData, AgentDelta, EventItem
            deltas = []
            for ag in WORLD.agents.values():
                d = AgentDelta(id=ag.id, hp=ag.hp, energy=ag.energy, hunger=ag.hunger,
                               mood=ag.mood, state=ag.state, inventory=ag.inventory)
                deltas.append(d)
            sse = SSEData(tick=WORLD.tick, agents_delta=deltas, new_events=[
                EventItem(tick=WORLD.tick, agent_id=None, type="god_command",
                          text=f"God command: {action}", payload=cmd)
            ])
            await WORLD._broadcast_sse(sse)
        elif action in {"force_weather", "force_season"}:
            from app.schemas import SSEData, WorldUpdate, EventItem
            wu = WorldUpdate(
                season=WORLD.ecology.season if action == "force_season" else None,
                weather=WORLD.ecology.weather if action == "force_weather" else None,
            )
            sse = SSEData(tick=WORLD.tick, world_update=wu, new_events=[
                EventItem(tick=WORLD.tick, agent_id=None, type="god_command",
                          text=f"God command: {action}", payload=cmd)
            ])
            await WORLD._broadcast_sse(sse)
        elif action == "spawn_animals":
            from app.schemas import SSEData, EventItem
            sse = SSEData(tick=WORLD.tick, new_events=[
                EventItem(tick=WORLD.tick, agent_id=None, type="god_command",
                          text=f"God command: {action} ({cmd.get('spawned_count',0)} spawned)",
                          payload=cmd)
            ])
            await WORLD._broadcast_sse(sse)
        return {"ok": True, **cmd}
