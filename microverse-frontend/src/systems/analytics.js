/**
 * analytics.js — Metrics aggregation and capped history for charts.
 * Exports: initAnalytics, updateAnalytics
 */

const HISTORY_CAP = 120;
const SAMPLE_EVERY = 10;

let _analytics = {
  lastSampleTick: -1,
  peakPopulation: 0,
  peakGdp: 0,
};

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function ensureMetrics(world) {
  if (!world.metrics || typeof world.metrics !== 'object') {
    world.metrics = {
      population: 0,
      gdp: 0,
      happiness: 50,
      tradeVolume: 0,
    };
  }
  const m = world.metrics;
  if (typeof m.population !== 'number') m.population = 0;
  if (typeof m.gdp !== 'number') m.gdp = 0;
  if (typeof m.happiness !== 'number') m.happiness = 50;
  if (typeof m.tradeVolume !== 'number') m.tradeVolume = 0;
  return m;
}

function ensureHistory(world) {
  if (!Array.isArray(world.history)) world.history = [];
  return world.history;
}

function aliveAgents(world) {
  const out = [];
  for (const a of world.agents || []) {
    if (!a) continue;
    if (a.hp != null && a.hp <= 0) continue;
    out.push(a);
  }
  return out;
}

function averageHappiness(agents) {
  if (agents.length === 0) return 50;
  let sum = 0;
  for (let i = 0; i < agents.length; i++) {
    sum += agents[i].needs?.happiness ?? 50;
  }
  return sum / agents.length;
}

function estimateGdp(world, agents) {
  // Prefer economy-updated gdp when present; otherwise rough estimate
  if (world.metrics && typeof world.metrics.gdp === 'number' && world.metrics.gdp > 0) {
    return world.metrics.gdp;
  }
  const prices = world.prices || { wheat: 4, wood: 5, stone: 7, food: 6 };
  let total = 0;
  for (const a of agents) {
    total += a.money || 0;
    const inv = a.inventory || {};
    total += (inv.wheat || 0) * (prices.wheat || 4);
    total += (inv.wood || 0) * (prices.wood || 5);
    total += (inv.stone || 0) * (prices.stone || 7);
    total += (inv.food || 0) * (prices.food || 6);
  }
  for (const r of world.resources || []) {
    if (!r) continue;
    const p = prices[r.type];
    if (typeof p === 'number') total += (r.amount || 0) * p * 0.25;
  }
  return Math.round(total);
}

function pushSample(world, metrics) {
  const history = ensureHistory(world);
  const prices = world.prices || {};
  const entry = {
    tick: world.tick | 0,
    population: metrics.population,
    happiness: Math.round(metrics.happiness * 10) / 10,
    gdp: Math.round(metrics.gdp),
    wheatPrice: Math.round((prices.wheat || 0) * 100) / 100,
  };

  // Avoid duplicate tick samples
  const last = history[history.length - 1];
  if (last && last.tick === entry.tick) {
    history[history.length - 1] = entry;
  } else {
    history.push(entry);
  }

  while (history.length > HISTORY_CAP) history.shift();
  _analytics.lastSampleTick = entry.tick;
}

function computeExtendedStats(world, agents, metrics) {
  // Optional extras for UI without breaking contract
  let hungry = 0;
  let rich = 0;
  let poor = 0;
  let moneySum = 0;
  for (const a of agents) {
    moneySum += a.money || 0;
    if ((a.needs?.hunger || 0) > 70) hungry++;
  }
  const meanMoney = agents.length ? moneySum / agents.length : 0;
  for (const a of agents) {
    if ((a.money || 0) > meanMoney * 1.5) rich++;
    if ((a.money || 0) < meanMoney * 0.5) poor++;
  }

  metrics.hungryCount = hungry;
  metrics.richCount = rich;
  metrics.poorCount = poor;
  metrics.avgMoney = Math.round(meanMoney * 100) / 100;
  metrics.buildingCount = (world.buildings || []).length;
  metrics.resourceCount = (world.resources || []).length;
  metrics.factionCount = (world.factions || []).length;
  metrics.techLevel = world.techLevel || 0;
  metrics.cultureScore = world.cultureScore || 0;

  if (metrics.population > _analytics.peakPopulation) {
    _analytics.peakPopulation = metrics.population;
  }
  if (metrics.gdp > _analytics.peakGdp) {
    _analytics.peakGdp = metrics.gdp;
  }
  metrics.peakPopulation = _analytics.peakPopulation;
  metrics.peakGdp = _analytics.peakGdp;
}

function trendFromHistory(world) {
  const history = world.history || [];
  if (history.length < 4) {
    world.trends = { population: 0, happiness: 0, gdp: 0 };
    return;
  }
  const a = history[history.length - 4];
  const b = history[history.length - 1];
  world.trends = {
    population: b.population - a.population,
    happiness: Math.round((b.happiness - a.happiness) * 10) / 10,
    gdp: b.gdp - a.gdp,
  };
}

export function initAnalytics(world) {
  _analytics = {
    lastSampleTick: -1,
    peakPopulation: 0,
    peakGdp: 0,
  };
  if (world) {
    ensureMetrics(world);
    ensureHistory(world);
    // Seed one sample if empty
    if (world.history.length === 0) {
      const agents = aliveAgents(world);
      world.metrics.population = agents.length;
      world.metrics.happiness = averageHappiness(agents);
      world.metrics.gdp = estimateGdp(world, agents);
      pushSample(world, world.metrics);
    } else {
      // Restore peaks from history
      for (const h of world.history) {
        if (h.population > _analytics.peakPopulation) _analytics.peakPopulation = h.population;
        if (h.gdp > _analytics.peakGdp) _analytics.peakGdp = h.gdp;
      }
    }
  }
  console.log('[Analytics] initialized');
}

export function updateAnalytics(world) {
  if (!world) return;

  const metrics = ensureMetrics(world);
  ensureHistory(world);

  const agents = aliveAgents(world);
  metrics.population = agents.length;
  metrics.happiness = Math.round(averageHappiness(agents) * 10) / 10;

  // Keep tradeVolume from economy if set; else decay softly
  if (typeof metrics.tradeVolume !== 'number') metrics.tradeVolume = 0;

  metrics.gdp = estimateGdp(world, agents);
  computeExtendedStats(world, agents, metrics);

  const tick = world.tick | 0;
  const due =
    tick === 0 ||
    _analytics.lastSampleTick < 0 ||
    tick - _analytics.lastSampleTick >= SAMPLE_EVERY;

  if (due && !world.paused) {
    pushSample(world, metrics);
    trendFromHistory(world);
  }

  // Hard cap even if something else pushed
  if (world.history.length > HISTORY_CAP) {
    world.history.splice(0, world.history.length - HISTORY_CAP);
  }

  // Convenience aliases
  metrics.avgHappiness = metrics.happiness;
  metrics.trade = metrics.tradeVolume;
}
