# Microverse Overhaul — Architecture Plan

## Phase 1: Legacy Audit
- Eradicate: `map`, `controls`, `minimap`, `sidebar` legacy modules.
- Preserve: `database.py` async engine, `models.py` base schema.

## Phase 2: 200-Entity JSON Registry
- Schema: `entity_id`, `type` (flora/fauna/structure), `stats` (hp, speed, rarity), `sprite_ref`, `behavior_tree`.
- Storage: JSON column `animals_json` in `world_state` (existing); extend to `entity_registry` table.

## Phase 3: UI/UX Architecture
- Theme: Dark Fantasy Pixel-Art + Glassmorphism (`backdrop-filter: blur(12px)`, `rgba(255,255,255,0.05)` borders).
- Components: Header (glass), Drawer (slide-in), Minimap (canvas overlay), Sidebar (collapsible).

## Phase 4: Engine
- Phaser 3 / PixiJS tilemap layer; sprite atlas for 200 entities.

## Phase 5: Polish
- Particle system (rain/snow/leaves), smooth camera follow, audio manager, tooltip micro-interactions.
