# Microverse Frontend v3

Professional **HTML5 Canvas 2D** AI civilization simulation. Runs fully offline — no PIXI, no required backend.

## Quick Start

```bash
cd microverse-frontend
npx serve -l 5173 .
# open http://localhost:5173
```

Or any static file server that supports ES modules.

## What You Get

- **50×50 procedural world** (grass, water, farm, stone, beach, mountain, forest, river)
- **12+ living agents** with needs, personality, goals, and thoughts
- **Real-time minimap** (200×200) with click-to-teleport
- **Day/night**, seasons, weather (rain / snow / storm / fog)
- **Economy**, culture, conflict, and observer mode
- **God Mode** — spawn, bless, curse, disasters, time control
- **Codex** — 500+ entity catalog
- **Creative extras** — Achievements, AI Director, Daily Challenge, Screenshot, procedural New World Seed

## Controls

| Input | Action |
|-------|--------|
| Drag | Pan camera |
| Scroll / `+` `-` | Zoom (50%–300%) |
| WASD / Arrows | Pan |
| Click agent | Select + Observer |
| `F` | Follow selected |
| `Space` | Pause / resume |
| Minimap click | Jump camera |
| Dashboard | Stats, God Mode, charts |

## Architecture

```
main.js                 # Boot, RAF loop, UI wiring
src/systems/
  visual.js             # Canvas engine, camera, particles, lighting
  social_ai.js          # Needs / decisions / memory / relationships
  economy.js            # Prices, trade, GDP
  conflict_politics.js  # Factions, skirmishes, treaties
  culture.js            # Tech, festivals, art
  environment.js        # Seasons, weather, day/night, disasters
  gameplay.js           # God queue, save/load, speed
  analytics.js          # Metrics + history charts
  observer.js           # Focus panel data
src/data/registry.json  # 500+ entities
```

## Save / Load

Uses `localStorage` key `microverse_save` (slots 0–4). Auto-save every 100 ticks.

Debug: `window.__MICROVERSE__` exposes `{ world, getEngine, saveWorld, loadWorld }`.

## Performance Targets

- 60 FPS with ~100 agents (culling + particle pool)
- Codex virtualizes to 120 visible cards
- Event log capped; history capped at 120 samples

## License

Part of the Microverse project.
