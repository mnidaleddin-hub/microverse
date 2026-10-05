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
    MAX_AGENTS: int = 50
    INITIAL_ANIMALS_COUNT: int = 8
    MAX_ANIMALS: int = 60

    @field_validator("DATABASE_URL", mode="before") 
    @classmethod 
    def fix_async_driver(cls, v: str) -> str: 
        if not v: return "sqlite+aiosqlite:///./microverse.db" 
        if v.startswith("postgresql://"): 
            v = v.replace("postgresql://", "postgresql+asyncpg://", 1) 
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

HUMAN_TRAITS = [
    "courage", "intelligence", "fertility", "aggression", "greed",
    "generosity", "loyalty", "betrayal", "patience", "curiosity",
    "leadership", "empathy", "optimism", "pessimism", "creativity",
    "introversion", "honesty", "wisdom", "temperance", "diligence",
]

HUMAN_TRAITS_EXTRA = ["charisma", "discipline", "resilience"]

ANIMAL_TRAITS = [
    "speed", "strength", "endurance", "eyesight", "smell",
    "size", "weight", "color_variant", "disease_resistance", "milk_production",
    "egg_production", "wool_production", "intelligence", "tameness", "aggressiveness",
    "trainability", "adaptability", "lifespan", "fertility", "health",
]

CROP_PROPERTIES = {
    "wheat":      {"category": "grain",       "growth_time": 600,  "yield": 5, "seasons": ["spring", "summer"]},
    "barley":     {"category": "grain",       "growth_time": 540,  "yield": 4, "seasons": ["spring", "summer"]},
    "rice":       {"category": "grain",       "growth_time": 720,  "yield": 6, "seasons": ["spring", "summer"]},
    "corn":       {"category": "grain",       "growth_time": 660,  "yield": 5, "seasons": ["summer"]},
    "oats":       {"category": "grain",       "growth_time": 510,  "yield": 4, "seasons": ["spring", "autumn"]},
    "black_wheat":{"category": "grain",       "growth_time": 780,  "yield": 3, "seasons": ["summer", "autumn"]},
    "carrot":     {"category": "vegetable",   "growth_time": 400,  "yield": 3, "seasons": ["spring", "autumn"]},
    "potato":     {"category": "vegetable",   "growth_time": 480,  "yield": 4, "seasons": ["spring", "autumn"]},
    "beet":       {"category": "vegetable",   "growth_time": 450,  "yield": 3, "seasons": ["spring", "autumn"]},
    "turnip":     {"category": "vegetable",   "growth_time": 380,  "yield": 3, "seasons": ["autumn", "winter"]},
    "onion":      {"category": "vegetable",   "growth_time": 420,  "yield": 4, "seasons": ["spring", "summer"]},
    "garlic":     {"category": "vegetable",   "growth_time": 540,  "yield": 2, "seasons": ["autumn", "spring"]},
    "apple":      {"category": "fruit",       "growth_time": 1200, "yield": 8, "seasons": ["summer", "autumn"]},
    "cherry":     {"category": "fruit",       "growth_time": 1080, "yield": 6, "seasons": ["spring", "summer"]},
    "grape":      {"category": "fruit",       "growth_time": 960,  "yield": 7, "seasons": ["summer", "autumn"]},
    "watermelon": {"category": "fruit",       "growth_time": 780,  "yield": 5, "seasons": ["summer"]},
    "pumpkin":    {"category": "fruit",       "growth_time": 840,  "yield": 4, "seasons": ["autumn"]},
    "orange":     {"category": "fruit",       "growth_time": 1320, "yield": 7, "seasons": ["winter", "spring"]},
    "cotton":     {"category": "industrial",  "growth_time": 900,  "yield": 4, "seasons": ["summer"]},
    "sugarcane":  {"category": "industrial",  "growth_time": 960,  "yield": 5, "seasons": ["summer"]},
    "coffee":     {"category": "industrial",  "growth_time": 1440, "yield": 3, "seasons": ["spring", "autumn"]},
    "tea":        {"category": "industrial",  "growth_time": 1380, "yield": 3, "seasons": ["spring", "autumn"]},
    "olive":      {"category": "industrial",  "growth_time": 1500, "yield": 4, "seasons": ["autumn"]},
    "palm":       {"category": "industrial",  "growth_time": 1560, "yield": 5, "seasons": ["summer"]},
}

CATEGORY_TO_INVENTORY_FIELD = {
    "grain": "grain",
    "vegetable": "vegetable",
    "fruit": "fruit",
    "industrial": "industrial",
}

ANIMAL_NAMES_POOL = {
    "cow":     ["Bessie", "Daisy", "Buttercup", "Clover", "Molly", "Luna", "Bella"],
    "sheep":   ["Fluffy", "Woolly", "Dolly", "Lambie", "Cloud", "Snowy", "Cotton"],
    "chicken": ["Henrietta", "Clucky", "Nugget", "Drumstick", "Pepper", "Daisy", "Coco"],
    "pig":     ["Porky", "Wilbur", "Babe", "Peppa", "Hamlet", "Oink", "Pinky"],
    "horse":   ["Shadow", "Spirit", "Blaze", "Thunder", "Stormy", "Lucky", "Star"],
    "dog":     ["Rex", "Buddy", "Max", "Rocky", "Lucky", "Charlie", "Bella"],
    "cat":     ["Whiskers", "Mittens", "Luna", "Simba", "Milo", "Oliver", "Cleo"],
    "duck":    ["Daffy", "Donald", "Quackers", "Ducky", "Waddles", "Daisy", "Howard"],
    "goose":   ["Goosie", "Gander", "Honker", "Lucy", "Gracie", "Gerald", "Gus"],
    "goat":    ["Billy", "Nanny", "Goatie", "Butter", "Coco", "Rocky", "Willow"],
    "camel":   ["Humpy", "Cammie", "Sahara", "Desert", "Oasis", "Mirage", "Raji"],
    "donkey":  ["Donkey", "Eeyore", "Heehaw", "Jack", "Jenny", "Muffin", "Dusty"],
    "rabbit":  ["Bunny", "Thumper", "Cottontail", "Flopsy", "Mopsy", "Peter", "Luna"],
    "fox":     ["Red", "Foxy", "Vixen", "Swift", "Hunter", "Ember", "Autumn"],
    "wolf":    ["Alpha", "Shadow", "Grey", "Night", "Storm", "Luna", "Sage"],
    "bear":    ["Yogi", "BooBoo", "Teddy", "Baloo", "Honey", "Koda", "Smokey"],
    "elephant":["Jumbo", "Ellie", "Tusker", "Hathi", "Zara", "Khan", "Nelly"],
    "giraffe": ["Tallie", "Gigi", "Longneck", "Melman", "Spot", "Skittles", "Apollo"],
    "lion":    ["Simba", "Mufasa", "Leo", "King", "Scar", "Nala", "Aslan"],
    "tiger":   ["Tigger", "ShereKhan", "Rajah", "Hobbes", "Stripes", "Rani", "Khan"],
}

FRIENDLY_ANIMALS = ["cow", "sheep", "chicken", "pig", "horse", "dog", "cat", "duck", "goose", "goat", "camel", "donkey", "rabbit"]
WILD_ANIMALS     = ["fox", "wolf", "bear", "elephant", "giraffe", "lion", "tiger"]

TILE_BIOMES = {
    0: {"name": "Plains",   "color": 0x7CB342, "description": "Green grass plains"},
    1: {"name": "Water",    "color": 0x1565C0, "description": "Dark blue water"},
    2: {"name": "Farmland", "color": 0x6D4C41, "description": "Brown farmed soil"},
    3: {"name": "Forest",   "color": 0x2E7D32, "description": "Dark green forest with trees"},
    4: {"name": "Desert",   "color": 0xFDD835, "description": "Yellow sand"},
    5: {"name": "Snow",     "color": 0xE3F2FD, "description": "White-blue snow"},
    6: {"name": "Swamp",    "color": 0x558B2F, "description": "Brownish-green swamp with mist"},
}
BIOME_COUNT = 7

settings = Settings() 
