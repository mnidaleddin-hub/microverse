import random
from app.config import settings


class EcologyManager:
    def __init__(self):
        self.season = "spring"   # spring, summer, autumn, winter
        self.weather = "clear"   # clear, rain, snow
        self._season_counter = 0
        self._weather_counter = 0
        self._season_changed = False
        self._weather_changed = False
        self.SEASON_LENGTH = 10000
        self.WEATHER_CHANGE_CHANCE = 0.001  # احتمال تغيير الطقس كل tick

    def tick(self, world):
        self._season_changed = False
        self._weather_changed = False
        self._season_counter += 1
        self._weather_counter += 1

        # تغيير الفصل كل 10000 tick
        if self._season_counter >= self.SEASON_LENGTH:
            self._season_counter = 0
            seasons = ["spring", "summer", "autumn", "winter"]
            current_idx = seasons.index(self.season)
            self.season = seasons[(current_idx + 1) % 4]
            self._season_changed = True
            print(f"[Ecology] Season changed to {self.season}")

        # تغيير الطقس عشوائياً كل tick بفرصة صغيرة
        if random.random() < self.WEATHER_CHANGE_CHANCE:
            if self.season == "winter":
                new_weather = random.choice(["snow", "clear"])
            elif self.season == "summer":
                new_weather = random.choice(["rain", "clear", "clear", "clear"])  # غالباً صيف صافي
            elif self.season == "autumn":
                new_weather = random.choice(["rain", "clear", "rain"])
            else:  # spring
                new_weather = random.choice(["rain", "clear", "clear"])
            if new_weather != self.weather:
                self.weather = new_weather
                self._weather_changed = True
                print(f"[Ecology] Weather changed to {self.weather}")

    def has_changed(self):
        """هل تغير الفصل أو الطقس في هذا الـ Tick أم لا؟ (لإرسال world_update فقط عند التغيير)"""
        return self._season_changed or self._weather_changed

    def get_state(self):
        return {"season": self.season, "weather": self.weather}
