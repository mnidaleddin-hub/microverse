/**
 * economy.js — Supply/demand pricing, agent trades, market events, GDP.
 * Exports: initEconomy, updateEconomy
 */

const BASE_PRICES = { wheat: 4, wood: 5, stone: 7, food: 6 };
const RESOURCE_KEYS = ['wheat', 'wood', 'stone', 'food'];
const TRADE_DIST = 2.2;
const MAX_EVENTS = 80;

let _state = {
  supply: { wheat: 50, wood: 40, stone: 30, food: 45 },
  demand: { wheat: 40, wood: 35, stone: 25, food: 50 },
  crashCooldown: 0,
  lastTradeTick: 0,
};

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function hashRand(seed, tick, salt) {
  let h = ((seed | 0) ^ ((tick | 0) * 374761393) ^ ((salt | 0) * 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h = (h ^ (h >>> 16)) >>> 0;
  return (h & 0xfffffff) / 0x10000000;
}

function pushEvent(world, type, message) {
  if (!Array.isArray(world.events)) world.events = [];
  world.events.push({ tick: world.tick | 0, type, message });
  if (world.events.length > MAX_EVENTS) {
    world.events.splice(0, world.events.length - MAX_EVENTS);
  }
}

function ensurePrices(world) {
  if (!world.prices) world.prices = { ...BASE_PRICES };
  for (const k of RESOURCE_KEYS) {
    if (typeof world.prices[k] !== 'number') world.prices[k] = BASE_PRICES[k];
  }
  return world.prices;
}

function ensureInventory(agent) {
  if (!agent.inventory || typeof agent.inventory !== 'object') {
    agent.inventory = { wheat: 0, wood: 0, stone: 0, food: 0 };
  }
  for (const k of RESOURCE_KEYS) {
    if (typeof agent.inventory[k] !== 'number') agent.inventory[k] = 0;
  }
  if (typeof agent.money !== 'number') agent.money = 10 + (agent.id | 0) % 20;
  return agent.inventory;
}

function recountSupplyDemand(world) {
  const supply = { wheat: 8, wood: 8, stone: 8, food: 8 };
  const demand = { wheat: 10, wood: 10, stone: 10, food: 10 };

  const resources = world.resources || [];
  for (let i = 0; i < resources.length; i++) {
    const r = resources[i];
    if (!r || !RESOURCE_KEYS.includes(r.type)) continue;
    supply[r.type] += Math.max(0, r.amount || 0);
  }

  const agents = world.agents || [];
  for (let i = 0; i < agents.length; i++) {
    const a = agents[i];
    if (!a || (a.hp != null && a.hp <= 0)) continue;
    const inv = ensureInventory(a);
    const needs = a.needs || {};
    for (const k of RESOURCE_KEYS) supply[k] += inv[k] * 0.5;

    if ((needs.hunger || 0) > 50) {
      demand.food += 2;
      demand.wheat += 1.2;
    }
    if ((a.role || '').toLowerCase() === 'builder') demand.stone += 1.5;
    if ((a.role || '').toLowerCase() === 'lumberjack') demand.wood += 0.5;
    else demand.wood += 0.3;
    demand.food += 0.4;
  }

  // Buildings consume / produce pressure
  const buildings = world.buildings || [];
  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    if (!b) continue;
    const t = (b.type || '').toLowerCase();
    if (t === 'farm' || t === 'mill') supply.wheat += 3;
    if (t === 'market' || t === 'shop') demand.food += 2;
    if (t === 'mine') supply.stone += 2;
    if (t === 'sawmill' || t === 'lumberyard') supply.wood += 2;
  }

  _state.supply = supply;
  _state.demand = demand;
  return { supply, demand };
}

function updatePrices(world) {
  const prices = ensurePrices(world);
  const { supply, demand } = recountSupplyDemand(world);
  const season = world.season || 'spring';
  const weather = world.weather || 'clear';

  for (const k of RESOURCE_KEYS) {
    const s = Math.max(1, supply[k]);
    const d = Math.max(1, demand[k]);
    const ratio = d / s;
    let target = BASE_PRICES[k] * (0.55 + ratio * 0.9);

    if (season === 'winter' && (k === 'food' || k === 'wheat' || k === 'wood')) {
      target *= 1.18;
    }
    if (season === 'autumn' && k === 'wheat') target *= 0.92;
    if (weather === 'storm' || weather === 'snow') target *= 1.08;
    if (weather === 'clear' && season === 'summer' && k === 'food') target *= 0.95;

    // Smooth toward target
    prices[k] = clamp(prices[k] + (target - prices[k]) * 0.08, 0.5, 80);
    prices[k] = Math.round(prices[k] * 100) / 100;
  }
}

function agentHasSurplus(inv, key) {
  return (inv[key] || 0) >= 2;
}

function agentWants(agent, key) {
  const inv = agent.inventory;
  const needs = agent.needs || {};
  if ((inv[key] || 0) >= 8) return false;
  if (key === 'food' || key === 'wheat') return (needs.hunger || 0) > 35 || (inv[key] || 0) < 2;
  if (key === 'wood') return (inv.wood || 0) < 3;
  if (key === 'stone') return (inv.stone || 0) < 2;
  return (inv[key] || 0) < 2;
}

function tryTrade(world, a, b) {
  const invA = ensureInventory(a);
  const invB = ensureInventory(b);
  const prices = ensurePrices(world);
  const seed = world.seed || 1;
  const tick = world.tick | 0;

  // Pick a resource A can sell and B wants (or vice versa)
  const order = RESOURCE_KEYS.slice().sort(
    (x, y) => hashRand(seed, tick, a.id + x.charCodeAt(0)) - hashRand(seed, tick, a.id + y.charCodeAt(0))
  );

  for (const key of order) {
    let seller = null;
    let buyer = null;
    if (agentHasSurplus(invA, key) && agentWants(b, key) && (b.money || 0) >= prices[key] * 0.5) {
      seller = a;
      buyer = b;
    } else if (agentHasSurplus(invB, key) && agentWants(a, key) && (a.money || 0) >= prices[key] * 0.5) {
      seller = b;
      buyer = a;
    }
    if (!seller) continue;

    const unitPrice = prices[key] * (0.9 + hashRand(seed, tick, seller.id + buyer.id) * 0.25);
    const qty = 1;
    const cost = unitPrice * qty;
    if ((buyer.money || 0) < cost) continue;
    if ((seller.inventory[key] || 0) < qty) continue;

    seller.inventory[key] -= qty;
    buyer.inventory[key] = (buyer.inventory[key] || 0) + qty;
    seller.money = (seller.money || 0) + cost;
    buyer.money = (buyer.money || 0) - cost;

    if (!Array.isArray(world.tradeRoutes)) world.tradeRoutes = [];
    world.tradeRoutes.push({
      tick,
      from: seller.id,
      to: buyer.id,
      good: key,
      price: Math.round(cost * 100) / 100,
    });
    if (world.tradeRoutes.length > 40) {
      world.tradeRoutes.splice(0, world.tradeRoutes.length - 40);
    }

    _state.lastTradeTick = tick;
    if (!world.metrics) world.metrics = {};
    world.metrics.tradeVolume = (world.metrics.tradeVolume || 0) + cost;

    seller.thought = `Sold ${key} for ${cost.toFixed(1)}.`;
    buyer.thought = `Bought ${key} for ${cost.toFixed(1)}.`;
    return cost;
  }
  return 0;
}

function runNearbyTrades(world) {
  const agents = world.agents || [];
  let volume = 0;
  const n = agents.length;
  // Limit pairwise checks
  const maxPairs = Math.min(80, (n * (n - 1)) / 2);
  let checked = 0;
  for (let i = 0; i < n && checked < maxPairs; i++) {
    const a = agents[i];
    if (!a || (a.hp != null && a.hp <= 0)) continue;
    ensureInventory(a);
    for (let j = i + 1; j < n && checked < maxPairs; j++) {
      const b = agents[j];
      if (!b || (b.hp != null && b.hp <= 0)) continue;
      checked++;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      if (dx * dx + dy * dy > TRADE_DIST * TRADE_DIST) continue;
      volume += tryTrade(world, a, b);
    }
  }
  return volume;
}

function wealthDrift(world) {
  const agents = world.agents || [];
  if (agents.length < 2) return;
  let total = 0;
  let alive = 0;
  for (const a of agents) {
    if (!a || (a.hp != null && a.hp <= 0)) continue;
    ensureInventory(a);
    total += a.money || 0;
    alive++;
  }
  if (alive === 0) return;
  const mean = total / alive;
  // Rich get slightly richer, poor lose a bit — inequality drift
  for (const a of agents) {
    if (!a || (a.hp != null && a.hp <= 0)) continue;
    const m = a.money || 0;
    if (m > mean * 1.4) a.money = m + 0.015;
    else if (m < mean * 0.6) a.money = Math.max(0, m - 0.008);
  }
}

function maybeMarketEvent(world) {
  if (_state.crashCooldown > 0) {
    _state.crashCooldown -= 1;
    return;
  }
  const seed = world.seed || 1;
  const tick = world.tick | 0;
  const roll = hashRand(seed, tick, 9001);
  if (roll > 0.997) {
    // Boom
    const prices = ensurePrices(world);
    for (const k of RESOURCE_KEYS) prices[k] = clamp(prices[k] * 1.35, 0.5, 80);
    pushEvent(world, 'market_boom', 'Markets surge — traders cheer as prices climb!');
    _state.crashCooldown = 400;
  } else if (roll < 0.003) {
    // Crash
    const prices = ensurePrices(world);
    for (const k of RESOURCE_KEYS) prices[k] = clamp(prices[k] * 0.55, 0.5, 80);
    pushEvent(world, 'market_crash', 'Market crash! Panic selling floods the square.');
    _state.crashCooldown = 500;
    const agents = world.agents || [];
    for (const a of agents) {
      if (!a) continue;
      a.money = Math.max(0, (a.money || 0) * 0.85);
      if (a.needs) a.needs.happiness = clamp((a.needs.happiness || 50) - 8, 0, 100);
    }
  }
}

function computeGdp(world) {
  const prices = ensurePrices(world);
  let stock = 0;
  for (const r of world.resources || []) {
    if (!r || !RESOURCE_KEYS.includes(r.type)) continue;
    stock += (r.amount || 0) * (prices[r.type] || 1);
  }
  let cash = 0;
  let goods = 0;
  for (const a of world.agents || []) {
    if (!a || (a.hp != null && a.hp <= 0)) continue;
    cash += a.money || 0;
    const inv = ensureInventory(a);
    for (const k of RESOURCE_KEYS) goods += (inv[k] || 0) * (prices[k] || 1);
  }
  const trade = world.metrics?.tradeVolume || 0;
  return Math.round(cash + goods + stock * 0.3 + trade * 0.05);
}

function seedAgentInventories(world) {
  for (const a of world.agents || []) {
    if (!a) continue;
    const inv = ensureInventory(a);
    const role = (a.role || '').toLowerCase();
    if (role === 'farmer') inv.wheat = Math.max(inv.wheat, 3);
    if (role === 'lumberjack') inv.wood = Math.max(inv.wood, 3);
    if (role === 'miner') inv.stone = Math.max(inv.stone, 2);
    if (role === 'merchant') {
      inv.food = Math.max(inv.food, 2);
      a.money = Math.max(a.money || 0, 25);
    }
  }
}

export function initEconomy(world) {
  _state = {
    supply: { wheat: 50, wood: 40, stone: 30, food: 45 },
    demand: { wheat: 40, wood: 35, stone: 25, food: 50 },
    crashCooldown: 200,
    lastTradeTick: 0,
  };
  if (world) {
    ensurePrices(world);
    if (!world.metrics) {
      world.metrics = { population: 0, gdp: 0, happiness: 50, tradeVolume: 0 };
    }
    world.metrics.tradeVolume = world.metrics.tradeVolume || 0;
    if (!Array.isArray(world.tradeRoutes)) world.tradeRoutes = [];
    seedAgentInventories(world);
    updatePrices(world);
    world.metrics.gdp = computeGdp(world);
  }
  console.log('[Economy] initialized');
}

export function updateEconomy(world) {
  if (!world || world.paused) return;

  ensurePrices(world);
  if (!world.metrics) {
    world.metrics = { population: 0, gdp: 0, happiness: 50, tradeVolume: 0 };
  }

  const tick = world.tick | 0;

  if (tick % 5 === 0) updatePrices(world);

  // Passive production from workers / farms
  if (tick % 20 === 0) {
    for (const a of world.agents || []) {
      if (!a || (a.hp != null && a.hp <= 0)) continue;
      if (a.state !== 'working') continue;
      const inv = ensureInventory(a);
      const role = (a.role || '').toLowerCase();
      if (role === 'farmer') inv.wheat += 0.4;
      else if (role === 'lumberjack') inv.wood += 0.35;
      else if (role === 'miner') inv.stone += 0.3;
      else if (role === 'fisher' || role === 'hunter') inv.food += 0.35;
      else inv.food += 0.1;
    }
  }

  const vol = runNearbyTrades(world);
  if (tick % 15 === 0) wealthDrift(world);
  maybeMarketEvent(world);

  // Soft decay of cumulative trade volume toward recent activity
  world.metrics.tradeVolume = Math.max(
    0,
    (world.metrics.tradeVolume || 0) * 0.998 + vol
  );
  world.metrics.gdp = computeGdp(world);
}
