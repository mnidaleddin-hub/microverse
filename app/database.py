from collections.abc import AsyncGenerator 
from typing import Any 
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine 
from app.config import settings 

_engine: AsyncEngine | None = None 
_async_session: async_sessionmaker[AsyncSession] | None = None 

def get_engine() -> AsyncEngine: 
    global _engine 
    if _engine is None: 
        is_pg = "postgresql" in settings.DATABASE_URL 
        kwargs: dict[str, Any] = {"echo": False, "pool_pre_ping": True} 
        if is_pg: 
            kwargs.update({"pool_size": 20, "max_overflow": 10, "pool_timeout": 30, "pool_recycle": 1800}) 
            kwargs["connect_args"] = {"ssl": "require"} 
        else: 
            kwargs["connect_args"] = {"check_same_thread": False} 
        _engine = create_async_engine(settings.DATABASE_URL, **kwargs) 
    return _engine 

def get_session_factory() -> async_sessionmaker[AsyncSession]: 
    global _async_session 
    if _async_session is None: 
        # ✅ التصحيح القاتل: class_ وليس class 
        _async_session = async_sessionmaker(get_engine(), class_=AsyncSession, expire_on_commit=False) 
    return _async_session 

async def create_tables() -> None:
    from sqlalchemy import text
    from app.models import Base
    engine = get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        try:
            # SQLite check
            rows = await conn.execute(text("PRAGMA table_info(world_state)"))
            cols = {row[1] for row in rows.fetchall()}
            if "animals_json" not in cols:
                await conn.execute(text("ALTER TABLE world_state ADD COLUMN animals_json JSON NOT NULL DEFAULT '{}'"))
        except Exception:
            pass
        # PostgreSQL check (with schema) — separate transaction to avoid abort
        try:
            async with engine.begin() as conn2:
                result = await conn2.execute(text("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='world_state' AND column_name='animals_json'"))
                if not result.fetchone():
                    await conn2.execute(text("ALTER TABLE world_state ADD COLUMN IF NOT EXISTS animals_json JSON NOT NULL DEFAULT '{}'::json"))
        except Exception as e:
            print(f"[DB Migration] PostgreSQL ALTER error (ignored): {e}")

async def get_db() -> AsyncGenerator[AsyncSession, None]: 
    factory = get_session_factory() 
    async with factory() as session: 
        yield session 