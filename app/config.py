import os
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


settings = Settings()
