const BACKEND_URL = "https://microverse-backend.onrender.com";
const GRID_SIZE = 40;
const CELL_SIZE = 16;
const MAP_WIDTH = GRID_SIZE * CELL_SIZE;
const MAP_HEIGHT = GRID_SIZE * CELL_SIZE;
const MAX_EVENT_LOG = 30;

console.log("🌍 Microverse Frontend: Initializing...");

// ============================================================
// PIXI APP SETUP
// ============================================================
const app = new PIXI.Application({
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    backgroundColor: 0x0b1a0b,
    antialias: true,
});

document.getElementById('game-container').appendChild(app.view);

// World container (for zoom + pan)
const worldContainer = new PIXI.Container();
app.stage.addChild(worldContainer);

// Layers
const mapBaseContainer = new PIXI.Container();       // Static tile colors + borders
const mapDetailContainer = new PIXI.Container();     // Trees, crops, waves
const agentsContainer = new PIXI.Container();        // Agent sprites
const overlayContainer = new PIXI.Container();       // Selection effects

worldContainer.addChild(mapBaseContainer);
worldContainer.addChild(mapDetailContainer);
worldContainer.addChild(agentsContainer);
worldContainer.addChild(overlayContainer);

// ============================================================
// GLOBAL STATE
// ============================================================
let worldData = null;
let agentsCache = new Map();         // id -> latest agent data
const agentSprites = new Map();      // id -> sprite container
let eventSource = null;
let currentTick = 0;
let selectedAgentId = null;
let hoveredAgentId = null;
let currentSpeedValue = 1.0;
const eventLog = [];

// Zoom state
let currentZoom = 1.0;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.15;

// Water animation state
const waterTiles = [];
let animTime = 0;

// ============================================================
// CELL COLORS (NO DUPLICATES — single definition)
// ============================================================
const CELL_COLORS = {
    0: { base: 0x6aa83a, alt: 0x78b542 },  // grass (two tones for variation)
    1: { base: 0x1976d2, alt: 0x1e88e5 },  // water
    2: { base: 0x8d6e63, alt: 0x795548 },  // farmland
    3: { base: 0x2e7d32, alt: 0x388e3c },  // forest
};

// ============================================================
// HELPER: Normalize grid data (accept flat or 2D arrays)
// ============================================================
function normalizeGrid(rawGrid) {
    if (!rawGrid) return [];
    // If it's already a 2D array
    if (Array.isArray(rawGrid[0]) && rawGrid.length === GRID_SIZE) {
        return rawGrid;
    }
    // If it's flat, convert to 2D
    if (rawGrid.length === GRID_SIZE * GRID_SIZE) {
        const grid = [];
        for (let y = 0; y < GRID_SIZE; y++) {
            const row = [];
            for (let x = 0; x < GRID_SIZE; x++) {
                row.push(rawGrid[y * GRID_SIZE + x]);
            }
            grid.push(row);
        }
        return grid;
    }
    console.warn("⚠️ Unknown grid format:", rawGrid);
    return [];
}

// ============================================================
// MAP RENDERING — BASE LAYER
// ============================================================
function drawMapBase(gridData) {
    mapBaseContainer.removeChildren();
    waterTiles.length = 0;

    // Outer frame/border
    const border = new PIXI.Graphics();
    border.lineStyle(3, 0x000000, 0.6);
    border.drawRect(-0.5, -0.5, MAP_WIDTH + 1, MAP_HEIGHT + 1);
    mapBaseContainer.addChild(border);

    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const cell = gridData[y][x];
            const type = cell.type;
            const palette = CELL_COLORS[type] || CELL_COLORS[0];
            const useAlt = ((x + y) % 2 === 0);
            const fillColor = useAlt ? palette.alt : palette.base;

            const g = new PIXI.Graphics();
            // Faint grid lines
            g.lineStyle(1, 0x000000, 0.05);
            g.beginFill(fillColor);
            g.drawRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
            g.endFill();
            mapBaseContainer.addChild(g);

            if (type === 1) {
                waterTiles.push({ x, y, gfx: null });
            }
        }
    }

    console.log(`🗺️ Map base rendered. Water tiles: ${waterTiles.length}`);
}

// ============================================================
// MAP RENDERING — DETAIL LAYER (trees, crops, waves)
// ============================================================
function drawMapDetails(gridData) {
    mapDetailContainer.removeChildren();

    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const cell = gridData[y][x];
            const cx = x * CELL_SIZE + CELL_SIZE / 2;
            const cy = y * CELL_SIZE + CELL_SIZE / 2;

            // FOREST: trees
            if (cell.type === 3) {
                // Trunk
                const t = new PIXI.Graphics();
                t.beginFill(0x5d4037);
                t.drawRect(cx - 1, cy + 1, 2, 4);
                t.endFill();
                // Foliage (2-3 circles for fluffy look)
                t.beginFill(0x1b5e20);
                t.drawCircle(cx, cy - 1, 5);
                t.endFill();
                t.beginFill(0x2e7d32);
                t.drawCircle(cx - 2, cy - 2, 3);
                t.endFill();
                t.beginFill(0x388e3c);
                t.drawCircle(cx + 2, cy - 2, 3);
                t.endFill();
                // Shadow
                t.beginFill(0x000000, 0.2);
                t.drawEllipse(cx, cy + 4, 4, 1.5);
                t.endFill();
                mapDetailContainer.addChild(t);
            }

            // FARMLAND: crops if growing
            if (cell.type === 2 && cell.crop_growth > 0) {
                const growth = Math.max(0, Math.min(100, cell.crop_growth)) / 100;
                const crop = new PIXI.Graphics();

                if (growth < 0.2) {
                    // Seedling: tiny green dot
                    crop.beginFill(0x9ccc65);
                    crop.drawCircle(cx, cy, 1.5);
                    crop.endFill();
                } else if (growth < 0.6) {
                    // Young: 2-3 green blades
                    const h = 2 + growth * 4;
                    crop.lineStyle(0);
                    crop.beginFill(0x7cb342);
                    crop.drawRect(cx - 2, cy - h / 2, 1, h);
                    crop.drawRect(cx + 1, cy - h / 2, 1, h);
                    crop.endFill();
                } else if (growth < 0.95) {
                    // Mature: tall green
                    crop.beginFill(0x689f38);
                    crop.drawRect(cx - 3, cy - 3, 6, 6);
                    crop.endFill();
                    crop.beginFill(0x7cb342);
                    crop.drawRect(cx - 2, cy - 5, 4, 3);
                    crop.endFill();
                } else {
                    // Ready: golden-yellow (harvestable)
                    crop.beginFill(0xf9a825);
                    crop.drawRect(cx - 3, cy - 3, 6, 6);
                    crop.endFill();
                    crop.beginFill(0xfbc02d);
                    crop.drawRect(cx - 4, cy - 5, 8, 3);
                    crop.endFill();
                    crop.beginFill(0xffe082, 0.5);
                    crop.drawCircle(cx, cy - 4, 2.5);
                    crop.endFill();
                }
                mapDetailContainer.addChild(crop);
            }
        }
    }

    // Animated water overlays
    waterTiles.forEach(wt => {
        const wave = new PIXI.Graphics();
        const gx = wt.x * CELL_SIZE;
        const gy = wt.y * CELL_SIZE;
        wave.beginFill(0xffffff, 0.1);
        wave.drawRoundedRect(gx + 1, gy + 4, CELL_SIZE - 2, 3, 1);
        wave.endFill();
        wave.beginFill(0xffffff, 0.08);
        wave.drawRoundedRect(gx + 3, gy + 10, CELL_SIZE - 6, 2, 1);
        wave.endFill();
        wt.gfx = wave;
        wt.offset = Math.random() * Math.PI * 2;
        mapDetailContainer.addChild(wave);
    });

    console.log("🌲 Map details (trees/crops/waves) rendered.");
}

// ============================================================
// WATER WAVE ANIMATION LOOP
// ============================================================
app.ticker.add((delta) => {
    animTime += 0.05 * delta;
    waterTiles.forEach(wt => {
        if (!wt.gfx) return;
        const amt = Math.sin(animTime + wt.offset) * 0.8;
        wt.gfx.x = amt;
        wt.gfx.alpha = 0.6 + Math.sin(animTime * 1.3 + wt.offset) * 0.4;
    });
});

// ============================================================
// AGENT RENDERING — FULL SPRITE (shadow + body + head + state + name + rings)
// ============================================================
const SKIN_TONES = [0xffdbac, 0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524];
const HAIR_COLORS = [0x3e2723, 0x1b1b1b, 0x6d4c41, 0xffb74d, 0x4e342e, 0x5d4037];

const STATE_ICONS = {
    'sleeping': '😴',
    'eating': '🍕',
    'walking': '🚶',
    'idle': '',
    'farming': '🌾',
    'pregnant': '🤰',
    'dead': '💀',
};

function drawAgent(agentData) {
    agentsCache.set(agentData.id, agentData);
    let sprite = agentSprites.get(agentData.id);

    // ===== CREATE NEW SPRITE IF NEEDED =====
    if (!sprite) {
        sprite = new PIXI.Container();
        sprite.interactive = true;
        sprite.buttonMode = true;

        // Shadow (fixed, not affected by hop)
        const shadow = new PIXI.Graphics();
        shadow.beginFill(0x000000, 0.3);
        shadow.drawEllipse(0, 8, 5.5, 2.2);
        shadow.endFill();
        sprite.addChild(shadow);
        sprite.shadow = shadow;

        // Bounce container for hop animation
        const bounce = new PIXI.Container();
        sprite.addChild(bounce);
        sprite.bounce = bounce;

        // Body (clothes — gender color)
        const body = new PIXI.Graphics();
        bounce.addChild(body);
        sprite.body = body;

        // Arms (simple lines behind body)
        const arms = new PIXI.Graphics();
        bounce.addChild(arms);
        sprite.arms = arms;

        // Head
        const head = new PIXI.Graphics();
        bounce.addChild(head);
        sprite.head = head;

        // Hair
        const hair = new PIXI.Graphics();
        bounce.addChild(hair);
        sprite.hair = hair;

        // Eyes
        const eyes = new PIXI.Graphics();
        bounce.addChild(eyes);
        sprite.eyes = eyes;

        // State icon (emoji above head)
        const stateIcon = new PIXI.Text('', { fontSize: 11 });
        stateIcon.anchor.set(0.5, 1);
        stateIcon.y = -17;
        bounce.addChild(stateIcon);
        sprite.stateIcon = stateIcon;

        // Name text (below, not affected by bounce)
        const nameText = new PIXI.Text('', {
            fontSize: 9,
            fontWeight: 'bold',
            fill: 0xffffff,
            stroke: 0x000000,
            strokeThickness: 2,
        });
        nameText.anchor.set(0.5, 0);
        nameText.y = 10;
        sprite.addChild(nameText);
        sprite.nameText = nameText;

        // ===== RINGS (hover + selection + pregnancy) =====
        // Hover ring (cyan)
        const hoverRing = new PIXI.Graphics();
        hoverRing.lineStyle(1.5, 0x00e5ff, 0.9);
        hoverRing.drawCircle(0, 0, 12);
        hoverRing.visible = false;
        sprite.addChildAt(hoverRing, 0);
        sprite.hoverRing = hoverRing;

        // Selection ring (green)
        const selRing = new PIXI.Graphics();
        selRing.lineStyle(2.2, 0x00ff7a, 1);
        selRing.drawCircle(0, 0, 13.5);
        selRing.visible = false;
        sprite.addChildAt(selRing, 0);
        sprite.selRing = selRing;

        // Pregnancy halo (gold)
        const pregRing = new PIXI.Graphics();
        pregRing.lineStyle(2, 0xffd54f, 0.9);
        pregRing.drawCircle(0, 0, 12);
        pregRing.visible = false;
        sprite.addChildAt(pregRing, 0);
        sprite.pregRing = pregRing;

        // ===== EVENTS =====
        sprite.on('pointerover', () => {
            hoveredAgentId = agentData.id;
            sprite.hoverRing.visible = true;
            sprite.scale.set(1.12);
            console.log(`🖱️ Hover: Agent #${agentData.id} "${agentData.name}"`);
        });

        sprite.on('pointerout', () => {
            if (hoveredAgentId === agentData.id) hoveredAgentId = null;
            sprite.hoverRing.visible = false;
            sprite.scale.set(1.0);
        });

        sprite.on('pointerdown', (e) => {
            e.stopPropagation();
            selectAgent(agentData.id);
        });

        agentsContainer.addChild(sprite);
        agentSprites.set(agentData.id, sprite);

        console.log(`👤 Agent #${agentData.id} "${agentData.name}" sprite created.`);
    }

    // ===== UPDATE VISUALS FROM agentData =====
    // Name
    sprite.nameText.text = agentData.name || '???';

    // Gender colors
    const isMale = agentData.gender === 'male';
    const clothColor = isMale ? 0x2196f3 : 0xec407a;
    const clothShadow = isMale ? 0x1565c0 : 0xad1457;

    // Body
    sprite.body.clear();
    sprite.body.beginFill(clothShadow);
    sprite.body.drawEllipse(0, 3, 5, 6.5);  // shadow half
    sprite.body.endFill();
    sprite.body.beginFill(clothColor);
    sprite.body.drawEllipse(0, 1, 5, 6.5);  // main body
    sprite.body.endFill();

    // Arms (swing slightly if walking)
    sprite.arms.clear();
    sprite.arms.lineStyle(1.2, SKIN_TONES[agentData.id % SKIN_TONES.length]);
    sprite.arms.moveTo(-4.5, 0);
    sprite.arms.lineTo(-5.5, 3);
    sprite.arms.moveTo(4.5, 0);
    sprite.arms.lineTo(5.5, 3);

    // Head + skin
    const skin = SKIN_TONES[(agentData.id * 3) % SKIN_TONES.length];
    sprite.head.clear();
    sprite.head.beginFill(skin);
    sprite.head.drawCircle(0, -5, 3.8);
    sprite.head.endFill();
    // Slight cheek color
    sprite.head.beginFill(0xffab91, 0.25);
    sprite.head.drawCircle(-2, -4, 0.8);
    sprite.head.drawCircle(2, -4, 0.8);
    sprite.head.endFill();

    // Hair
    const hairCol = HAIR_COLORS[agentData.id % HAIR_COLORS.length];
    sprite.hair.clear();
    sprite.hair.beginFill(hairCol);
    if (isMale) {
        // Short male hair
        sprite.hair.drawCircle(0, -7.2, 3.5);
        sprite.hair.endFill();
        sprite.hair.beginFill(hairCol);
        sprite.hair.drawRect(-3.5, -9, 7, 2.5);
        sprite.hair.endFill();
    } else {
        // Longer female hair
        sprite.hair.drawCircle(0, -7, 4);
        sprite.hair.endFill();
        sprite.hair.beginFill(hairCol);
        sprite.hair.drawRect(-4.2, -9.5, 8.4, 3.5);
        sprite.hair.drawRect(-4.5, -7, 2.5, 6);
        sprite.hair.drawRect(2, -7, 2.5, 6);
        sprite.hair.endFill();
    }

    // Eyes (closed if sleeping)
    sprite.eyes.clear();
    if (agentData.state === 'sleeping' || agentData.state === 'dead') {
        sprite.eyes.lineStyle(1, 0x000000);
        sprite.eyes.moveTo(-2.2, -5.2);
        sprite.eyes.lineTo(-0.8, -5.2);
        sprite.eyes.moveTo(0.8, -5.2);
        sprite.eyes.lineTo(2.2, -5.2);
    } else {
        sprite.eyes.beginFill(0x000000);
        sprite.eyes.drawCircle(-1.5, -5.2, 0.65);
        sprite.eyes.drawCircle(1.5, -5.2, 0.65);
        sprite.eyes.endFill();
        // Eye sparkles
        sprite.eyes.beginFill(0xffffff, 0.8);
        sprite.eyes.drawCircle(-1.2, -5.4, 0.22);
        sprite.eyes.drawCircle(1.8, -5.4, 0.22);
        sprite.eyes.endFill();
    }

    // State icon
    if (agentData.state === 'pregnant' || (agentData.pregnant_ticks && agentData.pregnant_ticks > 0)) {
        sprite.stateIcon.text = '🤰';
    } else if (agentData.state === 'dead') {
        sprite.stateIcon.text = '💀';
    } else {
        sprite.stateIcon.text = STATE_ICONS[agentData.state] || '';
    }

    // Pregnancy ring visibility
    const isPregnant = (agentData.pregnant_ticks && agentData.pregnant_ticks > 0) || agentData.state === 'pregnant';
    sprite.pregRing.visible = !!isPregnant;

    // Selection ring visibility
    sprite.selRing.visible = (selectedAgentId === agentData.id);

    // Dead: gray tint + reduce alpha
    if (agentData.state === 'dead') {
        sprite.alpha = 0.5;
        sprite.tint = 0xaaaaaa;
    } else {
        sprite.alpha = 1.0;
        sprite.tint = 0xffffff;
    }

    // ===== TARGET POSITION FOR LERP =====
    if (agentData.x !== undefined && agentData.y !== undefined) {
        const tX = (agentData.x + 0.5) * CELL_SIZE;
        const tY = (agentData.y + 0.5) * CELL_SIZE;
        sprite.targetX = tX;
        sprite.targetY = tY;

        // CRITICAL FIX: Immediately snap position if brand new (prevents clustering on left)
        if (sprite._initialized !== true) {
            sprite.x = tX;
            sprite.y = tY;
            sprite._initialized = true;
            console.log(`📍 Agent #${agentData.id} initial snap to (${agentData.x},${agentData.y})`);
        }
    }
}

// ============================================================
// MAIN TICKER: LERP + HOP ANIMATION (properly decoupled)
// ============================================================
app.ticker.add((delta) => {
    agentSprites.forEach((sprite, id) => {
        const hasTarget = sprite.targetX !== undefined && sprite.targetY !== undefined;
        if (!hasTarget) return;

        // Slower natural movement (lerpFactor = 0.02 is smooth, not jumpy)
        const lerpFactor = 0.022 * delta;

        const prevX = sprite.x;
        const prevY = sprite.y;
        sprite.x += (sprite.targetX - sprite.x) * lerpFactor;
        sprite.y += (sprite.targetY - sprite.y) * lerpFactor;

        // Movement detection for hop
        const dx = Math.abs(sprite.x - sprite.targetX);
        const dy = Math.abs(sprite.y - sprite.targetY);
        const movedDist = Math.hypot(sprite.x - prevX, sprite.y - prevY);
        const isMoving = (dx > 0.2 || dy > 0.2) && movedDist > 0.01;

        if (isMoving) {
            sprite._hopPhase = (sprite._hopPhase || 0) + 0.28 * delta;
            const hopH = Math.abs(Math.sin(sprite._hopPhase)) * 2.8;
            sprite.bounce.y = -hopH;
            // Slight shadow shrink during hop
            const squish = 1 - (hopH / 12);
            sprite.shadow.scale.set(squish, squish);
            sprite.shadow.alpha = 0.3 * squish;
        } else {
            sprite._hopPhase = 0;
            sprite.bounce.y += (0 - sprite.bounce.y) * 0.25 * delta;
            sprite.shadow.scale.x += (1 - sprite.shadow.scale.x) * 0.25 * delta;
            sprite.shadow.scale.y += (1 - sprite.shadow.scale.y) * 0.25 * delta;
            sprite.shadow.alpha += (0.3 - sprite.shadow.alpha) * 0.25 * delta;
        }
    });
});

// ============================================================
// SELECTION
// ============================================================
function selectAgent(id) {
    const prevSelected = selectedAgentId;
    selectedAgentId = id;

    // Update old sprite ring
    if (prevSelected !== null && agentSprites.has(prevSelected)) {
        agentSprites.get(prevSelected).selRing.visible = false;
    }
    // Update new sprite ring
    if (selectedAgentId !== null && agentSprites.has(selectedAgentId)) {
        agentSprites.get(selectedAgentId).selRing.visible = true;
    }

    const agent = agentsCache.get(id);
    if (agent) {
        console.log(`✅ Selected Agent #${id}:`, agent.name, agent.state, `(${agent.x},${agent.y})`);
        showAgentDetails(agent);
    }
}

// Click empty area → deselect
app.stage.eventMode = 'static';
app.stage.hitArea = app.screen;
app.stage.on('pointerdown', (e) => {
    if (e.target === app.stage) {
        if (selectedAgentId !== null) {
            console.log("👆 Deselected agent (clicked empty area).");
            if (agentSprites.has(selectedAgentId)) {
                agentSprites.get(selectedAgentId).selRing.visible = false;
            }
            selectedAgentId = null;
        }
    }
});

// ============================================================
// ZOOM CONTROLS (buttons + mouse wheel + center)
// ============================================================
function applyZoom(newZoom) {
    newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
    currentZoom = newZoom;
    worldContainer.scale.set(currentZoom);
    // Keep centered
    worldContainer.pivot.set(MAP_WIDTH / 2, MAP_HEIGHT / 2);
    worldContainer.x = (app.screen.width) / 2;
    worldContainer.y = (app.screen.height) / 2;
    document.getElementById('zoom-level').textContent = Math.round(currentZoom * 100) + '%';
}

function zoomIn() {
    console.log(`🔍 Zoom IN (${Math.round(currentZoom*100)}% → ${Math.round((currentZoom+ZOOM_STEP)*100)}%)`);
    applyZoom(currentZoom + ZOOM_STEP);
}

function zoomOut() {
    console.log(`🔍 Zoom OUT (${Math.round(currentZoom*100)}% → ${Math.round((currentZoom-ZOOM_STEP)*100)}%)`);
    applyZoom(currentZoom - ZOOM_STEP);
}

function zoomCenter() {
    console.log(`🎯 Center View. Reset zoom to 100%.`);
    applyZoom(1.0);
}

document.getElementById('zoom-in-btn').addEventListener('click', zoomIn);
document.getElementById('zoom-out-btn').addEventListener('click', zoomOut);
document.getElementById('zoom-center-btn').addEventListener('click', zoomCenter);

// Mouse wheel
document.getElementById('game-container').addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.deltaY < 0) zoomIn();
    else zoomOut();
}, { passive: false });

// Initial centering
applyZoom(1.0);

// ============================================================
// BACKEND COMMUNICATION
// ============================================================
function setConnectionStatus(status, text) {
    const dot = document.getElementById('status-dot');
    const txt = document.getElementById('status-text');
    dot.className = 'status-dot status-' + status;
    txt.textContent = text;
}

async function fetchInitialWorldData() {
    console.log("📡 Fetching initial world data from", BACKEND_URL + "/api/world/init");
    setConnectionStatus('connecting', 'Loading world...');
    try {
        const response = await fetch(`${BACKEND_URL}/api/world/init`);
        if (!response.ok) throw new Error("HTTP " + response.status);
        const data = await response.json();
        console.log(`✅ Init received: tick=${data.tick}, agents=${data.agents?.length || 0}`);

        worldData = data;
        const grid = normalizeGrid(data.grid || data.map);
        console.log(`🧩 Grid format: ${Array.isArray(grid[0]) ? '2D' : 'UNKNOWN'} — ${grid.length} rows`);

        drawMapBase(grid);
        drawMapDetails(grid);

        data.agents.forEach(a => agentsCache.set(a.id, a));
        data.agents.forEach(a => drawAgent(a));

        currentTick = data.tick || 0;
        updateDashboard();
        setConnectionStatus('connected', 'Live');
    } catch (error) {
        console.error("❌ Error fetching initial world data:", error);
        setConnectionStatus('disconnected', 'Failed to load');
    }
}

function setupSSE() {
    if (eventSource) {
        eventSource.close();
        eventSource = null;
    }
    const sseUrl = `${BACKEND_URL}/api/world/stream`;
    console.log("🔗 Opening SSE stream:", sseUrl);
    eventSource = new EventSource(sseUrl);

    eventSource.onopen = () => {
        console.log("✅ SSE Connection OPEN.");
        setConnectionStatus('connected', 'Live');
    };

    eventSource.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);

            if (data.tick !== undefined) {
                currentTick = data.tick;
            }

            if (data.agents_delta) {
                data.agents_delta.forEach(agentDelta => {
                    const cached = agentsCache.get(agentDelta.id);
                    const merged = cached ? Object.assign({}, cached, agentDelta) : agentDelta;
                    if (cached) Object.assign(cached, agentDelta);
                    drawAgent(merged);
                });
            }

            if (data.new_events && Array.isArray(data.new_events)) {
                data.new_events.forEach(ev => addEventToLog(ev));
            }

            if (data.grid_delta && worldData) {
                const grid = normalizeGrid(worldData.grid || worldData.map);
                let changed = false;
                data.grid_delta.forEach(cd => {
                    if (grid[cd.y] && grid[cd.y][cd.x]) {
                        Object.assign(grid[cd.y][cd.x], cd);
                        changed = true;
                    }
                });
                if (changed) drawMapDetails(grid);
            }

            updateDashboard();
        } catch (e) {
            console.error("SSE parse error:", e, event.data);
        }
    };

    eventSource.onerror = (error) => {
        console.warn("⚠️ SSE EventSource error — will retry automatically.", error);
        setConnectionStatus('disconnected', 'Reconnecting...');
    };
}

// ============================================================
// CONTROL PANEL (with console logs)
// ============================================================
async function sendControlCommand(action, value = null) {
    console.log(`🎮 Control: action="${action}"`, value !== null ? `, value=${value}` : '');
    try {
        const payload = { action };
        if (value !== null) payload.value = value;
        const response = await fetch(`${BACKEND_URL}/api/world/control`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            console.error("❌ Control command failed:", response.statusText);
        } else {
            console.log("✅ Control command sent successfully.");
        }

        if (action === 'reset') {
            console.log("🔄 Reset action received: refreshing entire state.");
            agentsContainer.removeChildren();
            agentSprites.clear();
            agentsCache.clear();
            selectedAgentId = null;
            eventLog.length = 0;
            document.getElementById('event-log').innerHTML = '';
            setTimeout(() => {
                fetchInitialWorldData();
                setupSSE();
            }, 300);
        }
    } catch (error) {
        console.error("❌ Error sending control command:", error);
    }
}

// Playback buttons
document.getElementById('pause-btn').addEventListener('click', () => {
    console.log("⏸️ Button: Pause pressed.");
    sendControlCommand('pause');
});
document.getElementById('resume-btn').addEventListener('click', () => {
    console.log("▶️ Button: Resume pressed.");
    sendControlCommand('resume');
});
document.getElementById('reset-btn').addEventListener('click', () => {
    console.log("🔄 Button: Reset pressed.");
    sendControlCommand('reset');
});

// Speed buttons + active state
document.querySelectorAll('.speed-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const speedVal = parseFloat(btn.dataset.speed);
        const speedLabel = btn.textContent.trim();
        console.log(`⚡ Button: Speed pressed → ${speedLabel} (value=${speedVal})`);

        document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        currentSpeedValue = speedVal;
        sendControlCommand('set_speed', speedVal);
    });
});

// Clear event log
document.getElementById('clear-log-btn').addEventListener('click', () => {
    console.log("🗑️ Button: Clear Event Log pressed.");
    eventLog.length = 0;
    document.getElementById('event-log').innerHTML = '';
});

// ============================================================
// DASHBOARD UPDATE (6 cards)
// ============================================================
function updateDashboard() {
    const allAgents = Array.from(agentsCache.values());

    // Card 1: Tick
    document.getElementById('current-tick').textContent = currentTick;

    // Card 2: Agents (total / male / female)
    const total = allAgents.length;
    const males = allAgents.filter(a => a.gender === 'male').length;
    const females = total - males;
    document.getElementById('agent-count').textContent = total;
    document.getElementById('male-count').textContent = males;
    document.getElementById('female-count').textContent = females;

    // Card 3: Alive / Dead
    const dead = allAgents.filter(a => a.state === 'dead').length;
    const alive = total - dead;
    document.getElementById('alive-count').textContent = alive;
    document.getElementById('dead-count').textContent = dead;

    // Card 4: States (aggregate count)
    const stateCounts = {};
    allAgents.forEach(a => {
        const s = a.state || 'idle';
        stateCounts[s] = (stateCounts[s] || 0) + 1;
    });
    const stateLabel = Object.entries(stateCounts)
        .filter(([s, c]) => c > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([s, c]) => `${s}:${c}`)
        .join(' · ');
    document.getElementById('states-list').textContent = stateLabel || '-';

    // Card 5: Resources (sum inventory)
    let wheat = 0, wood = 0, stone = 0;
    allAgents.forEach(a => {
        const inv = a.inventory || {};
        wheat += (inv.wheat || 0);
        wood += (inv.wood || 0);
        stone += (inv.stone || 0);
    });
    document.getElementById('wheat-total').textContent = wheat;
    document.getElementById('wood-total').textContent = wood;
    document.getElementById('stone-total').textContent = stone;

    // Card 6: Pregnant
    const preg = allAgents.filter(a => (a.pregnant_ticks && a.pregnant_ticks > 0) || a.state === 'pregnant').length;
    document.getElementById('pregnant-count').textContent = preg;
}

// ============================================================
// EVENT LOG (colored)
// ============================================================
function addEventToLog(ev) {
    eventLog.unshift(ev);
    if (eventLog.length > MAX_EVENT_LOG) eventLog.pop();

    const type = (ev.event_type || ev.type || 'default').toLowerCase();
    const text = ev.text || ev.message || ev.description || JSON.stringify(ev.payload_json || ev.payload || '');
    const tick = ev.tick ?? currentTick;
    const agentName = ev.agent_name || (ev.agent_id != null ? agentsCache.get(ev.agent_id)?.name : null) || '';

    const VALID_TYPES = { spawn:1, eat:1, sleep:1, walk:1, move:1, plant:1, harvest:1, birth:1, death:1, pregnant:1 };
    const li = document.createElement('li');
    li.className = VALID_TYPES[type] ? 'event-' + type : 'event-default';

    li.innerHTML = `<span class="event-tick">[T${tick}]</span>${agentName ? `<strong>${agentName}</strong>: ` : ''}${text}`;

    const logEl = document.getElementById('event-log');
    logEl.insertBefore(li, logEl.firstChild);

    while (logEl.children.length > MAX_EVENT_LOG) {
        logEl.removeChild(logEl.lastChild);
    }
}

// ============================================================
// AGENT DETAILS POPUP
// ============================================================
const agentDetailsPopup = document.getElementById('agent-details-popup');
const closeButton = agentDetailsPopup.querySelector('.close-button');

function showAgentDetails(a) {
    const isMale = a.gender === 'male';
    const avatar = document.getElementById('detail-avatar');
    avatar.className = 'avatar-circle' + (isMale ? '' : ' female');
    avatar.style.background = isMale ? 'linear-gradient(135deg, #3b82f6, #1e40af)' : 'linear-gradient(135deg, #ec4899, #9d174d)';
    avatar.textContent = (a.name || '?').charAt(0).toUpperCase();

    document.getElementById('detail-name').textContent = a.name || 'Unknown';

    const gBadge = document.getElementById('detail-gender-badge');
    gBadge.textContent = (a.gender === 'male') ? '♂ Male' : '♀ Female';
    gBadge.className = 'gender-badge ' + (isMale ? 'male' : 'female');

    document.getElementById('detail-age').textContent = a.age ?? 'N/A';

    const sBadge = document.getElementById('detail-state-badge');
    const state = (a.state || 'idle').toLowerCase();
    sBadge.textContent = state;
    sBadge.className = 'state-badge ' + state;

    // Stat bars + numeric percentages
    const setStat = (barId, numId, value, max) => {
        const pct = Math.max(0, Math.min(100, (value / max) * 100));
        document.getElementById(barId).style.width = pct + '%';
        document.getElementById(numId).textContent = Math.round(pct) + '%';
    };
    setStat('detail-hp', 'detail-hp-num', a.hp ?? 0, 100);
    setStat('detail-hunger', 'detail-hunger-num', a.hunger ?? 0, 100);
    setStat('detail-energy', 'detail-energy-num', a.energy ?? 0, 100);
    // Mood is range -100..100, normalize to 0..100
    const moodNorm = ((a.mood ?? 0) + 100) / 2;
    setStat('detail-mood', 'detail-mood-num', moodNorm, 100);

    // Traits (range 0-1)
    const traits = a.traits || {};
    document.getElementById('trait-courage').style.width = Math.round((traits.courage ?? 0.5) * 100) + '%';
    document.getElementById('trait-intelligence').style.width = Math.round((traits.intelligence ?? 0.5) * 100) + '%';
    document.getElementById('trait-fertility').style.width = Math.round((traits.fertility ?? 0.5) * 100) + '%';
    document.getElementById('trait-aggression').style.width = Math.round((traits.aggression ?? 0.5) * 100) + '%';

    // Inventory + money
    const inv = a.inventory || {};
    document.getElementById('detail-wheat').textContent = inv.wheat ?? 0;
    document.getElementById('detail-wood').textContent = inv.wood ?? 0;
    document.getElementById('detail-stone').textContent = inv.stone ?? 0;
    document.getElementById('detail-money').textContent = a.money ?? 0;

    // Relationships
    const rels = a.relationships || {};
    const relEntries = Object.entries(rels);
    if (relEntries.length === 0) {
        document.getElementById('detail-relationships').textContent = 'No relationships yet.';
    } else {
        document.getElementById('detail-relationships').innerHTML = relEntries
            .map(([id, score]) => {
                const n = agentsCache.get(Number(id))?.name || `Agent ${id}`;
                const scoreNum = typeof score === 'object' ? (score.trust ?? 0) : (score || 0);
                const color = scoreNum > 50 ? '#10b981' : scoreNum < -50 ? '#ef4444' : '#94a3b8';
                return `<span style="color:${color}; font-weight:600;">${n}</span>: ${scoreNum > 0 ? '+' : ''}${Math.round(scoreNum)}`;
            }).join(' · ');
    }

    agentDetailsPopup.style.display = 'block';
}

closeButton.addEventListener('click', () => {
    console.log("❌ Agent details popup closed.");
    agentDetailsPopup.style.display = 'none';
});
window.addEventListener('click', (event) => {
    if (event.target === agentDetailsPopup) {
        console.log("❌ Agent details popup closed (outside click).");
        agentDetailsPopup.style.display = 'none';
    }
});

// ============================================================
// INIT
// ============================================================
console.log("🚀 Microverse Frontend setup complete. Starting init+SSE.");
fetchInitialWorldData();
setupSSE();
console.log("🎉 Done — waiting for world updates...");
