import os
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str = os.getenv(
        "DATABASE_URL",
        "sqlite+aiosqlite:///./microverse.db",
    )
    GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
    GRID_SIZE: int = 40
    AGENT_COUNT: int = 15
    INITIAL_TICK_INTERVAL: float = 1.0
    SAVE_INTERVAL_TICKS: int = 60

    @field_validator("DATABASE_URL", mode="before")
    @classmethod
    def fix_async_driver(cls, v: str) -> str:
        if v and v.startswith("postgresql://"):
            v = v.replace("postgresql://", "postgresql+asyncpg://", 1)
        if v and "channel_binding=require" in v:
            v = v.replace("&channel_binding=require", "")
            v = v.replace("?channel_binding=require&", "?")
            v = v.replace("?channel_binding=require", "")
        return v


settings = Settings()
