/**
 * visual.js — Core HTML5 Canvas 2D rendering engine for Microverse.
 * Exports: initVisual, updateVisual, getEngine
 */

const GRID_W = 50;
const GRID_H = 50;
const TILE_SIZE = 32;
const WORLD_W = GRID_W * TILE_SIZE;
const WORLD_H = GRID_H * TILE_SIZE;
const MINIMAP_SIZE = 200;
const MINIMAP_TILE = 4;
const MAX_PARTICLES = 800;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3.0;

const TILE_DEFS = {
  0: { base: '#2d5016', light: '#3d6b1f', name: 'grass' },
  1: { base: '#4a90e2', light: '#6bb3ff', name: 'water' },
  2: { base: '#f5a623', light: '#c68642', name: 'dirt' },
  3: { base: '#7f8c8d', light: '#95a5a6', name: 'stone' },
  4: { base: '#e8d5a3', light: '#f5e6c8', name: 'beach' },
  5: { base: '#5d4e37', light: '#3e2723', name: 'mountain' },
  6: { base: '#1a3d0f', light: '#245218', name: 'forest' },
  7: { base: '#3a7bd5', light: '#5a9bf0', name: 'river' },
};

const ROLE_COLORS = {
  farmer: '#e9c46a',
  miner: '#7f8c8d',
  lumberjack: '#2a9d8f',
  merchant: '#f4a261',
  scholar: '#9b5de5',
  painter: '#f15bb5',
  poet: '#00bbf9',
  priest: '#ffd166',
  builder: '#e76f51',
  hunter: '#606c38',
  fisher: '#4a90e2',
  inventor: '#8338ec',
};

const DEFAULT_NAMES = [
  'Ava', 'Noah', 'Mia', 'Liam', 'Zoe', 'Eli', 'Nina', 'Omar', 'Iris', 'Kai',
  'Luna', 'Rex', 'Sara', 'Theo', 'Vera', 'Wes', 'Yara', 'Ben', 'Cora', 'Drew',
];

const DEFAULT_ROLES = [
  'farmer', 'miner', 'lumberjack', 'merchant', 'scholar', 'painter', 'poet',
  'priest', 'builder', 'hunter', 'fisher', 'inventor',
];

const DEFAULT_EMOJIS = ['🧑', '👤', '🧔', '👩', '👷', '🧙', '🧑‍🌾', '🧑‍🔬', '⚒️', '🎣', '🏹', '📚'];

const BUILDING_EMOJI = {
  house: '🏠',
  hut: '🛖',
  inn: '🏨',
  farm: '🌾',
  mill: '🏭',
  market: '🏪',
  shop: '🏬',
  mine: '⛏️',
  sawmill: '🪵',
  forge: '🔥',
  temple: '⛪',
  tower: '🗼',
};

/** @type {object|null} */
let _world = null;

/** @type {object} */
let _engine = {
  initialized: false,
  canvas: null,
  ctx: null,
  minimapCanvas: null,
  minimapCtx: null,
  container: null,
  resizeObserver: null,
  camera: { x: WORLD_W / 2, y: WORLD_H / 2, zoom: 1, targetX: WORLD_W / 2, targetY: WORLD_H / 2 },
  input: {
    dragging: false,
    dragStart: { x: 0, y: 0 },
    camStart: { x: 0, y: 0 },
    keys: Object.create(null),
  },
  animTime: 0,
  frameCount: 0,
  fps: 60,
  fpsAccum: 0,
  fpsTimer: 0,
  particles: [],
  particlePool: [],
  poolIndex: 0,
  useEmoji: true,
  boundHandlers: null,
};

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function hashRand(seed, x, y) {
  let h = ((seed | 0) ^ (x * 374761393) ^ (y * 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 13), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smoothNoise(seed, x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const n00 = hashRand(seed, x0, y0);
  const n10 = hashRand(seed, x0 + 1, y0);
  const n01 = hashRand(seed, x0, y0 + 1);
  const n11 = hashRand(seed, x0 + 1, y0 + 1);
  const nx0 = lerp(n00, n10, sx);
  const nx1 = lerp(n01, n11, sx);
  return lerp(nx0, nx1, sy);
}

function fbm(seed, x, y, octaves = 4) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += smoothNoise(seed, x * freq, y * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

function generateWorldGrid(seed) {
  const grid = [];
  for (let y = 0; y < GRID_H; y++) {
    const row = new Uint8Array(GRID_W);
    for (let x = 0; x < GRID_W; x++) {
      const nx = x / GRID_W;
      const ny = y / GRID_H;
      const elevation = fbm(seed, nx * 3.2, ny * 3.2, 5);
      const moisture = fbm(seed + 17, nx * 4.1 + 12, ny * 4.1 + 7, 4);
      const ridge = fbm(seed + 31, nx * 6, ny * 6, 3);
      const distEdge = Math.min(nx, ny, 1 - nx, 1 - ny) * 8;

      let tile = 0;
      if (distEdge < 0.35) {
        tile = elevation < 0.42 ? 1 : 4;
      } else if (elevation > 0.78 || ridge > 0.82) {
        tile = 5;
      } else if (elevation < 0.28) {
        tile = moisture > 0.55 ? 7 : 1;
      } else if (moisture > 0.68 && elevation < 0.62) {
        tile = 6;
      } else if (moisture > 0.52 && elevation < 0.55) {
        tile = 2;
      } else if (elevation > 0.62) {
        tile = 3;
      } else if (moisture < 0.35 && elevation < 0.45) {
        tile = 4;
      } else {
        tile = 0;
      }
      row[x] = tile;
    }
    grid.push(row);
  }

  // Carve rivers downhill-ish from high moisture bands
  for (let r = 0; r < 6; r++) {
    let cx = Math.floor(hashRand(seed, r, 1) * (GRID_W - 4)) + 2;
    let cy = Math.floor(hashRand(seed, r, 2) * (GRID_H - 4)) + 2;
    for (let step = 0; step < 80; step++) {
      if (cx < 1 || cy < 1 || cx >= GRID_W - 1 || cy >= GRID_H - 1) break;
      if (grid[cy][cx] !== 1 && grid[cy][cx] !== 5) grid[cy][cx] = 7;
      let bestX = cx;
      let bestY = cy;
      let best = 999;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= GRID_W || ny >= GRID_H) continue;
          const e = fbm(seed, (nx / GRID_W) * 3.2, (ny / GRID_H) * 3.2, 3);
          if (e < best) {
            best = e;
            bestX = nx;
            bestY = ny;
          }
        }
      }
      cx = bestX;
      cy = bestY;
    }
  }

  // Beaches adjacent to water
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      if (grid[y][x] !== 0 && grid[y][x] !== 2) continue;
      let nearWater = false;
      for (let dy = -1; dy <= 1 && !nearWater; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= GRID_W || ny >= GRID_H) continue;
          const t = grid[ny][nx];
          if (t === 1 || t === 7) nearWater = true;
        }
      }
      if (nearWater) grid[y][x] = 4;
    }
  }

  // Forest clusters on grass
  for (let y = 2; y < GRID_H - 2; y++) {
    for (let x = 2; x < GRID_W - 2; x++) {
      if (grid[y][x] !== 0) continue;
      const n = fbm(seed + 99, x * 0.15, y * 0.15, 2);
      if (n > 0.62) grid[y][x] = 6;
    }
  }

  return grid;
}

function ensureGrid(world) {
  if (Array.isArray(world.grid) && world.grid.length === GRID_H) return;
  const seed = world.seed || 42;
  world.grid = generateWorldGrid(seed);
}

function spawnDefaultAgents(world) {
  if (!Array.isArray(world.agents)) world.agents = [];
  if (world.agents.length >= 10) return;

  const seed = world.seed || 42;
  const count = 12;
  for (let i = world.agents.length; i < count; i++) {
    const role = DEFAULT_ROLES[i % DEFAULT_ROLES.length];
    const name = DEFAULT_NAMES[i % DEFAULT_NAMES.length];
    let x = 0;
    let y = 0;
    for (let attempt = 0; attempt < 40; attempt++) {
      x = 5 + hashRand(seed, i, attempt * 3) * (GRID_W - 10);
      y = 5 + hashRand(seed, i, attempt * 3 + 1) * (GRID_H - 10);
      const tile = world.grid[Math.floor(y)]?.[Math.floor(x)] ?? 0;
      if (tile !== 1 && tile !== 5 && tile !== 7) break;
    }
    world.agents.push({
      id: `agent_${i}`,
      name,
      role,
      x,
      y,
      vx: 0,
      vy: 0,
      gender: hashRand(seed, i, 5) > 0.5 ? 'f' : 'm',
      color: ROLE_COLORS[role] || '#e76f51',
      emoji: DEFAULT_EMOJIS[i % DEFAULT_EMOJIS.length],
      state: 'idle',
      hp: 100,
      needs: { hunger: 40, thirst: 40, energy: 75, happiness: 65, social: 50 },
    });
  }
}

function spawnDefaultBuildings(world) {
  if (!Array.isArray(world.buildings)) world.buildings = [];
  if (world.buildings.length > 0) return;

  const seed = world.seed || 42;
  const types = ['house', 'farm', 'market', 'forge', 'mill', 'hut', 'temple'];
  for (let i = 0; i < types.length; i++) {
    const bx = 10 + Math.floor(hashRand(seed, 200 + i, 0) * (GRID_W - 20));
    const by = 10 + Math.floor(hashRand(seed, 200 + i, 1) * (GRID_H - 20));
    world.buildings.push({
      id: `bld_${i}`,
      type: types[i],
      x: bx,
      y: by,
      w: 1.2,
      h: 1.2,
    });
  }
}

function initParticlePool() {
  _engine.particlePool = new Array(MAX_PARTICLES);
  for (let i = 0; i < MAX_PARTICLES; i++) {
    _engine.particlePool[i] = {
      active: false,
      type: 'dust',
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      life: 0,
      maxLife: 60,
      size: 2,
      color: '#fff',
    };
  }
  _engine.particles = [];
  _engine.poolIndex = 0;
}

function acquireParticle() {
  const pool = _engine.particlePool;
  for (let i = 0; i < 32; i++) {
    const idx = (_engine.poolIndex + i) % pool.length;
    const p = pool[idx];
    if (!p.active) {
      _engine.poolIndex = (idx + 1) % pool.length;
      p.active = true;
      return p;
    }
  }
  return null;
}

function spawnParticle(type, x, y, opts = {}) {
  if (_engine.particles.length >= MAX_PARTICLES) return;
  const p = acquireParticle();
  if (!p) return;
  p.type = type;
  p.x = x;
  p.y = y;
  p.vx = opts.vx ?? 0;
  p.vy = opts.vy ?? 0;
  p.life = opts.life ?? 60;
  p.maxLife = p.life;
  p.size = opts.size ?? 2;
  p.color = opts.color ?? '#ffffff';
  p.active = true;
  _engine.particles.push(p);
}

function emitWeatherParticles(world) {
  const weather = world.weather || 'clear';
  const canvas = _engine.canvas;
  if (!canvas) return;

  const viewW = canvas.width / _engine.camera.zoom;
  const viewH = canvas.height / _engine.camera.zoom;
  const left = _engine.camera.x - viewW / 2;
  const top = _engine.camera.y - viewH / 2;

  let count = 0;
  if (weather === 'rain') count = 6;
  else if (weather === 'snow') count = 4;
  else if (weather === 'storm') count = 10;

  for (let i = 0; i < count; i++) {
    const px = left + Math.random() * viewW;
    const py = top - 10 + Math.random() * viewH * 0.2;
    if (weather === 'snow') {
      spawnParticle('snow', px, py, {
        vx: (Math.random() - 0.5) * 0.4,
        vy: 0.6 + Math.random() * 0.8,
        life: 80 + Math.random() * 40,
        size: 1.5 + Math.random() * 2,
        color: 'rgba(255,255,255,0.85)',
      });
    } else {
      spawnParticle('rain', px, py, {
        vx: -0.8 + Math.random() * 0.3,
        vy: 6 + Math.random() * 4,
        life: 40 + Math.random() * 20,
        size: 1 + Math.random(),
        color: weather === 'storm' ? 'rgba(180,200,255,0.7)' : 'rgba(150,190,255,0.6)',
      });
    }
  }
}

function emitForgeParticles(world) {
  const dark = world.darkness || 0;
  for (const b of world.buildings || []) {
    if (!b) continue;
    const t = (b.type || '').toLowerCase();
    if (t !== 'forge' && t !== 'mill') continue;
    if (Math.random() > 0.35) continue;
    const wx = (b.x + 0.5) * TILE_SIZE;
    const wy = (b.y + 0.3) * TILE_SIZE;
    if (t === 'forge') {
      spawnParticle('fire', wx, wy, {
        vx: (Math.random() - 0.5) * 0.5,
        vy: -1.2 - Math.random(),
        life: 25 + Math.random() * 20,
        size: 2 + Math.random() * 3,
        color: `hsl(${20 + Math.random() * 30}, 90%, ${dark > 0.4 ? 65 : 55}%)`,
      });
      if (Math.random() < 0.4) {
        spawnParticle('smoke', wx, wy - 4, {
          vx: (Math.random() - 0.5) * 0.3,
          vy: -0.6 - Math.random() * 0.5,
          life: 50 + Math.random() * 30,
          size: 3 + Math.random() * 4,
          color: 'rgba(80,80,80,0.35)',
        });
      }
    }
  }
}

function emitAgentDust(world, agent, speed) {
  if (speed < 0.08) return;
  const gx = Math.floor(agent.x);
  const gy = Math.floor(agent.y);
  const tile = world.grid?.[gy]?.[gx] ?? 0;
  if (tile !== 2 && tile !== 4 && tile !== 0) return;
  if (Math.random() > 0.25) return;
  const wx = agent.x * TILE_SIZE + TILE_SIZE / 2;
  const wy = agent.y * TILE_SIZE + TILE_SIZE * 0.85;
  spawnParticle('dust', wx, wy, {
    vx: (Math.random() - 0.5) * 0.6,
    vy: -0.3 - Math.random() * 0.4,
    life: 20 + Math.random() * 15,
    size: 1.5 + Math.random() * 2,
    color: tile === 2 ? 'rgba(198,134,66,0.5)' : 'rgba(120,100,70,0.35)',
  });
}

function updateParticles(dt) {
  const list = _engine.particles;
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    p.life -= dt * 60;
    p.x += p.vx * dt * 60;
    p.y += p.vy * dt * 60;
    if (p.type === 'rain') p.vy += 0.15 * dt * 60;
    if (p.type === 'smoke') {
      p.vy -= 0.02 * dt * 60;
      p.size += 0.02 * dt * 60;
    }
    if (p.type === 'sparkle') {
      p.vx *= 0.98;
      p.vy *= 0.98;
    }
    if (p.life <= 0) {
      p.active = false;
      list.splice(i, 1);
    }
  }
}

function screenToWorld(sx, sy) {
  const canvas = _engine.canvas;
  const cam = _engine.camera;
  const wx = cam.x + (sx - canvas.width / 2) / cam.zoom;
  const wy = cam.y + (sy - canvas.height / 2) / cam.zoom;
  return { x: wx, y: wy };
}

function worldToScreen(wx, wy) {
  const canvas = _engine.canvas;
  const cam = _engine.camera;
  return {
    x: (wx - cam.x) * cam.zoom + canvas.width / 2,
    y: (wy - cam.y) * cam.zoom + canvas.height / 2,
  };
}

function clampCamera() {
  const cam = _engine.camera;
  const canvas = _engine.canvas;
  if (!canvas) return;
  const viewW = canvas.width / cam.zoom;
  const viewH = canvas.height / cam.zoom;
  const halfW = Math.min(viewW / 2, WORLD_W / 2);
  const halfH = Math.min(viewH / 2, WORLD_H / 2);
  cam.x = clamp(cam.x, halfW, WORLD_W - halfW);
  cam.y = clamp(cam.y, halfH, WORLD_H - halfH);
}

function updateCameraInput(world, dt) {
  const cam = _engine.camera;
  const keys = _engine.input.keys;
  let panX = 0;
  let panY = 0;
  const panSpeed = 320 / cam.zoom;

  if (keys.ArrowLeft || keys.a || keys.A) panX -= 1;
  if (keys.ArrowRight || keys.d || keys.D) panX += 1;
  if (keys.ArrowUp || keys.w || keys.W) panY -= 1;
  if (keys.ArrowDown || keys.s || keys.S) panY += 1;

  if (panX !== 0 || panY !== 0) {
    const len = Math.hypot(panX, panY) || 1;
    cam.x += (panX / len) * panSpeed * dt;
    cam.y += (panY / len) * panSpeed * dt;
  }

  if (keys['='] || keys['+']) cam.zoom = clamp(cam.zoom * (1 + dt * 1.5), ZOOM_MIN, ZOOM_MAX);
  if (keys['-'] || keys['_']) cam.zoom = clamp(cam.zoom * (1 - dt * 1.5), ZOOM_MIN, ZOOM_MAX);

  if (world.followId != null && world.followId !== '') {
    const agent = (world.agents || []).find((a) => a && a.id === world.followId);
    if (agent) {
      const tx = agent.x * TILE_SIZE + TILE_SIZE / 2;
      const ty = agent.y * TILE_SIZE + TILE_SIZE / 2;
      cam.x = lerp(cam.x, tx, clamp(dt * 6, 0, 1));
      cam.y = lerp(cam.y, ty, clamp(dt * 6, 0, 1));
    }
  }

  clampCamera();
}

function getVisibleTileBounds() {
  const canvas = _engine.canvas;
  const cam = _engine.camera;
  const viewW = canvas.width / cam.zoom;
  const viewH = canvas.height / cam.zoom;
  const left = Math.floor((cam.x - viewW / 2) / TILE_SIZE) - 1;
  const top = Math.floor((cam.y - viewH / 2) / TILE_SIZE) - 1;
  const right = Math.ceil((cam.x + viewW / 2) / TILE_SIZE) + 1;
  const bottom = Math.ceil((cam.y + viewH / 2) / TILE_SIZE) + 1;
  return {
    left: clamp(left, 0, GRID_W - 1),
    top: clamp(top, 0, GRID_H - 1),
    right: clamp(right, 0, GRID_W - 1),
    bottom: clamp(bottom, 0, GRID_H - 1),
  };
}

function drawTile(ctx, type, px, py, animTime) {
  const def = TILE_DEFS[type] || TILE_DEFS[0];
  const grad = ctx.createLinearGradient(px, py, px + TILE_SIZE, py + TILE_SIZE);
  grad.addColorStop(0, def.light);
  grad.addColorStop(1, def.base);
  ctx.fillStyle = grad;
  ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);

  if (type === 1 || type === 7) {
    const shimmer = 0.08 * Math.sin(animTime * 3 + px * 0.05 + py * 0.04);
    ctx.fillStyle = `rgba(255,255,255,${0.12 + shimmer})`;
    ctx.fillRect(px + 2, py + 4 + shimmer * 20, TILE_SIZE - 4, 3);
    ctx.fillRect(px + 6, py + 14 + shimmer * 15, TILE_SIZE - 10, 2);
  }

  if (type === 5) {
    ctx.fillStyle = def.light;
    ctx.beginPath();
    ctx.moveTo(px + TILE_SIZE / 2, py + 4);
    ctx.lineTo(px + TILE_SIZE - 4, py + TILE_SIZE - 4);
    ctx.lineTo(px + 4, py + TILE_SIZE - 4);
    ctx.closePath();
    ctx.fill();
  }

  if (type === 6) {
    ctx.fillStyle = '#0f2808';
    const tx = px + 8 + (px % 7);
    const ty = py + 10;
    ctx.beginPath();
    ctx.moveTo(tx, ty - 6);
    ctx.lineTo(tx + 5, ty + 4);
    ctx.lineTo(tx - 5, ty + 4);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(px + TILE_SIZE - 10, py + TILE_SIZE - 10, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  if (type === 2) {
    ctx.strokeStyle = 'rgba(160,100,40,0.25)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(px + 4 + i * 8, py + 6);
      ctx.lineTo(px + 8 + i * 8, py + TILE_SIZE - 6);
      ctx.stroke();
    }
  }

  ctx.strokeStyle = 'rgba(0,0,0,0.08)';
  ctx.lineWidth = 0.5;
  ctx.strokeRect(px + 0.25, py + 0.25, TILE_SIZE - 0.5, TILE_SIZE - 0.5);
}

function drawTiles(ctx, world, animTime) {
  const grid = world.grid;
  if (!grid) return;
  const { left, top, right, bottom } = getVisibleTileBounds();
  for (let y = top; y <= bottom; y++) {
    const row = grid[y];
    if (!row) continue;
    for (let x = left; x <= right; x++) {
      drawTile(ctx, row[x] ?? 0, x * TILE_SIZE, y * TILE_SIZE, animTime);
    }
  }
}

function drawBuildings(ctx, world) {
  for (const b of world.buildings || []) {
    if (!b) continue;
    const wx = b.x * TILE_SIZE;
    const wy = b.y * TILE_SIZE;
    const bw = (b.w || 1) * TILE_SIZE;
    const bh = (b.h || 1) * TILE_SIZE;
    const type = (b.type || 'house').toLowerCase();
    const emoji = BUILDING_EMOJI[type] || '🏠';

    ctx.fillStyle = 'rgba(60,45,30,0.85)';
    ctx.fillRect(wx + 2, wy + bh * 0.4, bw - 4, bh * 0.55);
    ctx.fillStyle = type === 'forge' ? '#5c4033' : '#8d6e63';
    ctx.fillRect(wx, wy, bw, bh * 0.75);
    ctx.fillStyle = '#4e342e';
    ctx.fillRect(wx + bw * 0.15, wy + bh * 0.35, bw * 0.3, bh * 0.4);

    ctx.font = `${Math.floor(TILE_SIZE * 0.55)}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, wx + bw / 2, wy + bh / 2 - 2);
  }
}

function agentScreenRadius(agent) {
  const base = 14 + ((String(agent.id).length % 3) * 2);
  return clamp(base, 16, 32) * 0.5 * (_engine.camera.zoom > 1.2 ? 1 : 0.9);
}

function drawAgentShadow(ctx, sx, sy, r) {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(sx, sy + r * 0.9, r * 0.9, r * 0.35, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawAgent(ctx, agent, world, animTime, selected) {
  const wx = agent.x * TILE_SIZE + TILE_SIZE / 2;
  const wy = agent.y * TILE_SIZE + TILE_SIZE / 2;
  const speed = Math.hypot(agent.vx || 0, agent.vy || 0);
  const bob = speed < 0.05
    ? Math.sin(animTime * 4 + hashRand(1, agent.id?.length || 0, 0) * 10) * 2
    : 0;
  const sy = wy + bob;
  const { x: sx, y: screenY } = worldToScreen(wx, sy);
  const r = agentScreenRadius(agent) * _engine.camera.zoom;

  drawAgentShadow(ctx, sx, screenY, r);

  if (selected) {
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(sx, screenY, r + 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,215,0,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(sx, screenY, r + 9 + Math.sin(animTime * 6) * 2, 0, Math.PI * 2);
    ctx.stroke();
  }

  const roleColor = ROLE_COLORS[(agent.role || '').toLowerCase()] || agent.color || '#e76f51';

  if (_engine.useEmoji && agent.emoji) {
    ctx.font = `${Math.floor(r * 2.2)}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (speed > 0.05) {
      const angle = Math.atan2(agent.vy, agent.vx);
      ctx.save();
      ctx.translate(sx, screenY);
      ctx.rotate(angle * 0.15);
      ctx.fillText(agent.emoji, 0, 0);
      ctx.restore();
    } else {
      ctx.fillText(agent.emoji, sx, screenY);
    }
  } else {
    ctx.fillStyle = roleColor;
    ctx.beginPath();
    ctx.arc(sx, screenY, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.arc(sx - r * 0.25, screenY - r * 0.15, r * 0.18, 0, Math.PI * 2);
    ctx.arc(sx + r * 0.25, screenY - r * 0.15, r * 0.18, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.font = `${clamp(10 * _engine.camera.zoom, 9, 14)}px "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillText(agent.name || agent.id || '?', sx + 1, screenY + r + 3);
  ctx.fillStyle = '#fff';
  ctx.fillText(agent.name || agent.id || '?', sx, screenY + r + 2);
}

function drawAgents(ctx, world, animTime) {
  const selectedId = world.selectedAgentId;
  for (const agent of world.agents || []) {
    if (!agent || (agent.hp != null && agent.hp <= 0)) continue;
    drawAgent(ctx, agent, world, animTime, agent.id === selectedId);
  }
}

function drawParticles(ctx) {
  for (const p of _engine.particles) {
    ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
    if (p.type === 'rain') {
      const { x, y } = worldToScreen(p.x, p.y);
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.size;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + p.vx * 2, y + 6);
      ctx.stroke();
    } else if (p.type === 'snow') {
      const { x, y } = worldToScreen(p.x, p.y);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(x, y, p.size, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const { x, y } = worldToScreen(p.x, p.y);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(x, y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function drawLightingOverlay(ctx, world) {
  const dark = clamp(world.darkness ?? 0, 0, 1);
  if (dark <= 0.01) return;

  ctx.save();
  ctx.fillStyle = `rgba(8, 12, 32, ${dark * 0.72})`;
  ctx.fillRect(0, 0, _engine.canvas.width, _engine.canvas.height);

  if (dark > 0.35) {
    ctx.globalCompositeOperation = 'lighter';
    for (const b of world.buildings || []) {
      if (!b) continue;
      const t = (b.type || '').toLowerCase();
      if (t !== 'forge' && t !== 'house' && t !== 'inn' && t !== 'hut' && t !== 'temple') continue;
      const wx = (b.x + 0.5) * TILE_SIZE;
      const wy = (b.y + 0.5) * TILE_SIZE;
      const { x, y } = worldToScreen(wx, wy);
      const radius = (t === 'forge' ? 90 : 55) * _engine.camera.zoom;
      const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
      const warmth = t === 'forge' ? 'rgba(255,140,40,0.45)' : 'rgba(255,200,120,0.28)';
      g.addColorStop(0, warmth);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const agent of world.agents || []) {
      if (!agent || agent.state !== 'idle') continue;
      if (Math.random() > 0.02) continue;
      spawnParticle('sparkle', agent.x * TILE_SIZE, agent.y * TILE_SIZE, {
        vx: (Math.random() - 0.5) * 0.5,
        vy: -0.5 - Math.random(),
        life: 15,
        size: 1.5,
        color: 'rgba(255,255,200,0.8)',
      });
    }
  }

  ctx.restore();
}

function drawWorldEventParticles(ctx, world) {
  for (const p of world.particles || []) {
    if (!p || (p.life != null && p.life <= 0)) continue;
    const wx = (p.x ?? 0) * TILE_SIZE + TILE_SIZE / 2;
    const wy = (p.y ?? 0) * TILE_SIZE + TILE_SIZE / 2;
    const alpha = clamp((p.life ?? 30) / 60, 0.15, 0.7);
    const { x, y } = worldToScreen(wx, wy);
    const radius = (8 + (p.life ?? 20) * 0.15) * _engine.camera.zoom;
    const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
    g.addColorStop(0, `rgba(255,120,40,${alpha})`);
    g.addColorStop(0.5, `rgba(80,80,80,${alpha * 0.5})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function renderFrame(world) {
  const canvas = _engine.canvas;
  const ctx = _engine.ctx;
  if (!canvas || !ctx) return;

  ctx.save();
  ctx.fillStyle = '#1a2f12';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(_engine.camera.zoom, _engine.camera.zoom);
  ctx.translate(-_engine.camera.x, -_engine.camera.y);

  drawTiles(ctx, world, _engine.animTime);
  drawBuildings(ctx, world);
  drawAgents(ctx, world, _engine.animTime);
  drawParticles(ctx);
  drawWorldEventParticles(ctx, world);

  ctx.restore();
  drawLightingOverlay(ctx, world);
}

function drawMinimap(world) {
  const mm = _engine.minimapCanvas;
  const mctx = _engine.minimapCtx;
  if (!mm || !mctx || !world.grid) return;

  mm.width = MINIMAP_SIZE;
  mm.height = MINIMAP_SIZE;
  mctx.imageSmoothingEnabled = false;

  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const type = world.grid[y]?.[x] ?? 0;
      mctx.fillStyle = TILE_DEFS[type]?.base || '#2d5016';
      mctx.fillRect(x * MINIMAP_TILE, y * MINIMAP_TILE, MINIMAP_TILE, MINIMAP_TILE);
    }
  }

  for (const agent of world.agents || []) {
    if (!agent) continue;
    mctx.fillStyle = agent.id === world.selectedAgentId ? '#ffd700' : '#ff4081';
    const ax = Math.floor(agent.x) * MINIMAP_TILE + MINIMAP_TILE / 2;
    const ay = Math.floor(agent.y) * MINIMAP_TILE + MINIMAP_TILE / 2;
    mctx.beginPath();
    mctx.arc(ax, ay, 2, 0, Math.PI * 2);
    mctx.fill();
  }

  const canvas = _engine.canvas;
  const cam = _engine.camera;
  const viewW = canvas ? canvas.width / cam.zoom : WORLD_W;
  const viewH = canvas ? canvas.height / cam.zoom : WORLD_H;
  const vx = (cam.x - viewW / 2) / TILE_SIZE * MINIMAP_TILE;
  const vy = (cam.y - viewH / 2) / TILE_SIZE * MINIMAP_TILE;
  const vw = (viewW / TILE_SIZE) * MINIMAP_TILE;
  const vh = (viewH / TILE_SIZE) * MINIMAP_TILE;

  mctx.strokeStyle = 'rgba(255,255,255,0.9)';
  mctx.lineWidth = 1.5;
  mctx.strokeRect(vx, vy, vw, vh);
  mctx.fillStyle = 'rgba(255,255,255,0.08)';
  mctx.fillRect(vx, vy, vw, vh);
}

function handleMinimapClick(e) {
  const mm = _engine.minimapCanvas;
  if (!mm) return;
  const rect = mm.getBoundingClientRect();
  const mx = (e.clientX - rect.left) * (MINIMAP_SIZE / rect.width);
  const my = (e.clientY - rect.top) * (MINIMAP_SIZE / rect.height);
  const tx = clamp(mx / MINIMAP_TILE, 0, GRID_W - 1);
  const ty = clamp(my / MINIMAP_TILE, 0, GRID_H - 1);
  _engine.camera.x = tx * TILE_SIZE + TILE_SIZE / 2;
  _engine.camera.y = ty * TILE_SIZE + TILE_SIZE / 2;
  clampCamera();
}

function findAgentAtWorld(wx, wy, world) {
  let best = null;
  let bestDist = 18 / _engine.camera.zoom;
  for (const agent of world.agents || []) {
    if (!agent) continue;
    const ax = agent.x * TILE_SIZE + TILE_SIZE / 2;
    const ay = agent.y * TILE_SIZE + TILE_SIZE / 2;
    const d = Math.hypot(wx - ax, wy - ay);
    if (d < bestDist) {
      bestDist = d;
      best = agent;
    }
  }
  return best;
}

function bindInputEvents() {
  const canvas = _engine.canvas;
  const mm = _engine.minimapCanvas;
  if (!canvas || _engine.boundHandlers) return;

  const onMouseDown = (e) => {
    if (e.button !== 0) return;
    _engine.input.dragging = true;
    _engine.input.dragStart = { x: e.clientX, y: e.clientY };
    _engine.input.camStart = { x: _engine.camera.x, y: _engine.camera.y };
    canvas.style.cursor = 'grabbing';
  };

  const onMouseMove = (e) => {
    if (!_engine.input.dragging) return;
    const dx = e.clientX - _engine.input.dragStart.x;
    const dy = e.clientY - _engine.input.dragStart.y;
    _engine.camera.x = _engine.input.camStart.x - dx / _engine.camera.zoom;
    _engine.camera.y = _engine.input.camStart.y - dy / _engine.camera.zoom;
    clampCamera();
  };

  const onMouseUp = (e) => {
    if (_engine.input.dragging) {
      const dx = e.clientX - _engine.input.dragStart.x;
      const dy = e.clientY - _engine.input.dragStart.y;
      if (Math.hypot(dx, dy) < 4 && _world) {
        const rect = canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const { x: wx, y: wy } = screenToWorld(sx, sy);
        const hit = findAgentAtWorld(wx, wy, _world);
        _world.selectedAgentId = hit ? hit.id : null;
      }
    }
    _engine.input.dragging = false;
    canvas.style.cursor = 'grab';
  };

  const onWheel = (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const before = screenToWorld(sx, sy);
    const factor = e.deltaY < 0 ? 1.08 : 0.92;
    _engine.camera.zoom = clamp(_engine.camera.zoom * factor, ZOOM_MIN, ZOOM_MAX);
    const after = screenToWorld(sx, sy);
    _engine.camera.x += before.x - after.x;
    _engine.camera.y += before.y - after.y;
    clampCamera();
  };

  const onKeyDown = (e) => {
    _engine.input.keys[e.key] = true;
  };

  const onKeyUp = (e) => {
    _engine.input.keys[e.key] = false;
  };

  canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  canvas.style.cursor = 'grab';

  if (mm) {
    mm.addEventListener('click', handleMinimapClick);
  }

  _engine.boundHandlers = {
    onMouseDown, onMouseMove, onMouseUp, onWheel, onKeyDown, onKeyUp,
  };
}

function resize() {
  const canvas = _engine.canvas;
  const container = _engine.container;
  if (!canvas || !container) return;

  const rect = container.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width));
  const h = Math.max(1, Math.floor(rect.height));
  const dpr = window.devicePixelRatio || 1;

  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;

  _engine.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  clampCamera();
}

function resolveOptions(options = {}) {
  const container =
    options.container ||
    (typeof document !== 'undefined' ? document.getElementById('game-container') : null);

  let mainCanvas = options.mainCanvas;
  if (!mainCanvas && typeof document !== 'undefined') {
    mainCanvas = document.getElementById('microverse-canvas');
    if (!mainCanvas && container) {
      mainCanvas = document.createElement('canvas');
      mainCanvas.id = 'microverse-canvas';
      mainCanvas.style.display = 'block';
      mainCanvas.style.width = '100%';
      mainCanvas.style.height = '100%';
      mainCanvas.style.position = 'absolute';
      mainCanvas.style.inset = '0';
      mainCanvas.style.zIndex = '5';
      container.appendChild(mainCanvas);
    }
  }

  let minimapCanvas = options.minimapCanvas;
  if (!minimapCanvas && typeof document !== 'undefined') {
    minimapCanvas = document.getElementById('minimap-canvas');
    if (minimapCanvas) {
      minimapCanvas.width = MINIMAP_SIZE;
      minimapCanvas.height = MINIMAP_SIZE;
    }
  }

  return { container, mainCanvas, minimapCanvas };
}

function createFallbackWorld() {
  return {
    seed: 42,
    tick: 0,
    grid: null,
    agents: [],
    buildings: [],
    weather: 'clear',
    darkness: 0.2,
    timeOfDay: 0.35,
    selectedAgentId: null,
    followId: null,
    particles: [],
  };
}

/**
 * Initialize the visual engine.
 * @param {object} [world]
 * @param {{ mainCanvas?: HTMLCanvasElement, minimapCanvas?: HTMLCanvasElement, container?: HTMLElement }} [options]
 */
export function initVisual(world, options = {}) {
  _world = world || createFallbackWorld();
  if (typeof _world.seed !== 'number') _world.seed = 42;

  // Re-init path: keep canvas bindings, refresh world content
  if (_engine.initialized && _engine.canvas && _engine.ctx) {
    ensureGrid(_world);
    spawnDefaultAgents(_world);
    spawnDefaultBuildings(_world);
    initParticlePool();
    _engine.camera.x = WORLD_W / 2;
    _engine.camera.y = WORLD_H / 2;
    _engine.camera.zoom = 1;
    console.log('[Visual] Engine re-bound to new world seed', _world.seed);
    return;
  }

  const resolved = resolveOptions(options);
  _engine.container = resolved.container;
  _engine.canvas = resolved.mainCanvas;
  _engine.minimapCanvas = resolved.minimapCanvas;

  if (!_engine.canvas) {
    console.warn('[Visual] No main canvas — rendering disabled');
    return;
  }

  _engine.ctx = _engine.canvas.getContext('2d', { alpha: false });
  _engine.minimapCtx = _engine.minimapCanvas
    ? _engine.minimapCanvas.getContext('2d')
    : null;

  ensureGrid(_world);
  spawnDefaultAgents(_world);
  spawnDefaultBuildings(_world);
  initParticlePool();
  bindInputEvents();
  resize();

  if (typeof ResizeObserver !== 'undefined' && _engine.container) {
    _engine.resizeObserver = new ResizeObserver(() => resize());
    _engine.resizeObserver.observe(_engine.container);
  } else {
    window.addEventListener('resize', resize);
  }

  _engine.camera.x = WORLD_W / 2;
  _engine.camera.y = WORLD_H / 2;
  _engine.camera.zoom = 1;
  _engine.initialized = true;

  console.log('[Visual] Canvas 2D engine initialized — 50×50 tiles, agents, particles, lighting');
}

/**
 * Update and render one frame. Called from main loop — does not start its own RAF.
 * @param {object} [world]
 * @param {number} [dt=1/60]
 */
export function updateVisual(world, dt = 1 / 60) {
  if (world) _world = world;
  if (!_engine.initialized || !_world || !_engine.ctx) return;

  _engine.animTime += dt;
  _engine.frameCount += 1;
  _engine.fpsAccum += dt;
  _engine.fpsTimer += dt;
  if (_engine.fpsTimer >= 0.5) {
    _engine.fps = Math.round(_engine.frameCount / _engine.fpsTimer);
    _engine.frameCount = 0;
    _engine.fpsTimer = 0;
  }

  updateCameraInput(_world, dt);

  emitWeatherParticles(_world);
  emitForgeParticles(_world);

  for (const agent of _world.agents || []) {
    if (!agent) continue;
    const speed = Math.hypot(agent.vx || 0, agent.vy || 0);
    emitAgentDust(_world, agent, speed);
    if (speed > 0.12 && Math.random() < 0.003) {
      spawnParticle('sparkle', agent.x * TILE_SIZE, agent.y * TILE_SIZE, {
        vx: (Math.random() - 0.5),
        vy: -0.8,
        life: 12,
        size: 1.2,
        color: 'rgba(255,255,180,0.7)',
      });
    }
  }

  updateParticles(dt);
  renderFrame(_world);
  drawMinimap(_world);
}

/**
 * @returns {{ camera: object, screenToWorld: Function, worldToScreen: Function, resize: Function, drawMinimap: Function, getFPS: Function, render: Function }}
 */
export function getEngine() {
  return {
    camera: _engine.camera,
    screenToWorld,
    worldToScreen,
    resize,
    drawMinimap: () => drawMinimap(_world),
    getFPS: () => _engine.fps,
    render: () => {
      if (_world) renderFrame(_world);
    },
  };
}
