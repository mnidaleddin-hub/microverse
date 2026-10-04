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
    ControlRequest,
    HealthResponse,
    WorldInitResponse,
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
    )


@app.get("/api/world/init", response_model=WorldInitResponse)
async def world_init() -> WorldInitResponse:
    assert WORLD is not None
    async with WORLD._lock:
        return WorldInitResponse(
            tick=WORLD.tick,
            map=[row[:] for row in WORLD.map_grid],
            agents=list(WORLD.agents.values()),
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
        else:
            return {"ok": False, "error": f"unknown action: {body.action}"}
    return {"ok": True, "action": action, "tick": WORLD.tick, "paused": WORLD.paused, "speed": WORLD.tick_interval}
