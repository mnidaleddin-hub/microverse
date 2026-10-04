const BACKEND_URL = "https://microverse-backend.onrender.com";
const GRID_SIZE = 40;
const CELL_SIZE = 16; // Pixels per cell
const MAP_WIDTH = GRID_SIZE * CELL_SIZE;
const MAP_HEIGHT = GRID_SIZE * CELL_SIZE;

// PIXI Application setup
const app = new PIXI.Application({
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    backgroundColor: 0xcccccc,
    antialias: true,
});

document.getElementById('game-container').appendChild(app.view);

// Global state
let worldData = null;
const mapContainer = new PIXI.Container();
const agentsContainer = new PIXI.Container();
const agentSprites = new Map(); // Map agent_id to PIXI.Graphics object
let eventSource = null;
let currentTick = 0;
const eventLog = [];
const MAX_EVENT_LOG = 20;

// Append containers to stage
app.stage.addChild(mapContainer);
app.stage.addChild(agentsContainer);

// --- Map Rendering ---
const CELL_COLORS = {
    0: 0x7cb342, // grass
    1: 0x1976d2, // water
    2: 0x8d6e63, // farmland
    3: 0x2e7d32, // forest
};

function drawMap(gridData) {
    mapContainer.removeChildren(); // Clear existing map

    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const cell = gridData[y][x];
            const cellGraphics = new PIXI.Graphics();

            // Draw base cell color
            cellGraphics.beginFill(CELL_COLORS[cell.type] || 0xcccccc);
            cellGraphics.drawRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
            cellGraphics.endFill();

            // Draw crop growth indicator
            if (cell.crop_growth > 0) {
                const cropSize = CELL_SIZE * cell.crop_growth; // Scale crop size with growth
                const cropOffset = (CELL_SIZE - cropSize) / 2;
                cellGraphics.beginFill(0xffff00); // Yellow for crop
                cellGraphics.drawRect(
                    x * CELL_SIZE + cropOffset,
                    y * CELL_SIZE + cropOffset,
                    cropSize,
                    cropSize
                );
                cellGraphics.endFill();
            }
            mapContainer.addChild(cellGraphics);
        }
    }
}

// --- Agent Rendering ---
function drawAgent(agentData) {
    let agentGraphic = agentSprites.get(agentData.id);

    if (!agentGraphic) {
        agentGraphic = new PIXI.Container(); // Use a container to group circle, halo, text
        agentGraphic.interactive = true;
        agentGraphic.buttonMode = true;
        agentGraphic.on('pointerdown', () => showAgentDetails(agentData));
        agentsContainer.addChild(agentGraphic);
        agentSprites.set(agentData.id, agentGraphic);

        // Create agent circle
        const circle = new PIXI.Graphics();
        agentGraphic.addChild(circle);
        agentGraphic.circle = circle; // Store reference

        // Create name text
        const nameText = new PIXI.Text(agentData.name, {
            fontSize: 10,
            fill: 0xffffff,
            align: 'center',
        });
        nameText.anchor.set(0.5, 1.5); // Position above the agent circle
        agentGraphic.addChild(nameText);
        agentGraphic.nameText = nameText; // Store reference

        // Create halo for pregnancy
        const halo = new PIXI.Graphics();
        agentGraphic.addChild(halo);
        agentGraphic.halo = halo; // Store reference

    }

    // Update agent circle color based on gender
    agentGraphic.circle.clear();
    agentGraphic.circle.beginFill(agentData.gender === 'male' ? 0x2196f3 : 0xe91e63); // Blue for male, pink for female
    agentGraphic.circle.drawCircle(0, 0, 6); // 6px radius
    agentGraphic.circle.endFill();

    // Update halo for pregnancy
    agentGraphic.halo.clear();
    if (agentData.pregnant_ticks > 0) {
        agentGraphic.halo.lineStyle(2, 0xffd700); // Golden halo
        agentGraphic.halo.drawCircle(0, 0, 9); // Slightly larger than agent circle
    }

    // Update name text
    agentGraphic.nameText.text = agentData.name;

    // Set target position for interpolation
    agentGraphic.targetX = (agentData.x + 0.5) * CELL_SIZE;
    agentGraphic.targetY = (agentData.y + 0.5) * CELL_SIZE;

    // If agent is new or has no current position, set it immediately
    if (typeof agentGraphic.x === 'undefined' || typeof agentGraphic.y === 'undefined') {
        agentGraphic.x = agentGraphic.targetX;
        agentGraphic.y = agentGraphic.targetY;
    }
}

// Linear interpolation for smooth movement
app.ticker.add(() => {
    agentSprites.forEach(agentGraphic => {
        if (agentGraphic.targetX !== undefined && agentGraphic.targetY !== undefined) {
            // Simple lerp. Adjust the interpolation factor for speed.
            const lerpFactor = 0.1; // Smaller value = smoother/slower movement
            agentGraphic.x += (agentGraphic.targetX - agentGraphic.x) * lerpFactor;
            agentGraphic.y += (agentGraphic.targetY - agentGraphic.y) * lerpFactor;
        }
    });
});

// --- Backend Communication ---
async function fetchInitialWorldData() {
    try {
        const response = await fetch(`${BACKEND_URL}/api/world/init`);
        const data = await response.json();
        worldData = data; // Store initial world data
        drawMap(data.map);
        data.agents.forEach(agent => drawAgent(agent));
        updateSidebar(data.tick, data.agents.length);
    } catch (error) {
        console.error("Error fetching initial world data:", error);
    }
}

function setupSSE() {
    if (eventSource) {
        eventSource.close();
    }
    eventSource = new EventSource(`${BACKEND_URL}/api/world/stream`);

    eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.tick !== undefined) {
            currentTick = data.tick;
        }

        if (data.agents_delta) {
            data.agents_delta.forEach(agentDelta => {
                let agentGraphic = agentSprites.get(agentDelta.id);
                if (agentGraphic) {
                    // Update target position for existing agent
                    agentGraphic.targetX = (agentDelta.x + 0.5) * CELL_SIZE;
                    agentGraphic.targetY = (agentDelta.y + 0.5) * CELL_SIZE;

                    // Update agent data (e.g., pregnant_ticks, gender, name if changed)
                    // This is a simplified approach; in a real app, you might merge data more carefully.
                    const currentAgentData = worldData.agents.find(a => a.id === agentDelta.id);
                    if (currentAgentData) {
                        Object.assign(currentAgentData, agentDelta);
                        drawAgent(currentAgentData); // Redraw to update visual attributes like halo/color
                    }
                } else {
                    // New agent, fetch full details if necessary or assume delta has enough for basic draw
                    // For now, let's assume agentDelta is enough to draw basic agent
                    drawAgent(agentDelta); // This might not have all details for popup, will need full data on click
                }
            });
            // Update agent count in sidebar
            updateSidebar(currentTick, agentSprites.size);
        }

        if (data.new_events) {
            data.new_events.forEach(event => addEventToLog(event));
        }


    };

    eventSource.onerror = (error) => {
        console.error("EventSource failed:", error);
        eventSource.close();
    };
}

// --- Control Panel ---
async function sendControlCommand(action, value = null) {
    try {
        const payload = { action: action };
        if (value !== null) {
            payload.value = value;
        }
        const response = await fetch(`${BACKEND_URL}/api/world/control`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            console.error("Control command failed:", response.statusText);
        }
        // After reset, re-fetch initial data to refresh state
        if (action === 'reset') {
            await fetchInitialWorldData();
            setupSSE(); // Re-establish SSE connection
        }
    } catch (error) {
        console.error("Error sending control command:", error);
    }
}

document.getElementById('pause-btn').addEventListener('click', () => sendControlCommand('pause'));
document.getElementById('resume-btn').addEventListener('click', () => sendControlCommand('resume'));
document.getElementById('speed-10x-btn').addEventListener('click', () => sendControlCommand('set_speed', 0.1));
document.getElementById('speed-1x-btn').addEventListener('click', () => sendControlCommand('set_speed', 1.0));
document.getElementById('speed-100x-btn').addEventListener('click', () => sendControlCommand('set_speed', 0.01));
document.getElementById('reset-btn').addEventListener('click', async () => {
    await sendControlCommand('reset');
    // Clear agent sprites and map graphics after reset
    agentsContainer.removeChildren();
    agentSprites.clear();
    mapContainer.removeChildren();
    eventLog.length = 0;
    updateSidebar(0, 0);
});

// --- Sidebar Panel ---
function updateSidebar(tick, agentCount) {
    document.getElementById('current-tick').textContent = tick;
    document.getElementById('agent-count').textContent = agentCount;
}

function addEventToLog(event) {
    eventLog.unshift(event); // Add to the beginning
    if (eventLog.length > MAX_EVENT_LOG) {
        eventLog.pop(); // Remove oldest event
    }

    const eventLogElement = document.getElementById('event-log');
    eventLogElement.innerHTML = ''; // Clear current log
    eventLog.forEach(e => {
        const li = document.createElement('li');
        li.textContent = `Tick ${e.tick}: ${e.text || e.event_type || 'event'}`; // Assuming event has tick and description
        eventLogElement.appendChild(li);
    });
}

// --- Agent Details Popup ---
const agentDetailsPopup = document.getElementById('agent-details-popup');
const closeButton = agentDetailsPopup.querySelector('.close-button');

function showAgentDetails(agent) {
    document.getElementById('detail-name').textContent = agent.name;
    document.getElementById('detail-gender').textContent = agent.gender;
    document.getElementById('detail-age').textContent = agent.age || 'N/A'; // Assuming age might not always be present
    document.getElementById('detail-state').textContent = agent.state || 'N/A';

    // Relationships - simple display for now
    const relationshipsElement = document.getElementById('detail-relationships');
    if (agent.relationships && Object.keys(agent.relationships).length > 0) {
        relationshipsElement.textContent = Object.entries(agent.relationships)
            .map(([id, rel]) => `${worldData.agents.find(a => a.id === id)?.name || id}: ${rel.type}`) // Display name and type
            .join(', ');
    } else {
        relationshipsElement.textContent = 'None';
    }

    // Stat bars
    const stats = {
        hp: { element: document.getElementById('detail-hp'), color: '#4CAF50' },
        hunger: { element: document.getElementById('detail-hunger'), color: '#FFC107' },
        energy: { element: document.getElementById('detail-energy'), color: '#2196F3' },
        mood: { element: document.getElementById('detail-mood'), color: '#9C27B0' },
    };

    for (const key in stats) {
        if (agent[key] !== undefined) {
            const percentage = agent[key]; // Assuming stats are already normalized 0-1 or 0-100
            stats[key].element.style.width = `${percentage}%`;
            stats[key].element.style.backgroundColor = stats[key].color;
        } else {
            stats[key].element.style.width = '0%';
        }
    }

    agentDetailsPopup.style.display = 'block';
}

closeButton.addEventListener('click', () => {
    agentDetailsPopup.style.display = 'none';
});

// Close popup if clicked outside
window.addEventListener('click', (event) => {
    if (event.target === agentDetailsPopup) {
        agentDetailsPopup.style.display = 'none';
    }
});

// Initial setup
fetchInitialWorldData();
setupSSE();
