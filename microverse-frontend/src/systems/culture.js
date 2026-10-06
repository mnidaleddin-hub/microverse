/**
 * culture.js — Tech tree, festivals, art, religion, culture scores.
 * Exports: initCulture, updateCulture
 */

const MAX_EVENTS = 80;
const TECH_NODES = [
  { id: 'agriculture', name: 'Agriculture', cost: 20 },
  { id: 'writing', name: 'Writing', cost: 35 },
  { id: 'masonry', name: 'Masonry', cost: 45 },
  { id: 'metallurgy', name: 'Metallurgy', cost: 60 },
  { id: 'medicine', name: 'Medicine', cost: 75 },
  { id: 'navigation', name: 'Navigation', cost: 90 },
  { id: 'engineering', name: 'Engineering', cost: 110 },
  { id: 'printing', name: 'Printing', cost: 130 },
  { id: 'optics', name: 'Optics', cost: 150 },
  { id: 'steam', name: 'Steam Power', cost: 180 },
];

const ART_ROLES = new Set(['painter', 'poet', 'bard', 'artist', 'musician']);
const SCHOLAR_ROLES = new Set(['scholar', 'inventor', 'scientist', 'sage', 'engineer']);
const FAITH_ROLES = new Set(['priest', 'monk', 'cleric', 'shaman']);

let _culture = {
  techProgress: 0,
  unlocked: [],
  nextFestivalTick: 250,
  religionScore: 40,
  artworks: [],
  lastArtTick: 0,
};

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function hashRand(seed, tick, salt) {
  let h = ((seed | 0) ^ ((tick | 0) * 1597334677) ^ ((salt | 0) * 3812015801)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  return ((h >>> 0) & 0xfffffff) / 0x10000000;
}

function pushEvent(world, type, message) {
  if (!Array.isArray(world.events)) world.events = [];
  world.events.push({ tick: world.tick | 0, type, message });
  if (world.events.length > MAX_EVENTS) {
    world.events.splice(0, world.events.length - MAX_EVENTS);
  }
}

function countRoles(world) {
  const counts = { scholars: 0, artists: 0, faith: 0, total: 0 };
  for (const a of world.agents || []) {
    if (!a || (a.hp != null && a.hp <= 0)) continue;
    counts.total++;
    const role = (a.role || '').toLowerCase();
    if (SCHOLAR_ROLES.has(role)) counts.scholars++;
    if (ART_ROLES.has(role)) counts.artists++;
    if (FAITH_ROLES.has(role)) counts.faith++;
  }
  return counts;
}

function advanceTech(world) {
  const counts = countRoles(world);
  const tick = world.tick | 0;
  const scholarBoost = 0.04 + counts.scholars * 0.12;
  const happinessAvg = averageHappiness(world);
  const moodBoost = happinessAvg > 60 ? 1.15 : happinessAvg < 35 ? 0.7 : 1;

  _culture.techProgress += scholarBoost * moodBoost * Math.max(0.5, world.speed || 1);

  // Inventors working contribute extra
  for (const a of world.agents || []) {
    if (!a || a.state !== 'working' && a.state !== 'creating') continue;
    const role = (a.role || '').toLowerCase();
    if (SCHOLAR_ROLES.has(role)) {
      _culture.techProgress += 0.08;
      if (tick % 40 === (a.id | 0) % 40) {
        a.thought = 'Sketching a new invention…';
      }
    }
  }

  const next = TECH_NODES.find((n) => !_culture.unlocked.includes(n.id));
  if (next && _culture.techProgress >= next.cost) {
    _culture.unlocked.push(next.id);
    _culture.techProgress -= next.cost * 0.35;
    world.techLevel = _culture.unlocked.length;
    pushEvent(world, 'tech_unlock', `Discovery: ${next.name} enters the Microverse.`);
    for (const a of world.agents || []) {
      if (!a || !a.needs) continue;
      if (SCHOLAR_ROLES.has((a.role || '').toLowerCase())) {
        a.needs.happiness = clamp(a.needs.happiness + 6, 0, 100);
        a.thought = `We unlocked ${next.name}!`;
      }
    }
  }

  world.techLevel = _culture.unlocked.length;
  if (!world.techTree) world.techTree = {};
  world.techTree.unlocked = _culture.unlocked.slice();
  world.techTree.progress = Math.round(_culture.techProgress * 10) / 10;
  world.techTree.next = next ? next.name : 'Complete';
}

function averageHappiness(world) {
  const agents = world.agents || [];
  let sum = 0;
  let n = 0;
  for (const a of agents) {
    if (!a || (a.hp != null && a.hp <= 0)) continue;
    sum += a.needs?.happiness ?? 50;
    n++;
  }
  return n ? sum / n : 50;
}

function runFestivals(world) {
  const tick = world.tick | 0;
  if (tick < _culture.nextFestivalTick) return;

  const season = world.season || 'spring';
  const delay = season === 'winter' ? 900 : season === 'summer' ? 500 : 700;
  _culture.nextFestivalTick =
    tick + delay + Math.floor(hashRand(world.seed || 1, tick, 50) * 300);

  const names = {
    spring: 'Bloom Festival',
    summer: 'Sunfire Carnival',
    autumn: 'Harvest Jubilee',
    winter: 'Hearth Night',
  };
  const title = names[season] || 'Village Festival';
  pushEvent(world, 'festival', `${title} lifts spirits across the land.`);

  for (const a of world.agents || []) {
    if (!a || (a.hp != null && a.hp <= 0)) continue;
    if (!a.needs) continue;
    a.needs.happiness = clamp(a.needs.happiness + 12 + hashRand(world.seed || 1, tick, a.id) * 6, 0, 100);
    a.needs.social = clamp((a.needs.social || 50) + 10, 0, 100);
    a.thought = `Celebrating the ${title}!`;
    a.state = 'celebrating';
  }

  _culture.religionScore = clamp(_culture.religionScore + 3, 0, 100);
  world.cultureScore = clamp((world.cultureScore || 0) + 4, 0, 100);
}

function createArt(world) {
  const tick = world.tick | 0;
  if (tick - _culture.lastArtTick < 45) return;
  const artists = (world.agents || []).filter((a) => {
    if (!a || (a.hp != null && a.hp <= 0)) return false;
    const role = (a.role || '').toLowerCase();
    return ART_ROLES.has(role) || a.state === 'creating';
  });
  if (artists.length === 0) return;

  const pick =
    artists[Math.floor(hashRand(world.seed || 1, tick, 60) * artists.length) % artists.length];
  if (hashRand(world.seed || 1, tick, pick.id + 61) > 0.25) return;

  _culture.lastArtTick = tick;
  const role = (pick.role || 'artist').toLowerCase();
  const pieces = {
    painter: ['landscape fresco', 'portrait of dawn', 'river mural'],
    poet: ['ode to seasons', 'ballad of stone', 'verse of kinship'],
    bard: ['festival song', 'travel hymn', 'war lullaby'],
    musician: ['flute melody', 'drum circle piece', 'string nocturne'],
    artist: ['folk carving', 'woven banner', 'clay figure'],
  };
  const list = pieces[role] || pieces.artist;
  const title = list[Math.floor(hashRand(world.seed || 1, tick, 62) * list.length) % list.length];

  const art = {
    tick,
    authorId: pick.id,
    author: pick.name || 'Unknown',
    title,
    quality: Math.round(40 + hashRand(world.seed || 1, tick, 63) * 55),
  };
  _culture.artworks.push(art);
  if (_culture.artworks.length > 30) _culture.artworks.shift();

  pick.thought = `Finished my ${title}.`;
  pick.needs && (pick.needs.happiness = clamp((pick.needs.happiness || 50) + 5, 0, 100));
  pick.reputation = clamp((pick.reputation || 0) + 0.8, -100, 100);

  world.cultureScore = clamp((world.cultureScore || 30) + 1.2, 0, 100);
  if (art.quality > 75) {
    pushEvent(world, 'art', `${pick.name || 'An artist'} unveils "${title}".`);
  }

  if (!world.artworks) world.artworks = [];
  world.artworks = _culture.artworks.slice(-12);
}

function updateReligion(world) {
  const counts = countRoles(world);
  const tick = world.tick | 0;
  let delta = counts.faith * 0.04 - 0.01;
  if (world.weather === 'storm') delta += 0.05;
  if (world.season === 'winter') delta += 0.02;

  for (const a of world.agents || []) {
    if (!a || (a.hp != null && a.hp <= 0)) continue;
    if (!FAITH_ROLES.has((a.role || '').toLowerCase())) continue;
    if (a.state === 'socializing' || a.state === 'creating' || tick % 30 === 0) {
      delta += 0.03;
      if (tick % 50 === (a.id | 0) % 50) {
        a.thought = 'Offering quiet prayers.';
        a.needs && (a.needs.happiness = clamp((a.needs.happiness || 50) + 1, 0, 100));
      }
    }
  }

  _culture.religionScore = clamp(_culture.religionScore + delta, 0, 100);
  world.religionScore = Math.round(_culture.religionScore * 10) / 10;

  // Religion gently lifts happiness of nearby faithful mood
  if (tick % 25 === 0 && _culture.religionScore > 55) {
    for (const a of world.agents || []) {
      if (!a?.needs) continue;
      a.needs.happiness = clamp(a.needs.happiness + 0.4, 0, 100);
    }
  }
}

function recomputeCultureScore(world) {
  const artFactor = Math.min(40, _culture.artworks.length * 2.5);
  const techFactor = (_culture.unlocked.length / TECH_NODES.length) * 35;
  const faithFactor = (_culture.religionScore / 100) * 25;
  const happyFactor = (averageHappiness(world) / 100) * 15;
  world.cultureScore = clamp(
    Math.round((artFactor + techFactor + faithFactor + happyFactor) * 10) / 10,
    0,
    100
  );
}

export function initCulture(world) {
  _culture = {
    techProgress: 5,
    unlocked: [],
    nextFestivalTick: 200,
    religionScore: 40,
    artworks: [],
    lastArtTick: 0,
  };
  if (world) {
    world.techLevel = world.techLevel || 0;
    world.cultureScore = world.cultureScore ?? 30;
    world.religionScore = _culture.religionScore;
    world.techTree = { unlocked: [], progress: 5, next: TECH_NODES[0].name };
    if (!Array.isArray(world.artworks)) world.artworks = [];
  }
  console.log('[Culture] initialized');
}

export function updateCulture(world) {
  if (!world || world.paused) return;

  advanceTech(world);
  if ((world.tick | 0) % 8 === 0) createArt(world);
  runFestivals(world);
  if ((world.tick | 0) % 5 === 0) updateReligion(world);
  if ((world.tick | 0) % 12 === 0) recomputeCultureScore(world);
}
