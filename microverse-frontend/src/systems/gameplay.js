/**
 * gameplay.js — Time control, god-mode queue, save/load, auto-save.
 * Exports: initGameplay, updateGameplay, saveWorld, loadWorld
 */

const SAVE_KEY = 'microverse_save';
const SAVE_SLOTS = 5;
const AUTO_SAVE_EVERY = 100;
const GRID = 50;
const MAX_EVENTS = 80;

const NAMES = [
  'Ava', 'Noah', 'Mia', 'Liam', 'Zoe', 'Eli', 'Nina', 'Omar', 'Iris', 'Kai',
  'Luna', 'Rex', 'Sara', 'Theo', 'Vera', 'Wes', 'Yara', 'Ben', 'Cora', 'Drew',
];
const ROLES = [
  'farmer', 'miner', 'lumberjack', 'merchant', 'scholar', 'painter', 'poet',
  'priest', 'builder', 'hunter', 'fisher', 'inventor',
];
const COLORS = ['#e76f51', '#2a9d8f', '#e9c46a', '#264653', '#9b5de5', '#00bbf9', '#f15bb5'];
const EMOJIS = ['🧑', '👤', '🧔', '👩', '👷', '🧙', '🧑‍🌾', '🧑‍🔬'];

let _game = {
  initialized: false,
  lastAutoSlot: 0,
};

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function hashRand(seed, tick, salt) {
  let h = ((seed | 0) ^ ((tick | 0) * 374761393) ^ ((salt | 0) * 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  return ((h >>> 0) & 0xfffffff) / 0x10000000;
}

function pushEvent(world, type, message) {
  if (!Array.isArray(world.events)) world.events = [];
  world.events.push({ tick: world.tick | 0, type, message });
  if (world.events.length > MAX_EVENTS) {
    world.events.splice(0, world.events.length - MAX_EVENTS);
  }
}

function slotKey(slot) {
  const s = clamp(slot | 0, 0, SAVE_SLOTS - 1);
  return s === 0 ? SAVE_KEY : `${SAVE_KEY}_slot${s}`;
}

/**
 * Persist world snapshot to localStorage.
 * @param {object} world
 * @param {number} [slot=0]
 * @returns {boolean}
 */
export function saveWorld(world, slot = 0) {
  if (!world || typeof localStorage === 'undefined') return false;
  try {
    const payload = {
      version: 1,
      savedAt: Date.now(),
      tick: world.tick | 0,
      world: sanitizeForSave(world),
    };
    localStorage.setItem(slotKey(slot), JSON.stringify(payload));
    return true;
  } catch (err) {
    console.warn('[Gameplay] save failed', err);
    return false;
  }
}

/**
 * Load world snapshot from localStorage.
 * @param {number} [slot=0]
 * @returns {object|null}
 */
export function loadWorld(slot = 0) {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(slotKey(slot));
    if (!raw) return null;
    const payload = JSON.parse(raw);
    return payload?.world || null;
  } catch (err) {
    console.warn('[Gameplay] load failed', err);
    return null;
  }
}

function sanitizeForSave(world) {
  // Structured clone via JSON — drop non-serializable helpers
  const clone = JSON.parse(JSON.stringify(world, (key, value) => {
    if (typeof value === 'function') return undefined;
    return value;
  }));
  // Strip runtime-only attachments; re-attached on init
  delete clone.pause;
  delete clone.setSpeed;
  delete clone.save;
  delete clone.load;
  return clone;
}

function attachControls(world) {
  world.pause = function pause(flag) {
    if (typeof flag === 'boolean') world.paused = flag;
    else world.paused = !world.paused;
    return world.paused;
  };
  world.setSpeed = function setSpeed(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return world.speed;
    world.speed = clamp(v, 0, 20);
    return world.speed;
  };
  world.save = function save(slot = 0) {
    return saveWorld(world, slot);
  };
  world.load = function load(slot = 0) {
    const data = loadWorld(slot);
    if (!data) return false;
    applyLoadedWorld(world, data);
    attachControls(world);
    pushEvent(world, 'load', `World loaded from slot ${slot | 0}.`);
    return true;
  };
}

function applyLoadedWorld(target, data) {
  const keys = Object.keys(data);
  for (const k of keys) {
    if (typeof data[k] === 'function') continue;
    target[k] = data[k];
  }
}

function ensureGodQueue(world) {
  if (!Array.isArray(world.godQueue)) world.godQueue = [];
  if (!world.godMode || typeof world.godMode !== 'object') world.godMode = {};
}

function makeAgent(world, cmd) {
  const agents = world.agents || (world.agents = []);
  const seed = world.seed || 1;
  const tick = world.tick | 0;
  const id = cmd.id || `god_${tick}_${agents.length}`;
  const name =
    cmd.name ||
    NAMES[Math.floor(hashRand(seed, tick, agents.length) * NAMES.length) % NAMES.length];
  const role =
    cmd.role ||
    ROLES[Math.floor(hashRand(seed, tick, agents.length + 3) * ROLES.length) % ROLES.length];
  const x = clamp(cmd.x ?? hashRand(seed, tick, 90) * GRID, 1, GRID - 2);
  const y = clamp(cmd.y ?? hashRand(seed, tick, 91) * GRID, 1, GRID - 2);
  const gender = cmd.gender || (hashRand(seed, tick, 92) > 0.5 ? 'f' : 'm');

  return {
    id,
    name,
    role,
    x,
    y,
    vx: 0,
    vy: 0,
    gender,
    color: cmd.color || COLORS[agents.length % COLORS.length],
    emoji: cmd.emoji || EMOJIS[agents.length % EMOJIS.length],
    needs: {
      hunger: 30,
      thirst: 30,
      energy: 80,
      happiness: 65,
      social: 50,
    },
    personality: {
      openness: 0.3 + hashRand(seed, tick, 93) * 0.5,
      conscientiousness: 0.3 + hashRand(seed, tick, 94) * 0.5,
      extraversion: 0.3 + hashRand(seed, tick, 95) * 0.5,
      agreeableness: 0.3 + hashRand(seed, tick, 96) * 0.5,
      neuroticism: 0.2 + hashRand(seed, tick, 97) * 0.5,
    },
    money: 12 + hashRand(seed, tick, 98) * 20,
    reputation: 0,
    friends: [],
    enemies: [],
    memory: [],
    inventory: { wheat: 1, wood: 0, stone: 0, food: 1 },
    goal: 'find a place in the world',
    thought: 'I awaken by divine will.',
    state: 'idle',
    hp: 100,
  };
}

function mutateDisaster(world, cmd) {
  if (!Array.isArray(world.grid) || !world.grid.length) return;
  const seed = world.seed || 1;
  const tick = world.tick | 0;
  const cx = clamp(Math.floor(cmd.x ?? hashRand(seed, tick, 100) * GRID), 0, GRID - 1);
  const cy = clamp(Math.floor(cmd.y ?? hashRand(seed, tick, 101) * GRID), 0, GRID - 1);
  const radius = clamp(cmd.radius ?? 2, 1, 6);
  const tile = typeof cmd.tile === 'number' ? cmd.tile : 3;
  const h = world.grid.length;
  const w = world.grid[0].length;
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > radius * radius) continue;
      world.grid[y][x] = tile;
    }
  }
  for (const a of world.agents || []) {
    if (!a) continue;
    const dx = a.x - cx;
    const dy = a.y - cy;
    if (dx * dx + dy * dy <= (radius + 2) * (radius + 2)) {
      a.hp = clamp((a.hp ?? 100) - 20, 0, 100);
      if (a.needs) a.needs.happiness = clamp(a.needs.happiness - 15, 0, 100);
      a.thought = 'A god-sent disaster!';
    }
  }
}

function findAgent(world, id) {
  return (world.agents || []).find((a) => a && a.id === id) || null;
}

function processBless(world, cmd) {
  const a = findAgent(world, cmd.agentId || cmd.id || world.selectedAgentId);
  if (!a) return false;
  a.hp = clamp((a.hp ?? 100) + 25, 0, 100);
  if (a.needs) {
    a.needs.energy = clamp((a.needs.energy || 50) + 30, 0, 100);
    a.needs.happiness = clamp((a.needs.happiness || 50) + 20, 0, 100);
    a.needs.hunger = clamp((a.needs.hunger || 50) - 20, 0, 100);
    a.needs.thirst = clamp((a.needs.thirst || 50) - 20, 0, 100);
  }
  a.money = (a.money || 0) + (cmd.amount || 10);
  a.reputation = clamp((a.reputation || 0) + 5, -100, 100);
  a.thought = 'I feel blessed.';
  a.state = 'blessed';
  return true;
}

function processCurse(world, cmd) {
  const a = findAgent(world, cmd.agentId || cmd.id || world.selectedAgentId);
  if (!a) return false;
  a.hp = clamp((a.hp ?? 100) - 20, 0, 100);
  if (a.needs) {
    a.needs.energy = clamp((a.needs.energy || 50) - 25, 0, 100);
    a.needs.happiness = clamp((a.needs.happiness || 50) - 25, 0, 100);
    a.needs.hunger = clamp((a.needs.hunger || 50) + 15, 0, 100);
  }
  a.reputation = clamp((a.reputation || 0) - 8, -100, 100);
  a.thought = 'A shadow hangs over me…';
  a.state = 'cursed';
  return true;
}

function processGodQueue(world) {
  ensureGodQueue(world);
  if (world.godQueue.length === 0) return;

  const queue = world.godQueue.splice(0, world.godQueue.length);
  for (const cmd of queue) {
    if (!cmd || !cmd.type) continue;
    const type = String(cmd.type).toLowerCase();

    if (type === 'spawn_agent') {
      const agent = makeAgent(world, cmd);
      world.agents.push(agent);
      pushEvent(world, 'god_spawn', `God spawned ${agent.name} the ${agent.role}.`);
      world.godMode.lastAction = 'spawn_agent';
    } else if (type === 'disaster') {
      mutateDisaster(world, cmd);
      pushEvent(world, 'god_disaster', cmd.message || 'Divine disaster unleashed.');
      world.godMode.lastAction = 'disaster';
    } else if (type === 'bless') {
      if (processBless(world, cmd)) {
        pushEvent(world, 'god_bless', `Blessing granted to ${cmd.agentId || 'chosen one'}.`);
        world.godMode.lastAction = 'bless';
      }
    } else if (type === 'curse') {
      if (processCurse(world, cmd)) {
        pushEvent(world, 'god_curse', `Curse laid upon ${cmd.agentId || 'chosen one'}.`);
        world.godMode.lastAction = 'curse';
      }
    } else if (type === 'set_weather') {
      world.weather = cmd.weather || 'clear';
      pushEvent(world, 'god_weather', `Weather forced to ${world.weather}.`);
    } else if (type === 'set_season') {
      world.season = cmd.season || world.season;
      pushEvent(world, 'god_season', `Season forced to ${world.season}.`);
    }
  }
}

export function initGameplay(world) {
  _game = { initialized: true, lastAutoSlot: 0 };
  if (world) {
    if (typeof world.speed !== 'number') world.speed = 1;
    if (typeof world.paused !== 'boolean') world.paused = false;
    ensureGodQueue(world);
    attachControls(world);
  }
  console.log('[Gameplay] initialized');
}

export function updateGameplay(world) {
  if (!world) return;

  // Re-attach if lost after load/merge
  if (typeof world.pause !== 'function' || typeof world.setSpeed !== 'function') {
    attachControls(world);
  }
  ensureGodQueue(world);

  // God commands always process (even while paused — god overrides)
  processGodQueue(world);

  if (world.paused) return;

  const tick = world.tick | 0;
  if (tick > 0 && tick % AUTO_SAVE_EVERY === 0) {
    const slot = _game.lastAutoSlot % SAVE_SLOTS;
    if (saveWorld(world, slot)) {
      world.godMode = world.godMode || {};
      world.godMode.lastAutoSave = { tick, slot, at: Date.now() };
      _game.lastAutoSlot = slot + 1;
    }
  }
}
