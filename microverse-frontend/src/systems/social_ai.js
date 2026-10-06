/**
 * social_ai.js — Needs, decisions, personality, memory, relationships.
 * Exports: initSocialAI, updateSocialAI
 */

const GRID = 50;
const MEMORY_CAP = 20;
const NEAR_DIST = 2.5;
const WORK_ROLES = new Set([
  'farmer', 'miner', 'lumberjack', 'merchant', 'builder', 'fisher', 'hunter',
]);
const SOCIAL_ROLES = new Set(['poet', 'painter', 'priest', 'bard', 'leader']);

let _rngState = 1;

function seededRand(world) {
  const seed = (world?.seed ?? 1) | 0;
  const tick = (world?.tick ?? 0) | 0;
  _rngState = (_rngState * 1664525 + 1013904223 + seed + tick) >>> 0;
  return (_rngState & 0xffff) / 0x10000;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function ensureNeeds(agent) {
  if (!agent.needs) {
    agent.needs = { hunger: 50, thirst: 50, energy: 70, happiness: 60, social: 50 };
  }
  const n = agent.needs;
  n.hunger = clamp(n.hunger ?? 50, 0, 100);
  n.thirst = clamp(n.thirst ?? 50, 0, 100);
  n.energy = clamp(n.energy ?? 70, 0, 100);
  n.happiness = clamp(n.happiness ?? 60, 0, 100);
  n.social = clamp(n.social ?? 50, 0, 100);
  return n;
}

function ensurePersonality(agent, world) {
  if (agent.personality && typeof agent.personality === 'object') return agent.personality;
  const r = () => 0.2 + seededRand(world) * 0.6;
  agent.personality = {
    openness: r(),
    conscientiousness: r(),
    extraversion: r(),
    agreeableness: r(),
    neuroticism: r(),
  };
  return agent.personality;
}

function ensureLists(agent) {
  if (!Array.isArray(agent.friends)) agent.friends = [];
  if (!Array.isArray(agent.enemies)) agent.enemies = [];
  if (!Array.isArray(agent.memory)) agent.memory = [];
}

function pushMemory(agent, entry) {
  agent.memory.push(entry);
  if (agent.memory.length > MEMORY_CAP) {
    agent.memory.splice(0, agent.memory.length - MEMORY_CAP);
  }
}

function tileAt(world, x, y) {
  const gx = Math.floor(x);
  const gy = Math.floor(y);
  if (!world.grid || gy < 0 || gx < 0 || gy >= world.grid.length) return 0;
  const row = world.grid[gy];
  if (!row || gx >= row.length) return 0;
  return row[gx];
}

function findNearestTile(world, agent, types) {
  const typeSet = new Set(types);
  let best = null;
  let bestD = Infinity;
  const ax = Math.floor(agent.x);
  const ay = Math.floor(agent.y);
  const radius = 12;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = ax + dx;
      const y = ay + dy;
      if (x < 0 || y < 0 || x >= GRID || y >= GRID) continue;
      const t = tileAt(world, x, y);
      if (!typeSet.has(t)) continue;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = { x: x + 0.5, y: y + 0.5, type: t };
      }
    }
  }
  return best;
}

function findNearestAgent(world, agent, pred) {
  let best = null;
  let bestD = Infinity;
  const agents = world.agents || [];
  for (let i = 0; i < agents.length; i++) {
    const other = agents[i];
    if (!other || other.id === agent.id || other.hp <= 0) continue;
    if (pred && !pred(other)) continue;
    const d = dist(agent, other);
    if (d < bestD) {
      bestD = d;
      best = other;
    }
  }
  return best ? { agent: best, dist: bestD } : null;
}

function steerToward(agent, tx, ty, speed) {
  const dx = tx - agent.x;
  const dy = ty - agent.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  agent.vx = (dx / len) * speed;
  agent.vy = (dy / len) * speed;
}

function applyVelocity(agent, world) {
  agent.x = clamp(agent.x + (agent.vx || 0), 0.2, GRID - 0.2);
  agent.y = clamp(agent.y + (agent.vy || 0), 0.2, GRID - 0.2);
  const t = tileAt(world, agent.x, agent.y);
  if (t === 1 || t === 7) {
    agent.x -= (agent.vx || 0);
    agent.y -= (agent.vy || 0);
    agent.vx *= -0.4;
    agent.vy *= -0.4;
  }
}

function decayNeeds(agent, world) {
  const n = ensureNeeds(agent);
  const p = ensurePersonality(agent, world);
  const spd = Math.max(0.25, world.speed || 1);
  const dark = world.darkness || 0;
  const weather = world.weather || 'clear';

  n.hunger = clamp(n.hunger + 0.08 * spd, 0, 100);
  n.thirst = clamp(n.thirst + 0.1 * spd, 0, 100);
  n.energy = clamp(n.energy - (0.04 + dark * 0.03) * spd, 0, 100);
  n.social = clamp(n.social - 0.03 * spd * (1 + p.extraversion), 0, 100);

  if (weather === 'storm') n.happiness = clamp(n.happiness - 0.05 * spd, 0, 100);
  else if (weather === 'rain') n.happiness = clamp(n.happiness - 0.015 * spd, 0, 100);
  else if (weather === 'clear' && dark < 0.3) {
    n.happiness = clamp(n.happiness + 0.01 * spd * (1 - p.neuroticism), 0, 100);
  }

  // Passive recovery when resting
  if (agent.state === 'resting' || agent.state === 'sleeping') {
    n.energy = clamp(n.energy + 0.35 * spd, 0, 100);
    n.happiness = clamp(n.happiness + 0.05 * spd, 0, 100);
  }
  if (agent.state === 'eating') {
    n.hunger = clamp(n.hunger - 0.8 * spd, 0, 100);
    n.happiness = clamp(n.happiness + 0.08 * spd, 0, 100);
  }
  if (agent.state === 'drinking') {
    n.thirst = clamp(n.thirst - 0.9 * spd, 0, 100);
  }
}

function pickGoal(agent, world) {
  const n = ensureNeeds(agent);
  const p = ensurePersonality(agent, world);
  const role = (agent.role || '').toLowerCase();

  // Short-term critical needs
  if (n.thirst > 75) return { kind: 'short', action: 'drink', reason: 'parched' };
  if (n.hunger > 75) return { kind: 'short', action: 'eat', reason: 'starving' };
  if (n.energy < 20) return { kind: 'short', action: 'rest', reason: 'exhausted' };
  if (n.social < 25 && p.extraversion > 0.4) {
    return { kind: 'short', action: 'socialize', reason: 'lonely' };
  }

  // Personality-weighted secondary
  const scores = {
    eat: n.hunger * 0.8,
    drink: n.thirst * 0.85,
    rest: (100 - n.energy) * (0.6 + p.neuroticism * 0.4),
    socialize: (100 - n.social) * (0.4 + p.extraversion * 0.8),
    work: 40 * p.conscientiousness + (WORK_ROLES.has(role) ? 30 : 0),
    explore: 20 * p.openness,
    create: SOCIAL_ROLES.has(role) ? 35 * p.openness : 5,
  };

  let best = 'rest';
  let bestS = -1;
  for (const k of Object.keys(scores)) {
    if (scores[k] > bestS) {
      bestS = scores[k];
      best = k;
    }
  }

  const longTerm =
    p.conscientiousness > 0.65 && WORK_ROLES.has(role)
      ? `build wealth as ${role}`
      : p.extraversion > 0.65
        ? 'grow friendships'
        : p.openness > 0.65
          ? 'discover the land'
          : 'live peacefully';

  return { kind: 'mixed', action: best, reason: longTerm, longTerm };
}

function executeGoal(agent, world, goal) {
  const p = ensurePersonality(agent, world);
  const speed = 0.08 + p.openness * 0.04;
  const action = goal.action;

  if (action === 'drink') {
    const water = findNearestTile(world, agent, [1, 7]);
    if (water) {
      steerToward(agent, water.x, water.y, speed);
      if (dist(agent, water) < 1.2) {
        agent.state = 'drinking';
        agent.thought = 'Cool water at last.';
        agent.vx = 0;
        agent.vy = 0;
      } else {
        agent.state = 'seeking_water';
        agent.thought = 'Looking for a river or lake.';
      }
    } else {
      agent.thought = 'No water nearby…';
      agent.state = 'wandering';
    }
    return;
  }

  if (action === 'eat') {
    const foodTile = findNearestTile(world, agent, [2, 6]);
    const resource = (world.resources || []).find(
      (r) => r && (r.type === 'food' || r.type === 'wheat') && r.amount > 0
    );
    const target = resource
      ? { x: resource.x, y: resource.y }
      : foodTile;
    if (target) {
      steerToward(agent, target.x, target.y, speed);
      if (dist(agent, target) < 1.3) {
        agent.state = 'eating';
        agent.thought = 'A proper meal.';
        agent.vx = 0;
        agent.vy = 0;
        if (resource) resource.amount = Math.max(0, resource.amount - 1);
      } else {
        agent.state = 'seeking_food';
        agent.thought = 'Hunting for something to eat.';
      }
    } else {
      agent.thought = 'The land feels barren.';
      agent.state = 'wandering';
    }
    return;
  }

  if (action === 'rest') {
    const home = (world.buildings || []).find(
      (b) => b && (b.type === 'house' || b.type === 'inn' || b.type === 'hut')
    );
    if (home && dist(agent, home) > 1.5) {
      steerToward(agent, home.x, home.y, speed * 0.8);
      agent.state = 'going_home';
      agent.thought = 'Need a place to rest.';
    } else {
      agent.vx *= 0.5;
      agent.vy *= 0.5;
      agent.state = world.darkness > 0.55 ? 'sleeping' : 'resting';
      agent.thought =
        agent.state === 'sleeping' ? 'Drifting into sleep…' : 'Catching my breath.';
    }
    return;
  }

  if (action === 'socialize') {
    const near = findNearestAgent(world, agent, (o) => {
      if ((agent.enemies || []).includes(o.id)) return false;
      return true;
    });
    if (near && near.dist < 10) {
      steerToward(agent, near.agent.x, near.agent.y, speed);
      if (near.dist < NEAR_DIST) {
        agent.state = 'socializing';
        agent.vx = 0;
        agent.vy = 0;
        agent.thought = `Chatting with ${near.agent.name || 'someone'}.`;
        ensureNeeds(agent).social = clamp(agent.needs.social + 0.5, 0, 100);
        ensureNeeds(agent).happiness = clamp(agent.needs.happiness + 0.15, 0, 100);
      } else {
        agent.state = 'seeking_company';
        agent.thought = `Hoping to see ${near.agent.name || 'a friend'}.`;
      }
    } else {
      agent.state = 'lonely';
      agent.thought = 'Wishing for company.';
      wander(agent, world, speed * 0.6);
    }
    return;
  }

  if (action === 'work') {
    const role = (agent.role || '').toLowerCase();
    let tiles = [2];
    if (role === 'miner') tiles = [3, 5];
    else if (role === 'lumberjack') tiles = [6];
    else if (role === 'fisher') tiles = [1, 7, 4];
    else if (role === 'farmer') tiles = [2];
    else tiles = [2, 3, 6];

    const job = findNearestTile(world, agent, tiles);
    if (job) {
      steerToward(agent, job.x, job.y, speed);
      if (dist(agent, job) < 1.4) {
        agent.state = 'working';
        agent.vx = 0;
        agent.vy = 0;
        agent.thought = `Working as a ${role || 'laborer'}.`;
        agent.money = (agent.money || 0) + 0.02 * (0.5 + p.conscientiousness);
        ensureNeeds(agent).energy = clamp(agent.needs.energy - 0.08, 0, 100);
      } else {
        agent.state = 'commuting';
        agent.thought = 'Heading to work.';
      }
    } else {
      wander(agent, world, speed);
      agent.thought = 'Searching for work.';
    }
    return;
  }

  if (action === 'create') {
    agent.state = 'creating';
    agent.vx *= 0.3;
    agent.vy *= 0.3;
    agent.thought = p.openness > 0.5 ? 'Shaping a new idea…' : 'Humming a quiet tune.';
    ensureNeeds(agent).happiness = clamp(agent.needs.happiness + 0.1, 0, 100);
    ensureNeeds(agent).social = clamp(agent.needs.social + 0.05, 0, 100);
    return;
  }

  // explore / default
  wander(agent, world, speed);
  agent.state = 'exploring';
  agent.thought = goal.longTerm || 'Wandering the Microverse.';
}

function wander(agent, world, speed) {
  if (!agent._wanderTimer || agent._wanderTimer <= 0) {
    const angle = seededRand(world) * Math.PI * 2;
    agent.vx = Math.cos(angle) * speed;
    agent.vy = Math.sin(angle) * speed;
    agent._wanderTimer = 20 + Math.floor(seededRand(world) * 40);
  } else {
    agent._wanderTimer -= 1;
  }
}

function updateRelationships(world) {
  const agents = world.agents || [];
  for (let i = 0; i < agents.length; i++) {
    const a = agents[i];
    if (!a || a.hp <= 0) continue;
    ensureLists(a);
    const pa = ensurePersonality(a, world);

    for (let j = i + 1; j < agents.length; j++) {
      const b = agents[j];
      if (!b || b.hp <= 0) continue;
      ensureLists(b);
      if (dist(a, b) > NEAR_DIST) continue;

      const pb = ensurePersonality(b, world);
      const agree = (pa.agreeableness + pb.agreeableness) * 0.5;
      const neuro = (pa.neuroticism + pb.neuroticism) * 0.5;
      const roll = seededRand(world);

      // Friendly encounter
      if (roll < 0.35 + agree * 0.4 - neuro * 0.15) {
        if (!a.friends.includes(b.id)) a.friends.push(b.id);
        if (!b.friends.includes(a.id)) b.friends.push(a.id);
        a.enemies = a.enemies.filter((id) => id !== b.id);
        b.enemies = b.enemies.filter((id) => id !== a.id);
        a.reputation = clamp((a.reputation || 0) + 0.01, -100, 100);
        b.reputation = clamp((b.reputation || 0) + 0.01, -100, 100);
        if (seededRand(world) < 0.08) {
          pushMemory(a, {
            tick: world.tick,
            type: 'meet',
            with: b.id,
            note: `Pleasant talk with ${b.name || b.id}`,
          });
          pushMemory(b, {
            tick: world.tick,
            type: 'meet',
            with: a.id,
            note: `Pleasant talk with ${a.name || a.id}`,
          });
        }
      } else if (roll > 0.92 - neuro * 0.2) {
        // Clash
        if (!a.enemies.includes(b.id)) a.enemies.push(b.id);
        if (!b.enemies.includes(a.id)) b.enemies.push(a.id);
        a.friends = a.friends.filter((id) => id !== b.id);
        b.friends = b.friends.filter((id) => id !== a.id);
        a.reputation = clamp((a.reputation || 0) - 0.02, -100, 100);
        b.reputation = clamp((b.reputation || 0) - 0.02, -100, 100);
        if (seededRand(world) < 0.15) {
          pushMemory(a, {
            tick: world.tick,
            type: 'clash',
            with: b.id,
            note: `Argument with ${b.name || b.id}`,
          });
          pushMemory(b, {
            tick: world.tick,
            type: 'clash',
            with: a.id,
            note: `Argument with ${a.name || a.id}`,
          });
          a.thought = `That ${b.name || 'person'} gets under my skin.`;
          b.thought = `Cannot stand ${a.name || 'them'}.`;
        }
      }
    }

    // Cap friend/enemy lists
    if (a.friends.length > 12) a.friends.length = 12;
    if (a.enemies.length > 8) a.enemies.length = 8;
  }
}

export function initSocialAI(world) {
  _rngState = ((world?.seed ?? 42) * 2654435761) >>> 0;
  if (world && Array.isArray(world.agents)) {
    for (const agent of world.agents) {
      if (!agent) continue;
      ensureNeeds(agent);
      ensurePersonality(agent, world);
      ensureLists(agent);
      if (!agent.goal) agent.goal = 'survive';
      if (!agent.thought) agent.thought = 'Awakening to a new day.';
      if (!agent.state) agent.state = 'idle';
    }
  }
  console.log('[Social AI] initialized');
}

export function updateSocialAI(world) {
  if (!world || world.paused) return;
  const agents = world.agents;
  if (!Array.isArray(agents) || agents.length === 0) return;

  const tick = world.tick | 0;
  const decideEvery = Math.max(1, Math.floor(8 / Math.max(0.5, world.speed || 1)));

  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i];
    if (!agent || (agent.hp != null && agent.hp <= 0)) continue;

    ensureNeeds(agent);
    ensurePersonality(agent, world);
    ensureLists(agent);
    decayNeeds(agent, world);

    const idHash = typeof agent.id === 'number'
      ? agent.id
      : String(agent.id || i).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    if (tick % decideEvery === idHash % decideEvery) {
      const goal = pickGoal(agent, world);
      agent.goal = goal.longTerm || goal.action;
      agent._activeGoal = goal;
      executeGoal(agent, world, goal);
    } else if (agent._activeGoal) {
      executeGoal(agent, world, agent._activeGoal);
    } else {
      wander(agent, world, 0.06);
      agent.state = agent.state || 'idle';
    }

    applyVelocity(agent, world);

    // Soft friction
    agent.vx = (agent.vx || 0) * 0.92;
    agent.vy = (agent.vy || 0) * 0.92;
  }

  if (tick % 3 === 0) updateRelationships(world);
}
