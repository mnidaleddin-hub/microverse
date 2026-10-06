/**
 * observer.js — Focused agent observation panel data for follow/select.
 * Exports: initObserver, updateObserver
 */

const REL_HISTORY_CAP = 24;

let _observer = {
  lastFocusId: null,
  thoughtLog: [],
};

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function findAgent(world, id) {
  if (id == null || id === '') return null;
  const agents = world.agents || [];
  for (let i = 0; i < agents.length; i++) {
    if (agents[i] && agents[i].id === id) return agents[i];
  }
  return null;
}

function resolveFocusId(world) {
  if (world.followId != null && world.followId !== '') return world.followId;
  if (world.selectedAgentId != null && world.selectedAgentId !== '') {
    return world.selectedAgentId;
  }
  return null;
}

function snapshotNeeds(agent) {
  const n = agent.needs || {};
  return {
    hunger: Math.round(clamp(n.hunger ?? 0, 0, 100) * 10) / 10,
    thirst: Math.round(clamp(n.thirst ?? 0, 0, 100) * 10) / 10,
    energy: Math.round(clamp(n.energy ?? 0, 0, 100) * 10) / 10,
    happiness: Math.round(clamp(n.happiness ?? 0, 0, 100) * 10) / 10,
    social: Math.round(clamp(n.social ?? 0, 0, 100) * 10) / 10,
  };
}

function nameOf(world, id) {
  const a = findAgent(world, id);
  return a?.name || String(id);
}

function buildRelations(world, agent) {
  const friends = Array.isArray(agent.friends) ? agent.friends : [];
  const enemies = Array.isArray(agent.enemies) ? agent.enemies : [];

  const friendDetails = friends.slice(0, 8).map((id) => {
    const other = findAgent(world, id);
    return {
      id,
      name: other?.name || String(id),
      role: other?.role || '?',
      status: other && (other.hp == null || other.hp > 0) ? 'alive' : 'gone',
    };
  });

  const enemyDetails = enemies.slice(0, 8).map((id) => {
    const other = findAgent(world, id);
    return {
      id,
      name: other?.name || String(id),
      role: other?.role || '?',
      status: other && (other.hp == null || other.hp > 0) ? 'alive' : 'gone',
    };
  });

  let summary = 'Keeps to themselves.';
  if (friends.length && enemies.length) {
    summary = `${friends.length} friends, ${enemies.length} rivals.`;
  } else if (friends.length) {
    summary = `Beloved by ${friends.length}: ${friendDetails
      .slice(0, 3)
      .map((f) => f.name)
      .join(', ')}.`;
  } else if (enemies.length) {
    summary = `At odds with ${enemies.length}: ${enemyDetails
      .slice(0, 3)
      .map((e) => e.name)
      .join(', ')}.`;
  }

  const rep = agent.reputation || 0;
  let standing = 'citizen';
  if (rep >= 40) standing = 'hero';
  else if (rep <= -40) standing = 'villain';
  else if (rep >= 15) standing = 'respected';
  else if (rep <= -15) standing = 'suspect';

  return {
    summary,
    standing,
    reputation: Math.round(rep * 10) / 10,
    friends: friendDetails,
    enemies: enemyDetails,
    friendCount: friends.length,
    enemyCount: enemies.length,
    factionId: agent.factionId || null,
  };
}

function buildMemoryHistory(agent) {
  const mem = Array.isArray(agent.memory) ? agent.memory : [];
  return mem.slice(-REL_HISTORY_CAP).map((m) => ({
    tick: m.tick,
    type: m.type,
    note: m.note || m.message || '',
    with: m.with,
  }));
}

function enrichAgent(agent, focus) {
  // Attach observation panel fields directly on the agent for UI bindings
  agent.observation = {
    thought: focus.thought,
    needs: focus.needs,
    relations: focus.relations,
    history: focus.history,
    state: focus.state,
    goal: focus.goal,
  };
  // Mirror common panel keys
  agent.panelThought = focus.thought;
  agent.panelNeeds = focus.needs;
  agent.panelRelations = focus.relations.summary;
}

function trackThought(world, agent) {
  const thought = agent.thought || '';
  const last = _observer.thoughtLog[_observer.thoughtLog.length - 1];
  if (!last || last.thought !== thought || last.agentId !== agent.id) {
    _observer.thoughtLog.push({
      tick: world.tick | 0,
      agentId: agent.id,
      thought,
      state: agent.state || 'idle',
    });
    if (_observer.thoughtLog.length > 40) {
      _observer.thoughtLog.splice(0, _observer.thoughtLog.length - 40);
    }
  }
}

function clearFocus(world) {
  world.observerFocus = null;
  _observer.lastFocusId = null;
}

export function initObserver(world) {
  _observer = { lastFocusId: null, thoughtLog: [] };
  if (world) {
    world.observerFocus = world.observerFocus || null;
  }
  console.log('[Observer] initialized');
}

export function updateObserver(world) {
  if (!world) return;

  const focusId = resolveFocusId(world);
  if (focusId == null) {
    clearFocus(world);
    return;
  }

  const agent = findAgent(world, focusId);
  if (!agent || (agent.hp != null && agent.hp <= 0)) {
    world.observerFocus = {
      agentId: focusId,
      thought: 'No living subject under observation.',
      needs: null,
      relations: { summary: '—', friends: [], enemies: [] },
      history: [],
      missing: true,
    };
    return;
  }

  if (_observer.lastFocusId !== focusId) {
    _observer.thoughtLog = [];
    _observer.lastFocusId = focusId;
  }

  trackThought(world, agent);

  const needs = snapshotNeeds(agent);
  const relations = buildRelations(world, agent);
  const history = buildMemoryHistory(agent);

  // Merge recent thought stream into history view
  const thoughtHistory = _observer.thoughtLog
    .filter((t) => t.agentId === agent.id)
    .slice(-12)
    .map((t) => ({
      tick: t.tick,
      type: 'thought',
      note: t.thought,
      state: t.state,
    }));

  const combinedHistory = [...history, ...thoughtHistory]
    .sort((a, b) => (a.tick || 0) - (b.tick || 0))
    .slice(-REL_HISTORY_CAP);

  const focus = {
    agentId: agent.id,
    name: agent.name || String(agent.id),
    role: agent.role || 'wanderer',
    thought: agent.thought || '…',
    goal: agent.goal || '',
    state: agent.state || 'idle',
    hp: typeof agent.hp === 'number' ? agent.hp : 100,
    money: Math.round((agent.money || 0) * 100) / 100,
    position: {
      x: Math.round(agent.x * 100) / 100,
      y: Math.round(agent.y * 100) / 100,
    },
    needs,
    relations,
    history: combinedHistory,
    personality: agent.personality || null,
    inventory: agent.inventory || null,
    emoji: agent.emoji || '',
    color: agent.color || '',
    missing: false,
  };

  world.observerFocus = focus;
  enrichAgent(agent, focus);

  // Nearby context for the panel
  const nearby = [];
  for (const other of world.agents || []) {
    if (!other || other.id === agent.id) continue;
    if (other.hp != null && other.hp <= 0) continue;
    const dx = other.x - agent.x;
    const dy = other.y - agent.y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= 9) {
      nearby.push({
        id: other.id,
        name: other.name || String(other.id),
        dist: Math.round(Math.sqrt(d2) * 10) / 10,
        relation: (agent.friends || []).includes(other.id)
          ? 'friend'
          : (agent.enemies || []).includes(other.id)
            ? 'enemy'
            : 'neutral',
      });
    }
  }
  nearby.sort((a, b) => a.dist - b.dist);
  world.observerFocus.nearby = nearby.slice(0, 6);
}
