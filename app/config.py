import os 
from pydantic import field_validator 
from pydantic_settings import BaseSettings, SettingsConfigDict 

class Settings(BaseSettings): 
    model_config = SettingsConfigDict(env_file=".env", extra="ignore") 
    
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./microverse.db") 
    GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "") 
    GRID_SIZE: int = 40 
    AGENT_COUNT: int = 15 
    INITIAL_TICK_INTERVAL: float = 1.0 
    SAVE_INTERVAL_TICKS: int = 60 
    MAX_AGENTS: int = 50  # حد أمان لمنع الانهيار 

    @field_validator("DATABASE_URL", mode="before") 
    @classmethod 
    def fix_async_driver(cls, v: str) -> str: 
        if not v: return "sqlite+aiosqlite:///./microverse.db" 
        if v.startswith("postgresql://"): 
            v = v.replace("postgresql://", "postgresql+asyncpg://", 1) 
        # إزالة معاملات تسبب مشاكل مع asyncpg 
        for bad_param in ["channel_binding=require", "sslmode=require"]: 
            if f"?{bad_param}" in v: v = v.split(f"?{bad_param}")[0] 
            elif f"&{bad_param}" in v: v = v.replace(f"&{bad_param}", "") 
        return v 

DIALOG_TEMPLATES = [
    "مرحباً! 👋",
    "كيف حالك؟ 😊",
    "هل لديك قمح؟ 🌾",
    "الطقس جميل اليوم ☀️",
    "أشعر بالتعب 😴",
    "هل رأيت المزرعة؟ 🌾",
    "سأذهب لآكل شيء 🍕",
    "أتمنى أن نصبح أصدقاء 🤝",
    "ما رأيك في الجمال هنا؟ 🌿",
    "لقد حصدت الكثير اليوم! 🎉",
    "هل أنت متزوج؟ 💍",
    "أحب هذا المكان ❤️",
    "هل تريد أن نذهب معاً؟ 🚶",
    "أشعر بالجوع جداً 😫",
    "النوم مهم للصحة 😴",
]

settings = Settings() 