/**
 * conflict_politics.js — Territory, reputation, skirmishes, alliances, treaties.
 * Exports: initConflictPolitics, updateConflictPolitics
 */

const MAX_EVENTS = 80;
const SKIRMISH_DIST = 2.0;

let _politics = {
  nextDisputeTick: 120,
  nextAllianceTick: 300,
  nextTreatyTick: 450,
  territories: [],
};

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function hashRand(seed, tick, salt) {
  let h = ((seed | 0) ^ ((tick | 0) * 2246822519) ^ ((salt | 0) * 3266489917)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h >>> 0) & 0xfffffff) / 0x10000000;
}

function pushEvent(world, type, message) {
  if (!Array.isArray(world.events)) world.events = [];
  world.events.push({ tick: world.tick | 0, type, message });
  if (world.events.length > MAX_EVENTS) {
    world.events.splice(0, world.events.length - MAX_EVENTS);
  }
}

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function ensureFactions(world) {
  if (!Array.isArray(world.factions)) world.factions = [];
  if (world.factions.length > 0) return world.factions;

  const names = ['Dawn League', 'Stone Circle', 'River Kin', 'Ash Banner'];
  const colors = ['#c45c26', '#2a6f97', '#40916c', '#6d597a'];
  for (let i = 0; i < 3; i++) {
    world.factions.push({
      id: `faction_${i}`,
      name: names[i],
      color: colors[i],
      power: 40 + i * 10,
      allies: [],
      enemies: [],
      treatyUntil: 0,
      territoryCenter: {
        x: 10 + i * 15 + hashRand(world.seed || 1, 0, i) * 5,
        y: 15 + ((i * 11) % 20),
      },
      radius: 8 + i,
    });
  }
  return world.factions;
}

function assignAgentsToFactions(world) {
  const factions = ensureFactions(world);
  const agents = world.agents || [];
  for (const a of agents) {
    if (!a || a.factionId) continue;
    // Nearest territory center
    let best = factions[0];
    let bestD = Infinity;
    for (const f of factions) {
      const d = dist(a, f.territoryCenter);
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
    a.factionId = best.id;
  }
}

function updateReputationLabels(world) {
  const agents = world.agents || [];
  for (const a of agents) {
    if (!a) continue;
    if (typeof a.reputation !== 'number') a.reputation = 0;
    if (a.reputation >= 40) a.repLabel = 'hero';
    else if (a.reputation <= -40) a.repLabel = 'villain';
    else if (a.reputation >= 15) a.repLabel = 'respected';
    else if (a.reputation <= -15) a.repLabel = 'suspect';
    else a.repLabel = 'citizen';
  }
}

function territoryDisputes(world) {
  const factions = ensureFactions(world);
  const tick = world.tick | 0;
  if (tick < _politics.nextDisputeTick) return;

  _politics.nextDisputeTick = tick + 180 + Math.floor(hashRand(world.seed || 1, tick, 7) * 220);

  if (factions.length < 2) return;
  const i = Math.floor(hashRand(world.seed || 1, tick, 11) * factions.length) % factions.length;
  let j = Math.floor(hashRand(world.seed || 1, tick, 13) * factions.length) % factions.length;
  if (j === i) j = (j + 1) % factions.length;
  const A = factions[i];
  const B = factions[j];

  // Skip if treaty active
  if ((A.treatyUntil || 0) > tick && (B.treatyUntil || 0) > tick) {
    if ((A.allies || []).includes(B.id)) return;
  }

  const dx = A.territoryCenter.x - B.territoryCenter.x;
  const dy = A.territoryCenter.y - B.territoryCenter.y;
  const separation = Math.sqrt(dx * dx + dy * dy);
  if (separation > (A.radius || 8) + (B.radius || 8) + 4) {
    // Expand toward each other slightly
    A.radius = clamp((A.radius || 8) + 0.3, 5, 18);
    B.radius = clamp((B.radius || 8) + 0.2, 5, 18);
  }

  if (!(A.enemies || []).includes(B.id)) {
    if (!A.enemies) A.enemies = [];
    if (!B.enemies) B.enemies = [];
    A.enemies.push(B.id);
    B.enemies.push(A.id);
  }
  A.allies = (A.allies || []).filter((id) => id !== B.id);
  B.allies = (B.allies || []).filter((id) => id !== A.id);

  pushEvent(
    world,
    'territory_dispute',
    `${A.name} and ${B.name} clash over border lands.`
  );

  // Mark agents near contested zone as tense
  const mid = {
    x: (A.territoryCenter.x + B.territoryCenter.x) / 2,
    y: (A.territoryCenter.y + B.territoryCenter.y) / 2,
  };
  for (const a of world.agents || []) {
    if (!a) continue;
    if (dist(a, mid) < 6) {
      a.thought = 'Tension rises on the border…';
      if (a.needs) a.needs.happiness = clamp((a.needs.happiness || 50) - 3, 0, 100);
    }
  }
}

function runSkirmishes(world) {
  const agents = world.agents || [];
  const seed = world.seed || 1;
  const tick = world.tick | 0;
  let fights = 0;

  for (let i = 0; i < agents.length && fights < 4; i++) {
    const a = agents[i];
    if (!a || (a.hp != null && a.hp <= 0)) continue;
    const enemies = a.enemies || [];
    if (enemies.length === 0) continue;

    for (let j = i + 1; j < agents.length && fights < 4; j++) {
      const b = agents[j];
      if (!b || (b.hp != null && b.hp <= 0)) continue;
      if (!enemies.includes(b.id) && !(b.enemies || []).includes(a.id)) continue;
      if (dist(a, b) > SKIRMISH_DIST) continue;

      // Chance to fight each encounter tick
      if (hashRand(seed, tick, a.id * 31 + b.id) > 0.12) continue;

      fights++;
      const aPow = 1 + (a.reputation || 0) * 0.01 + ((a.needs?.energy || 50) / 100);
      const bPow = 1 + (b.reputation || 0) * 0.01 + ((b.needs?.energy || 50) / 100);
      const aRoll = aPow * (0.7 + hashRand(seed, tick, a.id + 1));
      const bRoll = bPow * (0.7 + hashRand(seed, tick, b.id + 2));

      a.hp = typeof a.hp === 'number' ? a.hp : 100;
      b.hp = typeof b.hp === 'number' ? b.hp : 100;

      if (aRoll >= bRoll) {
        b.hp = clamp(b.hp - 8 - hashRand(seed, tick, 3) * 10, 0, 100);
        a.reputation = clamp((a.reputation || 0) + 1.5, -100, 100);
        b.reputation = clamp((b.reputation || 0) - 1, -100, 100);
        a.state = 'fighting';
        b.state = 'hurt';
        a.thought = `I bested ${b.name || 'my foe'}.`;
        b.thought = `Wounded by ${a.name || 'an enemy'}.`;
        pushEvent(
          world,
          'skirmish',
          `${a.name || 'Someone'} won a skirmish against ${b.name || 'a rival'}.`
        );
      } else {
        a.hp = clamp(a.hp - 8 - hashRand(seed, tick, 4) * 10, 0, 100);
        b.reputation = clamp((b.reputation || 0) + 1.5, -100, 100);
        a.reputation = clamp((a.reputation || 0) - 1, -100, 100);
        b.state = 'fighting';
        a.state = 'hurt';
        b.thought = `I bested ${a.name || 'my foe'}.`;
        a.thought = `Wounded by ${b.name || 'an enemy'}.`;
        pushEvent(
          world,
          'skirmish',
          `${b.name || 'Someone'} won a skirmish against ${a.name || 'a rival'}.`
        );
      }

      if (a.needs) a.needs.energy = clamp((a.needs.energy || 50) - 10, 0, 100);
      if (b.needs) b.needs.energy = clamp((b.needs.energy || 50) - 10, 0, 100);
    }
  }
}

function formAlliances(world) {
  const factions = ensureFactions(world);
  const tick = world.tick | 0;
  if (tick < _politics.nextAllianceTick) return;
  _politics.nextAllianceTick = tick + 350 + Math.floor(hashRand(world.seed || 1, tick, 21) * 400);

  if (factions.length < 2) return;
  // Pick two non-enemy factions or soften enmity
  const i = Math.floor(hashRand(world.seed || 1, tick, 22) * factions.length) % factions.length;
  let j = (i + 1 + Math.floor(hashRand(world.seed || 1, tick, 23) * (factions.length - 1))) % factions.length;
  if (j === i) return;
  const A = factions[i];
  const B = factions[j];

  if ((A.enemies || []).includes(B.id) && hashRand(world.seed || 1, tick, 24) < 0.55) {
    return; // still bitter
  }

  if (!A.allies) A.allies = [];
  if (!B.allies) B.allies = [];
  if (!A.allies.includes(B.id)) A.allies.push(B.id);
  if (!B.allies.includes(A.id)) B.allies.push(A.id);
  A.enemies = (A.enemies || []).filter((id) => id !== B.id);
  B.enemies = (B.enemies || []).filter((id) => id !== A.id);
  A.power = clamp((A.power || 40) + 5, 10, 100);
  B.power = clamp((B.power || 40) + 5, 10, 100);

  pushEvent(world, 'alliance', `${A.name} and ${B.name} forge an alliance.`);
}

function peaceTreaties(world) {
  const factions = ensureFactions(world);
  const tick = world.tick | 0;
  if (tick < _politics.nextTreatyTick) return;
  _politics.nextTreatyTick = tick + 500 + Math.floor(hashRand(world.seed || 1, tick, 31) * 500);

  const atWar = [];
  for (let i = 0; i < factions.length; i++) {
    for (let j = i + 1; j < factions.length; j++) {
      if ((factions[i].enemies || []).includes(factions[j].id)) {
        atWar.push([factions[i], factions[j]]);
      }
    }
  }
  if (atWar.length === 0) return;

  const pair = atWar[Math.floor(hashRand(world.seed || 1, tick, 32) * atWar.length) % atWar.length];
  const [A, B] = pair;
  const duration = 600 + Math.floor(hashRand(world.seed || 1, tick, 33) * 800);
  A.treatyUntil = tick + duration;
  B.treatyUntil = tick + duration;
  A.enemies = (A.enemies || []).filter((id) => id !== B.id);
  B.enemies = (B.enemies || []).filter((id) => id !== A.id);

  pushEvent(
    world,
    'peace_treaty',
    `${A.name} and ${B.name} sign a peace treaty lasting ${duration} ticks.`
  );

  // Soften agent enmities across those factions
  for (const a of world.agents || []) {
    if (!a || a.factionId !== A.id) continue;
    if (!Array.isArray(a.enemies)) continue;
    for (const b of world.agents || []) {
      if (!b || b.factionId !== B.id) continue;
      a.enemies = a.enemies.filter((id) => id !== b.id);
      if (Array.isArray(b.enemies)) b.enemies = b.enemies.filter((id) => id !== a.id);
    }
  }
}

function heroVillainDrift(world) {
  for (const a of world.agents || []) {
    if (!a) continue;
    const friends = (a.friends || []).length;
    const foes = (a.enemies || []).length;
    a.reputation = clamp(
      (a.reputation || 0) + friends * 0.002 - foes * 0.003,
      -100,
      100
    );
  }
}

export function initConflictPolitics(world) {
  _politics = {
    nextDisputeTick: 100,
    nextAllianceTick: 280,
    nextTreatyTick: 420,
    territories: [],
  };
  if (world) {
    ensureFactions(world);
    assignAgentsToFactions(world);
    updateReputationLabels(world);
    if (!Array.isArray(world.events)) world.events = [];
  }
  console.log('[Conflict] initialized');
}

export function updateConflictPolitics(world) {
  if (!world || world.paused) return;

  ensureFactions(world);
  if ((world.tick | 0) % 40 === 0) assignAgentsToFactions(world);

  territoryDisputes(world);
  if ((world.tick | 0) % 4 === 0) runSkirmishes(world);
  formAlliances(world);
  peaceTreaties(world);
  if ((world.tick | 0) % 10 === 0) {
    heroVillainDrift(world);
    updateReputationLabels(world);
  }

  // Expire treaties note
  const tick = world.tick | 0;
  for (const f of world.factions || []) {
    if (f.treatyUntil && f.treatyUntil === tick) {
      pushEvent(world, 'treaty_ended', `The peace around ${f.name} has expired.`);
    }
  }
}
