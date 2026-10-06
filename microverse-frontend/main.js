/**
 * MICROVERSE v3 — Main Orchestrator
 * Offline-capable Canvas 2D civilization simulation.
 * No PIXI. All systems are real ES modules.
 */
'use strict';

import { initSocialAI, updateSocialAI } from './src/systems/social_ai.js';
import { initEconomy, updateEconomy } from './src/systems/economy.js';
import { initConflictPolitics, updateConflictPolitics } from './src/systems/conflict_politics.js';
import { initCulture, updateCulture } from './src/systems/culture.js';
import { initEnvironment, updateEnvironment } from './src/systems/environment.js';
import { initGameplay, updateGameplay, saveWorld, loadWorld } from './src/systems/gameplay.js';
import { initVisual, updateVisual, getEngine } from './src/systems/visual.js';
import { initAnalytics, updateAnalytics } from './src/systems/analytics.js';
import { initObserver, updateObserver } from './src/systems/observer.js';

// ============================================================
// WORLD STATE
// ============================================================
function createWorld(seed = Date.now() % 100000) {
  return {
    seed,
    tick: 0,
    season: 'spring',
    weather: 'clear',
    timeOfDay: 0.35,
    darkness: 0.15,
    speed: 1,
    paused: false,
    grid: null,
    agents: [],
    buildings: [],
    resources: [],
    prices: { wheat: 1, wood: 1.2, stone: 1.5, food: 1.1 },
    events: [],
    particles: [],
    tradeRoutes: [],
    factions: [],
    techLevel: 0,
    cultureScore: 0,
    metrics: { population: 0, gdp: 0, happiness: 0, tradeVolume: 0 },
    history: [],
    selectedAgentId: null,
    followId: null,
    godMode: {},
    godQueue: [],
    observerFocus: null,
    directorEnabled: false,
    challenge: null,
    achievements: {},
  };
}

let world = createWorld(42);
let registry = null;
let lastFrame = performance.now();
let simAccumulator = 0;
const SIM_STEP = 1 / 30;
let muted = true;
let eventLogCursor = 0;
let chartsOpen = false;

// Creative: achievements + AI director + daily challenge
const ACHIEVEMENTS = [
  { id: 'first_look', icon: '👁', title: 'First Observation', desc: 'Select any agent', check: (w) => !!w.selectedAgentId },
  { id: 'rain_maker', icon: '🌧', title: 'Rain Maker', desc: 'Summon rain weather', check: (w) => w.weather === 'rain' },
  { id: 'speed_demon', icon: '⚡', title: 'Speed Demon', desc: 'Run at 10x speed', check: (w) => w.speed >= 10 },
  { id: 'populous', icon: '🏘', title: 'Growing Village', desc: 'Reach 20 agents', check: (w) => (w.agents?.length || 0) >= 20 },
  { id: 'night_owl', icon: '🌙', title: 'Night Owl', desc: 'Witness full night', check: (w) => (w.darkness || 0) > 0.7 },
  { id: 'historian', icon: '📜', title: 'Historian', desc: 'Survive 500 ticks', check: (w) => (w.tick || 0) >= 500 },
  { id: 'wealthy', icon: '💰', title: 'Market Watcher', desc: 'GDP above 500', check: (w) => (w.metrics?.gdp || 0) > 500 },
  { id: 'cultured', icon: '🎨', title: 'Renaissance', desc: 'Culture score 10+', check: (w) => (w.cultureScore || 0) >= 10 },
];

const DIRECTOR_BEATS = [
  { type: 'weather', weather: 'storm', msg: 'AI Director: A sudden storm rolls in!' },
  { type: 'spawn', msg: 'AI Director: Travelers arrive seeking shelter.' },
  { type: 'festival', msg: 'AI Director: A spontaneous festival begins!' },
  { type: 'disaster', msg: 'AI Director: The earth trembles…' },
  { type: 'bless', msg: 'AI Director: A blessing sweeps the land.' },
];

// ============================================================
// LOADING UI
// ============================================================
function setLoadProgress(pct, label) {
  const fill = document.getElementById('loader-fill');
  const text = document.getElementById('loader-pct');
  if (fill) fill.style.width = `${pct}%`;
  if (text) text.textContent = label ? `${pct}% — ${label}` : `${pct}%`;
}

function hideLoader() {
  const el = document.getElementById('loading-screen');
  if (!el) return;
  el.classList.add('hide');
  setTimeout(() => { el.style.display = 'none'; }, 600);
}

// ============================================================
// REGISTRY / CODEX
// ============================================================
async function loadRegistry() {
  try {
    const res = await fetch('./src/data/registry.json');
    registry = await res.json();
    return registry;
  } catch (err) {
    console.warn('[Boot] Registry load failed', err);
    registry = { total_entities: 0, categories: {} };
    return registry;
  }
}

function allRegistryItems() {
  if (!registry?.categories) return [];
  const out = [];
  for (const [cat, block] of Object.entries(registry.categories)) {
    for (const item of block.items || []) {
      out.push({ ...item, _cat: cat });
    }
  }
  return out;
}

function renderCodex(filter = '', category = 'all') {
  const grid = document.getElementById('codex-grid');
  const countEl = document.getElementById('codex-count');
  if (!grid) return;
  const q = filter.trim().toLowerCase();
  let items = allRegistryItems();
  if (category !== 'all') items = items.filter((i) => i._cat === category);
  if (q) {
    items = items.filter((i) =>
      (i.name || '').toLowerCase().includes(q) ||
      (i.entity_id || '').toLowerCase().includes(q) ||
      (i.category || '').toLowerCase().includes(q)
    );
  }
  if (countEl) countEl.textContent = String(items.length);

  // Virtualize-ish: cap DOM nodes for performance
  const MAX = 120;
  const slice = items.slice(0, MAX);
  const frag = document.createDocumentFragment();
  for (const ent of slice) {
    const card = document.createElement('div');
    card.className = 'codex-card';
    const rarity = ent.stats?.rarity || 'common';
    card.innerHTML = `
      <h4>${escapeHtml(ent.name || ent.entity_id)}</h4>
      <div class="entity-meta">${escapeHtml(ent.category || ent._cat)} · ${escapeHtml(rarity)}</div>
      <div class="entity-stats">
        ${Object.entries(ent.stats || {}).slice(0, 3).map(([k, v]) =>
          `<span class="stat-pill">${escapeHtml(k)}: ${escapeHtml(String(v))}</span>`
        ).join('')}
      </div>`;
    frag.appendChild(card);
  }
  grid.innerHTML = '';
  grid.appendChild(frag);
  if (items.length > MAX) {
    const more = document.createElement('div');
    more.className = 'codex-card';
    more.innerHTML = `<h4>+${items.length - MAX} more</h4><div class="entity-meta">Refine search to narrow results</div>`;
    grid.appendChild(more);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ============================================================
// DASHBOARD / UI UPDATES
// ============================================================
function updateDashboard() {
  const agents = world.agents || [];
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  set('total-count', agents.length);
  set('alive-count', agents.filter((a) => a.state !== 'dead').length);
  set('season-val', capitalize(world.season || 'spring'));
  set('weather-val', capitalize(world.weather || 'clear'));
  set('wheat-price', (world.prices?.wheat ?? 1).toFixed(2));
  set('wood-price', (world.prices?.wood ?? 1).toFixed(2));
  set('gdp-val', Math.round(world.metrics?.gdp || 0));
  set('happy-val', Math.round(world.metrics?.happiness || 0));
  set('tech-val', Math.round(world.techLevel || 0));
  set('culture-val', Math.round(world.cultureScore || 0));
  set('tick-val', world.tick | 0);
  set('speed-val', `${world.speed}x`);

  // Clock
  const tod = world.timeOfDay ?? 0.35;
  const hours = Math.floor(tod * 24) % 24;
  const mins = Math.floor((tod * 24 * 60) % 60);
  const day = 1 + Math.floor((world.tick || 0) / 1440);
  const clockIcon = document.getElementById('clock-icon');
  const clockText = document.getElementById('clock-text');
  if (clockIcon) clockIcon.textContent = tod > 0.25 && tod < 0.75 ? '☀' : '🌙';
  if (clockText) clockText.textContent = `Day ${day} · ${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;

  const weatherIcon = document.getElementById('weather-icon');
  const weatherText = document.getElementById('weather-text');
  const icons = { clear: '☀', rain: '🌧', snow: '❄', storm: '⛈', fog: '🌫' };
  if (weatherIcon) weatherIcon.textContent = icons[world.weather] || '☁';
  if (weatherText) weatherText.textContent = capitalize(world.weather || 'Clear');

  // FPS
  const eng = getEngine();
  const fpsEl = document.getElementById('fps-meter');
  if (fpsEl && eng) fpsEl.textContent = `${eng.getFPS()} FPS`;

  // Zoom label
  const zl = document.getElementById('zoom-level');
  if (zl && eng?.camera) zl.textContent = `${Math.round((eng.camera.zoom || 1) * 100)}%`;

  updateEventLog();
  updateObserverPanel();
  drawSparkCharts();
  checkAchievements();
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

function updateEventLog() {
  const ul = document.getElementById('event-log');
  if (!ul || !Array.isArray(world.events)) return;
  if (world.events.length === eventLogCursor) return;
  const fresh = world.events.slice(eventLogCursor);
  eventLogCursor = world.events.length;
  for (const ev of fresh.slice(-20)) {
    const li = document.createElement('li');
    li.textContent = `[${ev.tick ?? '?'}] ${ev.message || ev.type || 'Event'}`;
    ul.prepend(li);
  }
  while (ul.children.length > 40) ul.removeChild(ul.lastChild);
}

function updateObserverPanel() {
  const focus = world.observerFocus;
  const nameEl = document.getElementById('obs-name');
  const thoughtEl = document.getElementById('obs-thought');
  const needsEl = document.getElementById('obs-needs');
  const relEl = document.getElementById('obs-relations');
  const memEl = document.getElementById('obs-memory');
  if (!nameEl) return;

  if (!focus?.agentId) {
    nameEl.textContent = 'Select an agent';
    if (thoughtEl) thoughtEl.textContent = 'Click an agent on the map to observe their thoughts.';
    if (needsEl) needsEl.innerHTML = '';
    if (relEl) relEl.innerHTML = '';
    if (memEl) memEl.innerHTML = '';
    return;
  }

  nameEl.textContent = `${focus.name || focus.agentId} · ${focus.role || 'citizen'}`;
  if (thoughtEl) thoughtEl.textContent = focus.thought || '…';

  if (needsEl && focus.needs) {
    const colors = { hunger: '#f59e0b', thirst: '#38bdf8', energy: '#a78bfa', happiness: '#34d399', social: '#fb7185' };
    needsEl.innerHTML = Object.entries(focus.needs).map(([k, v]) => `
      <div class="need-row">
        <span style="width:72px">${escapeHtml(k)}</span>
        <div class="bar-bg"><div class="bar-fill" style="width:${Math.max(0, Math.min(100, v))}%;background:${colors[k] || '#22d3ee'}"></div></div>
        <span style="width:32px;text-align:right;font-family:var(--font-mono)">${Math.round(v)}</span>
      </div>`).join('');
  }
  if (relEl) {
    const rel = focus.relations;
    const summary = typeof rel === 'string' ? rel : (rel?.summary || 'No notable relationships.');
    relEl.innerHTML = `<div style="font-size:0.8rem;color:var(--text-muted);margin-top:8px">${escapeHtml(summary)}</div>`;
  }
  if (memEl && Array.isArray(focus.history)) {
    const lines = focus.history.slice(-5).map((h) => {
      if (typeof h === 'string') return h;
      return h.note || h.message || h.type || JSON.stringify(h);
    });
    memEl.innerHTML = `<div style="font-size:0.75rem;margin-top:8px;color:var(--text-muted)">${lines.map(escapeHtml).join('<br>')}</div>`;
  }
}

function drawSparkCharts() {
  if (!chartsOpen) return;
  const hist = world.history || [];
  if (hist.length < 2) return;
  drawSpark('chart-population', hist.map((h) => h.population), '#22d3ee');
  drawSpark('chart-hunger', hist.map((h) => h.happiness), '#34d399');
  drawSpark('chart-wheat', hist.map((h) => h.gdp), '#fbbf24');
}

function drawSpark(canvasId, data, color) {
  const cvs = document.getElementById(canvasId);
  if (!cvs) return;
  const ctx = cvs.getContext('2d');
  const w = cvs.width;
  const h = cvs.height;
  ctx.clearRect(0, 0, w, h);
  if (!data.length) return;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = Math.max(1, max - min);
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  data.forEach((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 8) - 4;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

// ============================================================
// ACHIEVEMENTS / DIRECTOR / CHALLENGE
// ============================================================
function checkAchievements() {
  if (!world.achievements) world.achievements = {};
  let unlocked = false;
  for (const ach of ACHIEVEMENTS) {
    if (world.achievements[ach.id]) continue;
    try {
      if (ach.check(world)) {
        world.achievements[ach.id] = { at: world.tick, time: Date.now() };
        unlocked = true;
        world.events.push({ tick: world.tick, type: 'achievement', message: `Achievement unlocked: ${ach.title}` });
      }
    } catch (_) { /* ignore */ }
  }
  if (unlocked) renderAchievements();
}

function renderAchievements() {
  const ul = document.getElementById('achievements-list');
  if (!ul) return;
  ul.innerHTML = ACHIEVEMENTS.map((a) => {
    const done = !!world.achievements?.[a.id];
    return `<li class="${done ? '' : 'locked'}">
      <span class="ach-icon">${a.icon}</span>
      <div><div class="ach-title">${escapeHtml(a.title)}${done ? ' ✓' : ''}</div>
      <div class="ach-desc">${escapeHtml(a.desc)}</div></div>
    </li>`;
  }).join('');
}

function runAIDirector() {
  if (!world.directorEnabled || world.paused) return;
  if ((world.tick % 400) !== 0 || world.tick === 0) return;
  const beat = DIRECTOR_BEATS[Math.floor(Math.random() * DIRECTOR_BEATS.length)];
  world.events.push({ tick: world.tick, type: 'director', message: beat.msg });
  if (beat.type === 'weather') world.weather = beat.weather;
  if (beat.type === 'spawn') world.godQueue.push({ action: 'spawn_agent' });
  if (beat.type === 'disaster') world.godQueue.push({ action: 'disaster' });
  if (beat.type === 'bless') world.godQueue.push({ action: 'bless' });
  if (beat.type === 'festival') {
    for (const a of world.agents || []) {
      if (a.needs) a.needs.happiness = Math.min(100, (a.needs.happiness || 50) + 15);
    }
  }
}

function startDailyChallenge() {
  const dayKey = new Date().toISOString().slice(0, 10);
  world.challenge = {
    id: dayKey,
    goal: 'Reach 75 average happiness before tick 800',
    targetHappy: 75,
    deadline: 800,
    started: world.tick,
  };
  world.events.push({
    tick: world.tick,
    type: 'challenge',
    message: `Daily Challenge (${dayKey}): ${world.challenge.goal}`,
  });
}

function checkChallenge() {
  const c = world.challenge;
  if (!c || c.done) return;
  const happy = world.metrics?.happiness || 0;
  if (happy >= c.targetHappy) {
    c.done = true;
    c.won = true;
    world.events.push({ tick: world.tick, type: 'challenge', message: 'Daily Challenge COMPLETE!' });
    world.achievements = world.achievements || {};
    world.achievements.daily = { at: world.tick };
  } else if (world.tick - c.started >= c.deadline) {
    c.done = true;
    c.won = false;
    world.events.push({ tick: world.tick, type: 'challenge', message: 'Daily Challenge failed — try again tomorrow.' });
  }
}

// ============================================================
// SOUND (lightweight WebAudio beeps — no Howler CDN)
// ============================================================
let audioCtx = null;
function playBeep(freq = 440, dur = 0.08) {
  if (muted) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = freq;
    o.type = 'sine';
    g.gain.value = 0.08;
    o.connect(g); g.connect(audioCtx.destination);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    o.stop(audioCtx.currentTime + dur);
  } catch (_) { /* ignore */ }
}

// ============================================================
// UI WIRING
// ============================================================
function wireUI() {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  const toggle = document.getElementById('sidebar-toggle');

  const openSidebar = () => {
    sidebar?.classList.add('open');
    backdrop?.classList.add('show');
  };
  const closeSidebar = () => {
    sidebar?.classList.remove('open');
    backdrop?.classList.remove('show');
  };

  toggle?.addEventListener('click', () => {
    if (sidebar?.classList.contains('open')) closeSidebar();
    else openSidebar();
  });
  backdrop?.addEventListener('click', closeSidebar);

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab)?.classList.add('active');
      playBeep(660, 0.05);
    });
  });

  document.getElementById('toggle-charts-btn')?.addEventListener('click', () => {
    chartsOpen = !chartsOpen;
    document.getElementById('charts-panel')?.classList.toggle('collapsed', !chartsOpen);
  });

  document.getElementById('pause-btn')?.addEventListener('click', () => {
    world.paused = true;
    playBeep(300, 0.1);
  });
  document.getElementById('resume-btn')?.addEventListener('click', () => {
    world.paused = false;
    playBeep(500, 0.08);
  });
  document.getElementById('reset-btn')?.addEventListener('click', () => {
    if (!confirm('Reset world to a new seed?')) return;
    softReset(Date.now() % 100000);
  });

  document.querySelectorAll('.speed-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.speed-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const sp = parseFloat(btn.dataset.speed);
      world.speed = sp;
      if (typeof world.setSpeed === 'function') world.setSpeed(sp);
      playBeep(440 + sp * 40, 0.05);
    });
  });

  document.querySelectorAll('.weather-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      world.weather = btn.dataset.weather;
      world.events.push({ tick: world.tick, type: 'god', message: `Weather set to ${world.weather}` });
      playBeep(380, 0.1);
    });
  });
  document.querySelectorAll('.season-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      world.season = btn.dataset.season;
      world.events.push({ tick: world.tick, type: 'god', message: `Season set to ${world.season}` });
    });
  });

  document.getElementById('god-spawn')?.addEventListener('click', () => {
    world.godQueue.push({ action: 'spawn_agent' });
    playBeep(720, 0.1);
  });
  document.getElementById('god-disaster')?.addEventListener('click', () => {
    world.godQueue.push({ action: 'disaster' });
    playBeep(180, 0.2);
  });
  document.getElementById('god-bless')?.addEventListener('click', () => {
    world.godQueue.push({ action: 'bless', agentId: world.selectedAgentId });
    playBeep(880, 0.12);
  });
  document.getElementById('god-curse')?.addEventListener('click', () => {
    world.godQueue.push({ action: 'curse', agentId: world.selectedAgentId });
    playBeep(120, 0.15);
  });

  document.getElementById('save-btn')?.addEventListener('click', () => {
    if (saveWorld(world, 0)) {
      world.events.push({ tick: world.tick, type: 'save', message: 'World saved to slot 0' });
      playBeep(600, 0.1);
    }
  });
  document.getElementById('load-btn')?.addEventListener('click', () => {
    const loaded = loadWorld(0);
    if (loaded) {
      Object.assign(world, loaded);
      eventLogCursor = 0;
      world.events.push({ tick: world.tick, type: 'load', message: 'World loaded from slot 0' });
      playBeep(500, 0.1);
    } else {
      alert('No save found in slot 0');
    }
  });

  document.getElementById('screenshot-btn')?.addEventListener('click', () => {
    const canvas = document.getElementById('microverse-canvas');
    if (!canvas) return;
    const a = document.createElement('a');
    a.download = `microverse_${world.tick}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
    world.events.push({ tick: world.tick, type: 'media', message: 'Screenshot captured' });
  });

  document.getElementById('new-world-btn')?.addEventListener('click', () => {
    softReset(Math.floor(Math.random() * 999999));
  });
  document.getElementById('challenge-btn')?.addEventListener('click', startDailyChallenge);
  document.getElementById('director-btn')?.addEventListener('click', () => {
    world.directorEnabled = !world.directorEnabled;
    const btn = document.getElementById('director-btn');
    btn?.classList.toggle('active', world.directorEnabled);
    world.events.push({
      tick: world.tick,
      type: 'director',
      message: world.directorEnabled ? 'AI Director ENABLED' : 'AI Director disabled',
    });
  });

  document.getElementById('follow-btn')?.addEventListener('click', () => {
    if (world.selectedAgentId) {
      world.followId = world.followId === world.selectedAgentId ? null : world.selectedAgentId;
      document.getElementById('follow-btn')?.classList.toggle('active', !!world.followId);
    }
  });

  document.getElementById('mute-btn')?.addEventListener('click', () => {
    muted = !muted;
    const btn = document.getElementById('mute-btn');
    if (btn) {
      btn.textContent = muted ? 'Mute' : 'Sound';
      btn.classList.toggle('active', !muted);
    }
    if (!muted) playBeep(520, 0.08);
  });

  // Codex
  const codex = document.getElementById('codex-panel');
  document.getElementById('codex-btn')?.addEventListener('click', () => {
    if (!codex) return;
    const open = codex.classList.toggle('open');
    codex.hidden = !open;
    if (open) {
      renderCodex(
        document.getElementById('codex-filter')?.value || '',
        document.getElementById('codex-category')?.value || 'all'
      );
      openSidebar();
      codex.classList.add('open');
    }
  });
  document.getElementById('codex-close')?.addEventListener('click', () => {
    if (codex) { codex.classList.remove('open'); codex.hidden = true; }
  });
  document.getElementById('codex-filter')?.addEventListener('input', (e) => {
    renderCodex(e.target.value, document.getElementById('codex-category')?.value || 'all');
  });
  document.getElementById('codex-category')?.addEventListener('change', (e) => {
    renderCodex(document.getElementById('codex-filter')?.value || '', e.target.value);
  });

  // Achievements panel
  const achPanel = document.getElementById('achievements-panel');
  document.getElementById('achievements-btn')?.addEventListener('click', () => {
    if (!achPanel) return;
    const open = achPanel.classList.toggle('open');
    achPanel.hidden = !open;
    if (open) renderAchievements();
  });
  document.getElementById('achievements-close')?.addEventListener('click', () => {
    if (achPanel) { achPanel.classList.remove('open'); achPanel.hidden = true; }
  });

  document.getElementById('clear-log-btn')?.addEventListener('click', () => {
    const ul = document.getElementById('event-log');
    if (ul) ul.innerHTML = '';
    eventLogCursor = world.events?.length || 0;
  });

  document.getElementById('tutorial-dismiss')?.addEventListener('click', () => {
    const t = document.getElementById('tutorial-toast');
    if (t) t.hidden = true;
    localStorage.setItem('microverse_tutorial_seen', '1');
  });

  // Zoom buttons
  const eng = () => getEngine();
  document.getElementById('zoom-in-btn')?.addEventListener('click', () => {
    const cam = eng()?.camera;
    if (cam) cam.zoom = Math.min(3, (cam.zoom || 1) * 1.15);
  });
  document.getElementById('zoom-out-btn')?.addEventListener('click', () => {
    const cam = eng()?.camera;
    if (cam) cam.zoom = Math.max(0.5, (cam.zoom || 1) / 1.15);
  });
  document.getElementById('zoom-center-btn')?.addEventListener('click', () => {
    const cam = eng()?.camera;
    if (cam) { cam.x = 50 * 16; cam.y = 50 * 16; cam.zoom = 1; }
  });

  // Keyboard shortcuts hint already in tutorial; F = follow
  window.addEventListener('keydown', (e) => {
    if (e.key === 'f' || e.key === 'F') {
      if (world.selectedAgentId) {
        world.followId = world.followId === world.selectedAgentId ? null : world.selectedAgentId;
        document.getElementById('follow-btn')?.classList.toggle('active', !!world.followId);
      }
    }
    if (e.key === ' ') {
      e.preventDefault();
      world.paused = !world.paused;
    }
  });
}

function softReset(seed) {
  const achievements = world.achievements || {};
  world = createWorld(seed);
  world.achievements = achievements;
  eventLogCursor = 0;
  initAllSystems();
  world.events.push({ tick: 0, type: 'boot', message: `New world seeded (${seed})` });
}

function initAllSystems() {
  const canvas = document.getElementById('microverse-canvas');
  const minimap = document.getElementById('minimap-canvas');
  const container = document.getElementById('game-container');

  initVisual(world, { mainCanvas: canvas, minimapCanvas: minimap, container });
  initSocialAI(world);
  initEconomy(world);
  initConflictPolitics(world);
  initCulture(world);
  initEnvironment(world);
  initGameplay(world);
  initAnalytics(world);
  initObserver(world);

  world.events.push({ tick: 0, type: 'boot', message: 'Civilization systems online.' });
}

// ============================================================
// MAIN LOOP
// ============================================================
function tickSimulation() {
  if (world.paused) {
    updateGameplay(world); // still process god queue
    return;
  }

  const steps = Math.min(4, Math.max(1, Math.floor(world.speed)));
  for (let i = 0; i < steps; i++) {
    world.tick = (world.tick | 0) + 1;
    updateEnvironment(world);
    updateSocialAI(world);
    updateEconomy(world);
    updateConflictPolitics(world);
    updateCulture(world);
    updateGameplay(world);
    updateAnalytics(world);
    updateObserver(world);
    runAIDirector();
    checkChallenge();
  }
}

function frame(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;

  simAccumulator += dt * (world.paused ? 0 : 1);
  // Decouple: run sim at ~30Hz * speed via tickSimulation batching
  if (!world.paused) {
    // Call once per frame; internal loop uses world.speed
    if (simAccumulator >= SIM_STEP / Math.max(0.5, world.speed)) {
      simAccumulator = 0;
      tickSimulation();
    }
  } else {
    updateGameplay(world);
    updateObserver(world);
  }

  updateVisual(world, dt);
  updateDashboard();

  requestAnimationFrame(frame);
}

// ============================================================
// BOOT
// ============================================================
async function boot() {
  console.log('🌍 [BOOT] Microverse v3 starting…');
  setLoadProgress(10, 'Modules');

  setLoadProgress(30, 'Registry');
  await loadRegistry();
  setLoadProgress(55, 'Systems');

  wireUI();
  setLoadProgress(70, 'World');

  initAllSystems();
  setLoadProgress(90, 'Renderer');

  // Status
  const statusText = document.getElementById('status-text');
  const statusDot = document.getElementById('status-dot');
  if (statusText) statusText.textContent = 'Local Sim';
  if (statusDot) {
    statusDot.className = 'status-dot status-connected';
  }

  renderAchievements();
  setLoadProgress(100, 'Ready');

  setTimeout(() => {
    hideLoader();
    if (!localStorage.getItem('microverse_tutorial_seen')) {
      const t = document.getElementById('tutorial-toast');
      if (t) t.hidden = false;
    }
  }, 350);

  lastFrame = performance.now();
  requestAnimationFrame(frame);

  console.log(`🎉 [BOOT] Ready — ${registry?.total_entities || 0} codex entities, ${world.agents?.length || 0} agents`);
  window.__MICROVERSE__ = { world, getEngine, saveWorld, loadWorld };
}

boot().catch((err) => {
  console.error('[BOOT] Fatal', err);
  setLoadProgress(100, 'Error — check console');
  const text = document.getElementById('status-text');
  if (text) text.textContent = 'Boot Error';
});
