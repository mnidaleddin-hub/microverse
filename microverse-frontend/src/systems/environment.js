/**
 * environment.js — Seasons, weather, day/night, disasters, agent effects.
 * Exports: initEnvironment, updateEnvironment
 */

const SEASON_LEN = 2000;
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const MAX_EVENTS = 80;
const GRID = 50;

let _env = {
  seasonIndex: 0,
  seasonTick: 0,
  weatherTimer: 0,
  nextDisasterTick: 1500,
  timeSpeed: 1 / 1440,
};

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function hashRand(seed, tick, salt) {
  let h = ((seed | 0) ^ ((tick | 0) * 2246822519) ^ ((salt | 0) * 3266489917)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x27d4eb2d);
  return ((h >>> 0) & 0xfffffff) / 0x10000000;
}

function pushEvent(world, type, message) {
  if (!Array.isArray(world.events)) world.events = [];
  world.events.push({ tick: world.tick | 0, type, message });
  if (world.events.length > MAX_EVENTS) {
    world.events.splice(0, world.events.length - MAX_EVENTS);
  }
}

function nightCurve(t) {
  // t in [0,1): 0=midnight, 0.25=dawn, 0.5=noon, 0.75=dusk
  // darkness high at night
  const angle = t * Math.PI * 2;
  const daylight = Math.sin(angle - Math.PI / 2); // -1 night … +1 day using cos-like
  // Prefer: noon (0.5) = bright. Use cosine around noon.
  const noonDist = Math.cos((t - 0.5) * Math.PI * 2);
  // noonDist: 1 at noon, -1 at midnight
  return clamp(0.5 - noonDist * 0.5, 0, 1);
}

function pickWeather(world, season) {
  const tick = world.tick | 0;
  const r = hashRand(world.seed || 1, tick, 70 + _env.seasonIndex);
  const tables = {
    spring: [
      [0.45, 'clear'],
      [0.75, 'rain'],
      [0.88, 'fog'],
      [0.96, 'storm'],
      [1.0, 'clear'],
    ],
    summer: [
      [0.55, 'clear'],
      [0.72, 'rain'],
      [0.82, 'fog'],
      [0.93, 'storm'],
      [1.0, 'clear'],
    ],
    autumn: [
      [0.35, 'clear'],
      [0.65, 'rain'],
      [0.8, 'fog'],
      [0.92, 'storm'],
      [1.0, 'rain'],
    ],
    winter: [
      [0.3, 'clear'],
      [0.55, 'snow'],
      [0.75, 'fog'],
      [0.88, 'storm'],
      [1.0, 'snow'],
    ],
  };
  const table = tables[season] || tables.spring;
  for (const [threshold, weather] of table) {
    if (r <= threshold) return weather;
  }
  return 'clear';
}

function updateSeason(world) {
  _env.seasonTick += Math.max(0.5, world.speed || 1);
  if (_env.seasonTick >= SEASON_LEN) {
    _env.seasonTick -= SEASON_LEN;
    _env.seasonIndex = (_env.seasonIndex + 1) % SEASONS.length;
    world.season = SEASONS[_env.seasonIndex];
    pushEvent(world, 'season_change', `The season turns to ${world.season}.`);
    // Weather reshuffle on season change
    world.weather = pickWeather(world, world.season);
    _env.weatherTimer = 80 + Math.floor(hashRand(world.seed || 1, world.tick | 0, 71) * 160);
  } else {
    world.season = SEASONS[_env.seasonIndex];
  }
}

function updateWeather(world) {
  _env.weatherTimer -= Math.max(0.5, world.speed || 1);
  if (_env.weatherTimer <= 0) {
    const prev = world.weather;
    world.weather = pickWeather(world, world.season || 'spring');
    _env.weatherTimer =
      100 + Math.floor(hashRand(world.seed || 1, world.tick | 0, 72) * 220);
    if (prev !== world.weather) {
      pushEvent(world, 'weather', `Skies shift to ${world.weather}.`);
    }
  }
  if (!world.weather) world.weather = 'clear';
}

function updateDayNight(world) {
  const spd = Math.max(0.25, world.speed || 1);
  let t = typeof world.timeOfDay === 'number' ? world.timeOfDay : 0.3;
  t += _env.timeSpeed * spd;
  if (t >= 1) t -= Math.floor(t);
  if (t < 0) t += 1;
  world.timeOfDay = t;
  world.darkness = nightCurve(t);

  // Label for UI consumers
  if (t < 0.2 || t >= 0.85) world.dayPhase = 'night';
  else if (t < 0.3) world.dayPhase = 'dawn';
  else if (t < 0.7) world.dayPhase = 'day';
  else world.dayPhase = 'dusk';
}

function mutateGridPatch(world, cx, cy, radius, newType) {
  if (!Array.isArray(world.grid) || world.grid.length === 0) return 0;
  let changed = 0;
  const h = world.grid.length;
  const w = world.grid[0]?.length || 0;
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > radius * radius) continue;
      const cur = world.grid[y][x];
      // Don't overwrite deep water/mountain often
      if (cur === 1 || cur === 5) {
        if (hashRand(world.seed || 1, world.tick | 0, x * 50 + y) > 0.3) continue;
      }
      world.grid[y][x] = newType;
      changed++;
    }
  }
  return changed;
}

function runDisasters(world) {
  const tick = world.tick | 0;
  if (tick < _env.nextDisasterTick) return;

  _env.nextDisasterTick =
    tick + 1200 + Math.floor(hashRand(world.seed || 1, tick, 80) * 2000);

  const types = ['earthquake', 'flood', 'wildfire', 'landslide'];
  // Season-weighted
  let weights = [1, 1, 1, 1];
  if (world.season === 'winter') weights = [1.2, 0.4, 0.2, 1.5];
  if (world.season === 'summer') weights = [0.8, 0.6, 2.0, 0.7];
  if (world.season === 'spring') weights = [0.7, 1.8, 0.5, 1.0];
  if (world.season === 'autumn') weights = [1.0, 1.2, 0.8, 1.2];
  if (world.weather === 'storm') weights[1] *= 1.5;

  let total = weights.reduce((a, b) => a + b, 0);
  let pick = hashRand(world.seed || 1, tick, 81) * total;
  let disaster = types[0];
  for (let i = 0; i < types.length; i++) {
    pick -= weights[i];
    if (pick <= 0) {
      disaster = types[i];
      break;
    }
  }

  const cx = Math.floor(hashRand(world.seed || 1, tick, 82) * GRID);
  const cy = Math.floor(hashRand(world.seed || 1, tick, 83) * GRID);
  const radius = 1 + Math.floor(hashRand(world.seed || 1, tick, 84) * 3);

  let tileType = 3; // stone rubble default
  if (disaster === 'flood') tileType = 1;
  else if (disaster === 'wildfire') tileType = 2;
  else if (disaster === 'landslide') tileType = 5;
  else tileType = 3;

  const changed = mutateGridPatch(world, cx, cy, radius, tileType);
  pushEvent(
    world,
    'disaster',
    `${disaster} strikes near (${cx},${cy}) — ${changed} tiles changed.`
  );

  // Harm nearby agents
  for (const a of world.agents || []) {
    if (!a) continue;
    const dx = a.x - cx;
    const dy = a.y - cy;
    if (dx * dx + dy * dy > (radius + 3) * (radius + 3)) continue;
    a.hp = clamp((typeof a.hp === 'number' ? a.hp : 100) - 15, 0, 100);
    if (a.needs) {
      a.needs.happiness = clamp((a.needs.happiness || 50) - 18, 0, 100);
      a.needs.energy = clamp((a.needs.energy || 50) - 10, 0, 100);
    }
    a.thought = `Survived the ${disaster}…`;
    a.state = 'fleeing';
  }

  if (!Array.isArray(world.particles)) world.particles = [];
  world.particles.push({
    type: disaster,
    x: cx,
    y: cy,
    life: 60,
    tick,
  });
  if (world.particles.length > 25) world.particles.shift();
}

function weatherAffectsAgents(world) {
  const weather = world.weather || 'clear';
  const dark = world.darkness || 0;
  const agents = world.agents || [];
  for (let i = 0; i < agents.length; i++) {
    const a = agents[i];
    if (!a || !a.needs || (a.hp != null && a.hp <= 0)) continue;

    if (weather === 'rain') {
      a.needs.energy = clamp(a.needs.energy - 0.04, 0, 100);
      a.needs.happiness = clamp(a.needs.happiness - 0.03, 0, 100);
    } else if (weather === 'snow') {
      a.needs.energy = clamp(a.needs.energy - 0.07, 0, 100);
      a.needs.happiness = clamp(a.needs.happiness - 0.05, 0, 100);
    } else if (weather === 'fog') {
      a.needs.happiness = clamp(a.needs.happiness - 0.02, 0, 100);
    } else if (weather === 'storm') {
      a.needs.energy = clamp(a.needs.energy - 0.1, 0, 100);
      a.needs.happiness = clamp(a.needs.happiness - 0.12, 0, 100);
    } else if (weather === 'clear' && dark < 0.35) {
      a.needs.happiness = clamp(a.needs.happiness + 0.025, 0, 100);
    }

    // Night restfulness if sleeping
    if (dark > 0.6 && (a.state === 'sleeping' || a.state === 'resting')) {
      a.needs.energy = clamp(a.needs.energy + 0.08, 0, 100);
    }
  }
}

function decayParticles(world) {
  if (!Array.isArray(world.particles)) return;
  world.particles = world.particles.filter((p) => {
    if (!p) return false;
    p.life = (p.life || 1) - 1;
    return p.life > 0;
  });
}

export function initEnvironment(world) {
  _env = {
    seasonIndex: 0,
    seasonTick: 0,
    weatherTimer: 120,
    nextDisasterTick: 1800,
    timeSpeed: 1 / 1440,
  };
  if (world) {
    if (world.season && SEASONS.includes(world.season)) {
      _env.seasonIndex = SEASONS.indexOf(world.season);
    } else {
      world.season = 'spring';
    }
    world.weather = world.weather || 'clear';
    if (typeof world.timeOfDay !== 'number') world.timeOfDay = 0.28;
    world.darkness = nightCurve(world.timeOfDay);
    world.dayPhase = 'day';
    if (!Array.isArray(world.particles)) world.particles = [];
  }
  console.log('[Environment] initialized');
}

export function updateEnvironment(world) {
  if (!world || world.paused) return;

  updateSeason(world);
  updateWeather(world);
  updateDayNight(world);
  runDisasters(world);
  if ((world.tick | 0) % 2 === 0) weatherAffectsAgents(world);
  decayParticles(world);

  // Expose progress for UI
  world.seasonProgress = Math.round((_env.seasonTick / SEASON_LEN) * 1000) / 1000;
}
