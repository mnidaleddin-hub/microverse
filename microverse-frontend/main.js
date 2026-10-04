/* ============================================================
   MAIN.JS — MICROVERSE v2 FRONTEND MASTERPIECE
   ------------------------------------------------------------
   Architecture (6 Managers + 2 Effects):
   [1] CameraManager      — Zoom (Pivot) + Pan (Drag) + Follow Agent
   [2] SpriteFactory      — Full Agent Sprite + ChatBubble + Hop (Breathing)
   [3] DayNightManager    — 1440-tick Cycle + ColorMatrixFilter + MULTIPLY Overlay
   [4] WeatherManager     — ParticleContainer (shared Texture) — Rain / Snow / Leaves
   [5] SoundManager       — Howler.js — Muted by default, plays harvest/birth/rain
   [6] StatsManager       — Chart.js (3 lines) + Minimap (120x120 2D canvas)
   [E] ScreenEffects      — Screen Shake (birth/storm) + Vignette (depth)
   ============================================================
   MICRO-ADJUSTMENTS (Qwen):
   A) app.ticker -> LERP/HOP/DAYNIGHT/WEATHER/SHAKE every 60FPS.
      SSE -> ONLY updates state targets / agent deltas (no visuals inline).
   B) chat_bubble_text === null in AgentDelta => hide bubble immediately.
   C) ParticleContainer -> ONE shared WHITE texture per weather type
      (generated procedurally once via mini canvas + Texture.from(...))
   ============================================================ */

'use strict';

// ============================================================
// GLOBAL CONSTANTS
// ============================================================
// اختيار تلقائي للـ Backend: localhost للاختبار المحلي، Render للإنتاج
const _IS_LOCAL = (typeof location !== "undefined") && (location.hostname === "localhost" || location.hostname === "127.0.0.1");
const BACKEND_URL = _IS_LOCAL ? "http://127.0.0.1:8000" : "https://microverse-backend.onrender.com";
const GRID_SIZE = 40;
const CELL_SIZE = 16;
const MAP_WIDTH = GRID_SIZE * CELL_SIZE;   // 640
const MAP_HEIGHT = GRID_SIZE * CELL_SIZE;  // 640
const MAX_EVENT_LOG = 35;

// Tick/cycle parameters
const DAY_LENGTH_TICKS = 1440;             // 24 in-world hours = 1 real minute @ 1x (approx)
const STATS_BUFFER_SIZE = 60;              // 60 points in Chart.js

console.log("🌍 [BOOT] Microverse v2 Frontend initializing...");

// ============================================================
// PIXI APPLICATION + WORLD HIERARCHY
// ============================================================
const app = new PIXI.Application({
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    backgroundColor: 0x06120b,
    antialias: true,
});
document.getElementById('game-container').appendChild(app.view);

// WorldContainer يحتوي على كل شيء (يلتف حوله Zoom/Pan/Shake)
const worldContainer = new PIXI.Container();
app.stage.addChild(worldContainer);

// طبقات Render (من الأسفل إلى الأعلى)
const mapBaseContainer = new PIXI.Container();        // ألوان التايلات الأساسية + borders
const mapDetailContainer = new PIXI.Container();      // الأشجار، المحاصيل، موجات الماء
const weatherParticleLayer = new PIXI.Container();    // طبقة الجزيئات فوق البيئة لكن تحت الكائنات
const agentsContainer = new PIXI.Container();         // كائنات AI
const overlayFxLayer = new PIXI.Container();          // (DayNight overlay + Vignette فوق الكائنات)

worldContainer.addChild(mapBaseContainer);
worldContainer.addChild(mapDetailContainer);
worldContainer.addChild(weatherParticleLayer);
worldContainer.addChild(agentsContainer);

// هذه الطبقة خارج worldContainer مباشرة لكي لا تتأثر بـ Shake/Zoom
const screenOverlayLayer = new PIXI.Container();
app.stage.addChild(screenOverlayLayer);

// ============================================================
// GLOBAL STATE (خانات عالمية مشتركة بين الـ Managers)
// ============================================================
let worldData = null;
let cachedGrid = [];                              // 2D grid array
const agentsCache = new Map();                     // id -> latest agent object
const agentSprites = new Map();                    // id -> agent container (visual)
let currentTick = 0;
let selectedAgentId = null;
let hoveredAgentId = null;
let currentSpeedValue = 1.0;
const eventLog = [];

// حالة العالم التالية (يتم تحديثها من SSE field world_update أو محلياً)
let currentSeason = 'spring';   // spring/summer/autumn/winter
let currentWeather = 'clear';   // clear/rain/snow

// Color palette fixed (single definition)
const CELL_COLORS = {
    0: { base: 0x6aa83a, alt: 0x78b542 },  // grass
    1: { base: 0x1976d2, alt: 0x1e88e5 },  // water
    2: { base: 0x8d6e63, alt: 0x795548 },  // farmland
    3: { base: 0x2e7d32, alt: 0x388e3c },  // forest
};

// Skin/hair palettes
const SKIN_TONES = [0xffdbac, 0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524];
const HAIR_COLORS = [0x3e2723, 0x1b1b1b, 0x6d4c41, 0xffb74d, 0x4e342e, 0x5d4037];

// State icons above agent head
const STATE_ICONS = {
    sleeping: '😴', eating: '🍕', walking: '🚶', idle: '',
    farming: '🌾', pregnant: '🤰', dead: '💀'
};

// ============================================================
// ===============  [1] ===== CAMERA MANAGER =================
// وظيفته: Zoom (Towards Cursor) + Pan (Drag) + Follow Selected Agent
// ============================================================
const CameraManager = (function () {
    const MIN_ZOOM = 0.5;
    const MAX_ZOOM = 2.4;
    const ZOOM_STEP = 0.15;
    let currentZoom = 1.0;
    let followAgentId = null;

    // حالة Pan (سحب بالماوس)
    let panOffsetX = 0, panOffsetY = 0;
    let isPanning = false;
    let panStartX = 0, panStartY = 0, panStartOffX = 0, panStartOffY = 0;

    function _applyTransform() {
        worldContainer.scale.set(currentZoom);
        worldContainer.pivot.set(MAP_WIDTH / 2 - panOffsetX, MAP_HEIGHT / 2 - panOffsetY);
        worldContainer.x = app.screen.width / 2;
        worldContainer.y = app.screen.height / 2;
        document.getElementById('zoom-level').textContent = Math.round(currentZoom * 100) + '%';
    }

    function zoomAt(screenX, screenY, deltaFactor) {
        // تحويل نقطة الشاشة إلى نقطة داخل world قبل التكبير
        const localBefore = worldContainer.toLocal({ x: screenX, y: screenY });
        currentZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, currentZoom * deltaFactor));
        _applyTransform();
        // إعادة حساب بعد التكبير، وضبط Pan بحيث تبقى النقطة تحت المؤشر
        const localAfter = worldContainer.toLocal({ x: screenX, y: screenY });
        const dx = (localAfter.x - localBefore.x) * currentZoom;
        const dy = (localAfter.y - localBefore.y) * currentZoom;
        panOffsetX -= dx / currentZoom;
        panOffsetY -= dy / currentZoom;
        _applyTransform();
        console.log(`🔍 [Camera] Zoom ${deltaFactor>1?'IN':'OUT'} → ${Math.round(currentZoom*100)}%`);
    }

    function zoomIn()  { zoomAt(app.screen.width/2, app.screen.height/2, 1 + ZOOM_STEP); }
    function zoomOut() { zoomAt(app.screen.width/2, app.screen.height/2, 1 - ZOOM_STEP); }
    function centerView() {
        currentZoom = 1.0; panOffsetX = 0; panOffsetY = 0; followAgentId = null;
        _updateFollowButton(false);
        _applyTransform();
        console.log("🎯 [Camera] View centered + zoom reset.");
    }

    function _updateFollowButton(active) {
        const btn = document.getElementById('follow-btn');
        if (!btn) return;
        if (active) { btn.classList.add('active'); btn.querySelector('.tool-text').textContent = 'Following'; }
        else        { btn.classList.remove('active'); btn.querySelector('.tool-text').textContent = 'Follow'; }
    }

    function toggleFollowSelected() {
        if (selectedAgentId === null) { console.log("👁️ [Camera] Follow requested but NO agent selected."); return; }
        if (followAgentId === selectedAgentId) {
            followAgentId = null;
            _updateFollowButton(false);
            console.log(`👁️ [Camera] Stopped following agent #${selectedAgentId}.`);
        } else {
            followAgentId = selectedAgentId;
            _updateFollowButton(true);
            console.log(`👁️ [Camera] Now following agent #${followAgentId}.`);
        }
    }

    // تحديث الـ Follow كل إطار (عبر Ticker) — سلس باستخدام Lerp خفيف
    function tickFrame(delta) {
        if (followAgentId !== null && agentSprites.has(followAgentId)) {
            const spr = agentSprites.get(followAgentId);
            const targetPanX = spr.x - MAP_WIDTH / 2;
            const targetPanY = spr.y - MAP_HEIGHT / 2;
            panOffsetX += (targetPanX - panOffsetX) * 0.08 * delta;
            panOffsetY += (targetPanY - panOffsetY) * 0.08 * delta;
            _applyTransform();
        }
    }

    // ربط أحداث الـ Drag
    function _bindPanEvents() {
        const gc = document.getElementById('game-container');
        gc.addEventListener('pointerdown', (e) => {
            // فقط زر الأيسر
            if (e.button !== 0) return;
            // إذا كان النقر فوق agent مباشرة فلا نبدأ Pan (الـ agent يأخذ الحدث أولاً)
            const cx = e.clientX, cy = e.clientY;
            const target = document.elementFromPoint(cx, cy);
            if (target && target.tagName && target.tagName.toLowerCase() === 'canvas') {
                isPanning = true;
                panStartX = cx; panStartY = cy;
                panStartOffX = panOffsetX; panStartOffY = panOffsetY;
                gc.classList.add('panning');
                gc.setPointerCapture?.(e.pointerId);
            }
        });
        window.addEventListener('pointermove', (e) => {
            if (!isPanning) return;
            // الطبقة مقلوبة بالإحداثيات بسبب pivot/zoom — نقسم على currentZoom للتعويض
            panOffsetX = panStartOffX + (panStartX - e.clientX) / currentZoom;
            panOffsetY = panStartOffY + (panStartY - e.clientY) / currentZoom;
            // إذا كان المستخدم يسحب يدوياً → إيقاف Follow تلقائياً
            if (followAgentId !== null) { followAgentId = null; _updateFollowButton(false); }
            _applyTransform();
        });
        window.addEventListener('pointerup', (e) => {
            if (!isPanning) return;
            isPanning = false;
            document.getElementById('game-container').classList.remove('panning');
        });

        // زوايا التكبير بالأزرار + عجلة الفأرة
        document.getElementById('zoom-in-btn').addEventListener('click', zoomIn);
        document.getElementById('zoom-out-btn').addEventListener('click', zoomOut);
        document.getElementById('zoom-center-btn').addEventListener('click', centerView);
        document.getElementById('follow-btn').addEventListener('click', toggleFollowSelected);

        document.getElementById('game-container').addEventListener('wheel', (e) => {
            e.preventDefault();
            const rect = e.currentTarget.getBoundingClientRect();
            const sx = (e.clientX - rect.left) * (app.view.width / rect.width);
            const sy = (e.clientY - rect.top)  * (app.view.height / rect.height);
            const factor = e.deltaY < 0 ? (1 + ZOOM_STEP) : (1 - ZOOM_STEP);
            zoomAt(sx, sy, factor);
        }, { passive: false });
    }

    function stopFollow() {
        if (followAgentId !== null) {
            console.log(`👁️ [Camera] Force-stop following agent #${followAgentId}.`);
            followAgentId = null;
            _updateFollowButton(false);
        }
    }

    return {
        init: function () {
            _applyTransform();
            _bindPanEvents();
        },
        tickFrame,
        centerView, zoomIn, zoomOut, toggleFollowSelected, stopFollow,
        isFollowing: () => followAgentId !== null
    };
})();

// ============================================================
// ============  [2] ===== SPRITE FACTORY ====================
// وظيفته: إنشاء + تحديث Agent Visual (Shadow/Body/Head/Hair/ChatBubble + Rings)
// كما يحفظ targetX/targetY الذي يُستخدم من قبل Ticker (الجزء A — المنفصل عن SSE)
// ============================================================
const SpriteFactory = (function () {

    function _buildChatBubble() {
        const wrap = new PIXI.Container();
        wrap.y = -34;
        const bg = new PIXI.Graphics();
        wrap.addChild(bg);
        wrap._bg = bg;
        const txt = new PIXI.Text('', {
            fontSize: 9, fill: 0x0f172a, fontWeight: 'bold',
            wordWrap: true, wordWrapWidth: 110, align: 'center',
            lineJoin: 'round'
        });
        txt.anchor.set(0.5, 1);
        wrap.addChild(txt);
        wrap._txt = txt;
        wrap.visible = false;
        return wrap;
    }
    function _updateChatBubbleVisual(wrap, text) {
        if (!text) { wrap.visible = false; return; }
        const txt = wrap._txt;
        const bg = wrap._bg;
        txt.text = text;
        const w = Math.min(120, Math.max(32, txt.width + 10));
        const h = Math.max(14, txt.height + 8);
        bg.clear();
        bg.lineStyle(1, 0x334155, 0.8);
        bg.beginFill(0xffffff, 0.96);
        bg.drawRoundedRect(-w/2, -h - 2, w, h, 5);
        // ذيل الفقاعة
        bg.moveTo(-4, -2); bg.lineTo(0, 2); bg.lineTo(4, -2);
        bg.closePath();
        bg.endFill();
        wrap.visible = true;
    }

    // إنشاء Container كامل للكائن مرة واحدة
    function createAgentVisual(initialData) {
        const sprite = new PIXI.Container();
        sprite.interactive = true;
        sprite.buttonMode = true;

        // ---- طبقات مرتبة من الأسفل للأعلى ----
        // 1) Shadow (لا يتأثر بالـ Hop/Bounce)
        const shadow = new PIXI.Graphics();
        shadow.beginFill(0x000000, 0.32);
        shadow.drawEllipse(0, 8.5, 6, 2.3);
        shadow.endFill();
        sprite.addChild(shadow); sprite.shadow = shadow;

        // 2) Rings (Hover/Selection/Pregnancy) تحت Body
        const hoverRing = new PIXI.Graphics();
        hoverRing.lineStyle(1.5, 0x00e5ff, 0.95);
        hoverRing.drawCircle(0, 0, 12.5);
        hoverRing.visible = false;
        sprite.addChildAt(hoverRing, 0);
        sprite.hoverRing = hoverRing;

        const selRing = new PIXI.Graphics();
        selRing.lineStyle(2.3, 0x00ff7a, 1);
        selRing.drawCircle(0, 0, 14);
        selRing.visible = false;
        sprite.addChildAt(selRing, 0);
        sprite.selRing = selRing;

        const pregRing = new PIXI.Graphics();
        pregRing.lineStyle(2, 0xffd54f, 0.9);
        pregRing.drawCircle(0, 0, 12.5);
        pregRing.visible = false;
        sprite.addChildAt(pregRing, 0);
        sprite.pregRing = pregRing;

        // 3) Bounce Container (تتحرك صعوداً عند Hop، وتتنفس عند السكون)
        const bounce = new PIXI.Container();
        sprite.addChild(bounce); sprite.bounce = bounce;

        // Body + Arms
        const arms = new PIXI.Graphics();
        bounce.addChild(arms); sprite.arms = arms;
        const body = new PIXI.Graphics();
        bounce.addChild(body); sprite.body = body;

        // Head + Hair + Eyes
        const head = new PIXI.Graphics();
        bounce.addChild(head); sprite.head = head;
        const hair = new PIXI.Graphics();
        bounce.addChild(hair); sprite.hair = hair;
        const eyes = new PIXI.Graphics();
        bounce.addChild(eyes); sprite.eyes = eyes;

        // State Icon (Emoji) فوق الرأس
        const stateIcon = new PIXI.Text('', { fontSize: 12 });
        stateIcon.anchor.set(0.5, 1);
        stateIcon.y = -17;
        bounce.addChild(stateIcon); sprite.stateIcon = stateIcon;

        // ChatBubble (أعلى من stateIcon)
        const cb = _buildChatBubble();
        bounce.addChild(cb);
        sprite.chat = cb;

        // NameTag (اسم تحت الكائن + stroke أسود — لا يتأثر بالـ Hop)
        const nameText = new PIXI.Text('', {
            fontSize: 9, fontWeight: 'bold',
            fill: 0xffffff,
            stroke: 0x000000, strokeThickness: 2,
        });
        nameText.anchor.set(0.5, 0);
        nameText.y = 11;
        sprite.addChild(nameText); sprite.nameText = nameText;

        // ===== Events =====
        sprite.on('pointerover', () => {
            hoveredAgentId = initialData.id;
            hoverRing.visible = true; sprite.scale.set(1.12);
            console.log(`🖱️ [Hover] Agent #${initialData.id} "${initialData.name}"`);
        });
        sprite.on('pointerout', () => {
            if (hoveredAgentId === initialData.id) hoveredAgentId = null;
            hoverRing.visible = false; sprite.scale.set(1);
        });
        sprite.on('pointerdown', (e) => {
            e.stopPropagation();
            _selectAgentInternal(initialData.id);
        });

        return sprite;
    }

    // تحديث المظهر (Body Color / Hair / Eyes / State Icon / Pregnancy / Dead tint / Chat)
    function updateAgentVisuals(sprite, a) {
        sprite.nameText.text = a.name || '???';

        const isMale = a.gender === 'male';
        const clothColor = isMale ? 0x2196f3 : 0xec407a;
        const clothShadow = isMale ? 0x1565c0 : 0xad1457;
        const skinTone = SKIN_TONES[(a.id * 3) % SKIN_TONES.length];
        const hairColor = HAIR_COLORS[a.id % HAIR_COLORS.length];

        // جسم + ظل الجسم
        sprite.body.clear();
        sprite.body.beginFill(clothShadow);
        sprite.body.drawEllipse(0, 3.2, 5.1, 6.6);
        sprite.body.endFill();
        sprite.body.beginFill(clothColor);
        sprite.body.drawEllipse(0, 1, 5, 6.5);
        sprite.body.endFill();

        // ذراعان (بلون الجلد)
        sprite.arms.clear();
        sprite.arms.lineStyle(1.3, skinTone);
        sprite.arms.moveTo(-4.6, 0.1); sprite.arms.lineTo(-5.6, 3.3);
        sprite.arms.moveTo(4.6, 0.1);  sprite.arms.lineTo(5.6, 3.3);

        // رأس + خدود
        sprite.head.clear();
        sprite.head.beginFill(skinTone);
        sprite.head.drawCircle(0, -5, 3.9);
        sprite.head.endFill();
        sprite.head.beginFill(0xffab91, 0.28);
        sprite.head.drawCircle(-2.1, -4, 0.85);
        sprite.head.drawCircle(2.1, -4, 0.85);
        sprite.head.endFill();

        // شعر (ذكور قصير، إناث طويل)
        sprite.hair.clear();
        sprite.hair.beginFill(hairColor);
        if (isMale) {
            sprite.hair.drawCircle(0, -7.3, 3.6); sprite.hair.endFill();
            sprite.hair.beginFill(hairColor);
            sprite.hair.drawRect(-3.5, -9.1, 7, 2.6); sprite.hair.endFill();
        } else {
            sprite.hair.drawCircle(0, -7.1, 4.1); sprite.hair.endFill();
            sprite.hair.beginFill(hairColor);
            sprite.hair.drawRect(-4.3, -9.7, 8.6, 3.6);
            sprite.hair.drawRect(-4.6, -7, 2.6, 6.2);
            sprite.hair.drawRect(2, -7, 2.6, 6.2);
            sprite.hair.endFill();
        }

        // عيون (مغلقة عند النوم أو الموت)
        sprite.eyes.clear();
        if (a.state === 'sleeping' || a.state === 'dead') {
            sprite.eyes.lineStyle(1, 0x000000);
            sprite.eyes.moveTo(-2.3, -5.2); sprite.eyes.lineTo(-0.7, -5.2);
            sprite.eyes.moveTo(0.7, -5.2);  sprite.eyes.lineTo(2.3, -5.2);
        } else {
            sprite.eyes.beginFill(0x000000);
            sprite.eyes.drawCircle(-1.5, -5.25, 0.7);
            sprite.eyes.drawCircle(1.5, -5.25, 0.7);
            sprite.eyes.endFill();
            sprite.eyes.beginFill(0xffffff, 0.9);
            sprite.eyes.drawCircle(-1.2, -5.45, 0.25);
            sprite.eyes.drawCircle(1.8, -5.45, 0.25);
            sprite.eyes.endFill();
        }

        // أيقونة حالة (Emoji)
        const preg = !!(a.pregnant_ticks && a.pregnant_ticks > 0) || a.state === 'pregnant';
        if (a.state === 'dead') sprite.stateIcon.text = '💀';
        else if (preg) sprite.stateIcon.text = '🤰';
        else sprite.stateIcon.text = STATE_ICONS[a.state] || '';

        // حلقة الحمل + التحديد
        sprite.pregRing.visible = preg;
        sprite.selRing.visible = (selectedAgentId === a.id);

        // الموتى: تلوين رمادي + شفافية
        if (a.state === 'dead') { sprite.alpha = 0.5; sprite.tint = 0xb5b5b5; }
        else                    { sprite.alpha = 1;   sprite.tint = 0xffffff; }

        // ===== MICRO-ADJUSTMENT B =====
        // تحديث ChatBubble فوراً بناءً على chat_bubble_text.
        // إذا جاءت Delta بالقيمة null => إخفاء الفقاعة فوراً
        if (a.chat_bubble_text !== undefined) {
            if (a.chat_bubble_text === null || a.chat_bubble_text === '') {
                _updateChatBubbleVisual(sprite.chat, null);
            } else {
                _updateChatBubbleVisual(sprite.chat, a.chat_bubble_text);
            }
        }
    }

    // ===== MICRO-ADJUSTMENT A (DECUPLE RENDER FROM SSE) =====
    // هذه الدالة تُستدعى من app.ticker — كل إطار — منفصلة تماماً عن SSE
    function updatePerFrame(delta) {
        const lerpFactor = 0.022 * delta;   // بطيء وسلس
        agentSprites.forEach((sprite, id) => {
            if (sprite.targetX === undefined) return;

            const prevX = sprite.x, prevY = sprite.y;
            sprite.x += (sprite.targetX - sprite.x) * lerpFactor;
            sprite.y += (sprite.targetY - sprite.y) * lerpFactor;

            // هل الكائن يتحرك حالياً؟
            const dx = Math.abs(sprite.targetX - sprite.x);
            const dy = Math.abs(sprite.targetY - sprite.y);
            const movedThisFrame = Math.hypot(sprite.x - prevX, sprite.y - prevY);
            const isMoving = (dx > 0.2 || dy > 0.2) && movedThisFrame > 0.01;

            // 1) Hop Animation (قفز طفيف عند الحركة عبر sin)
            if (isMoving) {
                sprite._hopPhase = (sprite._hopPhase || 0) + 0.3 * delta;
                const hopHeight = Math.abs(Math.sin(sprite._hopPhase)) * 2.9;
                sprite.bounce.y = -hopHeight;
                const squish = 1 - (hopHeight / 12);
                sprite.shadow.scale.set(squish, squish);
                sprite.shadow.alpha = 0.32 * squish;
            } else {
                sprite._hopPhase = 0;
                sprite.bounce.y += (0 - sprite.bounce.y) * 0.25 * delta;
                sprite.shadow.scale.x += (1 - sprite.shadow.scale.x) * 0.25 * delta;
                sprite.shadow.scale.y += (1 - sprite.shadow.scale.y) * 0.25 * delta;
                sprite.shadow.alpha   += (0.32 - sprite.shadow.alpha) * 0.25 * delta;
            }

            // 2) Breathing (تنفس طفيف عند السكون — scale 0.985..1.015)
            sprite._breathPhase = (sprite._breathPhase || Math.random()*6.28) + 0.04 * delta;
            if (!isMoving) {
                const b = 1 + Math.sin(sprite._breathPhase) * 0.014;
                sprite.bounce.scale.set(b, b + Math.sin(sprite._breathPhase) * 0.008);
            } else {
                sprite.bounce.scale.x += (1 - sprite.bounce.scale.x) * 0.2 * delta;
                sprite.bounce.scale.y += (1 - sprite.bounce.scale.y) * 0.2 * delta;
            }
        });
    }

    // واجهة عالية المستوى: إنشاء أو تحديث
    function drawAgent(agentData) {
        agentsCache.set(agentData.id, agentData);
        let sprite = agentSprites.get(agentData.id);
        if (!sprite) {
            sprite = createAgentVisual(agentData);
            agentSprites.set(agentData.id, sprite);
            agentsContainer.addChild(sprite);
            console.log(`👤 [SpriteFactory] Created visual for agent #${agentData.id} "${agentData.name}"`);
        }
        updateAgentVisuals(sprite, agentData);

        // ضبط هدف الـ Lerp (الإحداثيات نقطية للتايل)
        if (agentData.x !== undefined && agentData.y !== undefined) {
            sprite.targetX = (agentData.x + 0.5) * CELL_SIZE;
            sprite.targetY = (agentData.y + 0.5) * CELL_SIZE;
            if (sprite._initialized !== true) {
                sprite.x = sprite.targetX;
                sprite.y = sprite.targetY;
                sprite._initialized = true;
                console.log(`📍 [SpriteFactory] Snap #${agentData.id} → (${agentData.x}, ${agentData.y})`);
            }
        }
    }

    return { createAgentVisual, updateAgentVisuals, drawAgent, updatePerFrame };
})();

// إجراء داخلي لـ selectAgent (يستدعيه الـ SpriteFactory عند النقر فوق الكائن)
function _selectAgentInternal(id) {
    const prev = selectedAgentId;
    selectedAgentId = id;
    if (prev !== null && agentSprites.has(prev)) agentSprites.get(prev).selRing.visible = false;
    if (selectedAgentId !== null && agentSprites.has(selectedAgentId)) agentSprites.get(selectedAgentId).selRing.visible = true;
    const agent = agentsCache.get(id);
    if (agent) {
        console.log(`✅ [Selection] #${id} ${agent.name} — ${agent.state} @(${agent.x},${agent.y})`);
        showAgentDetails(agent);
    }
}
// النقر فوق منطقة فارغة → إلغاء التحديد
app.stage.eventMode = 'static';
app.stage.hitArea = app.screen;
app.stage.on('pointerdown', (e) => {
    if (e.target === app.stage && selectedAgentId !== null) {
        console.log("👆 [Selection] Deselected (clicked empty stage).");
        if (agentSprites.has(selectedAgentId)) agentSprites.get(selectedAgentId).selRing.visible = false;
        selectedAgentId = null;
    }
});

// ============================================================
// ========  [3] ===== DAY/NIGHT MANAGER =====================
// وظيفته: Night Overlay MULTIPLY + ColorMatrixFilter (دفء الألوان)
// يعتمد على currentTick ويُحدث كل إطار عبر Ticker
// ============================================================
const DayNightManager = (function () {
    // 1) Night overlay — يغطي الشاشة ويعمل MULTIPLY (يغمق الأصقاع ولا يضيءها)
    const nightOverlay = new PIXI.Graphics();
    nightOverlay.blendMode = PIXI.BLEND_MODES.MULTIPLY;
    screenOverlayLayer.addChild(nightOverlay);

    // 2) ColorMatrixFilter على كل العالم — يغيّر دفء الألوان
    const colorMatrix = new PIXI.filters.ColorMatrixFilter();
    worldContainer.filters = [colorMatrix];

    function _updateClockUI(dayProgress01) {
        const hour24 = Math.floor(dayProgress01 * 24);
        const minute = Math.floor((dayProgress01 * 24 * 60) % 60);
        const dayNum = Math.floor(currentTick / DAY_LENGTH_TICKS) + 1;
        const hh = String(hour24).padStart(2, '0');
        const mm = String(minute).padStart(2, '0');
        document.getElementById('clock-text').textContent = `Day ${dayNum} · ${hh}:${mm}`;

        // أيقونة الوقت
        let icon = '☀️';
        if (hour24 >= 6 && hour24 < 8)       icon = '🌅';   // غروب/شروق
        else if (hour24 >= 8 && hour24 < 17) icon = '☀️';
        else if (hour24 >= 17 && hour24 < 20) icon = '🌇';
        else                                  icon = '🌙';
        document.getElementById('clock-icon').textContent = icon;
    }

    function tickFrame(delta) {
        // حساب التقدم في اليوم 0..1
        const dayProgress = (currentTick % DAY_LENGTH_TICKS) / DAY_LENGTH_TICKS;

        // سطوع الليل — المنحنى صفر نهاراً و 1 ليلاً (أهدأ قليلاً عند منتصف النهار)
        // 0 = midnight, 0.5 = noon
        const darkness = 0.5 - Math.cos(dayProgress * Math.PI * 2) * 0.5; // 0..1 منحني جميل
        const nightAlpha = 0.08 + Math.max(0, (darkness - 0.35)) * 1.25;   // تقريباً 0 عند 10 صباحاً

        // لون الـ overlay (برتقالي غامق عند الغروب، أزرق بارد ليلاً)
        let r = 255, g = 255, b = 255;
        if (darkness < 0.35) {           // نهار
            r = 255; g = 255; b = 255;
        } else if (darkness < 0.55) {    // غروب/شروق
            const t = (darkness - 0.35) / 0.2;
            r = 255; g = Math.floor(255 * (1 - t * 0.55)); b = Math.floor(255 * (1 - t * 0.8));
        } else if (darkness < 0.8) {     // ليل بارد
            const t = (darkness - 0.55) / 0.25;
            r = Math.floor(255 * (0.45 + 0.2 * (1 - t)));
            g = Math.floor(255 * (0.5 + 0.1 * (1 - t)));
            b = 255;
        } else {                          // منتصف الليل
            r = 95; g = 110; b = 170;
        }

        // رسم overlay
        nightOverlay.clear();
        nightOverlay.beginFill((r << 16) | (g << 8) | b, Math.min(0.72, Math.max(0.05, nightAlpha)));
        nightOverlay.drawRect(0, 0, app.screen.width, app.screen.height);
        nightOverlay.endFill();

        // ColorMatrix (PixiJS v7 APIs قياسية فقط): hue shift + saturation + brightness
        const warmBoost = (darkness > 0.35 && darkness < 0.6)
            ? Math.sin((darkness - 0.35) / 0.25 * Math.PI) * 0.12 : 0;
        const coolBoost = (darkness > 0.65) ? ((darkness - 0.65) / 0.35) * 0.12 : 0;
        colorMatrix.reset();
        if (warmBoost > 0) {
            colorMatrix.hue(-32 * warmBoost, false);          // إزاحة نحو الحمرة (برتقالي الغروب)
            colorMatrix.saturation(1 + warmBoost * 1.1, true);
        }
        if (coolBoost > 0) {
            colorMatrix.hue(26 * coolBoost, false);           // إزاحة نحو الأزرق (برودة الليل)
            colorMatrix.saturation(1 - coolBoost * 0.6, true);
        }
        // خفف سطوع كامل قليلاً ليلاً
        const brightnessMul = 1.0 - Math.max(0, (darkness - 0.4)) * 0.18;
        colorMatrix.brightness(brightnessMul, true);

        _updateClockUI(dayProgress);
    }

    return { tickFrame, init: function () { _updateClockUI(0.5); } };
})();

// ============================================================
// =========  [4] ===== WEATHER MANAGER ======================
// وظيفته: طبقة الجزيئات (Rain/Snow/Autumn Leaves) عبر ParticleContainer.
// MICRO-ADJUSTMENT C: ننشئ NASS TEXTURE موحدة لكل نوع (مُولدة على canvas).
// ============================================================
const WeatherManager = (function () {
    const PARTICLE_RAIN_COUNT = 480;
    const PARTICLE_SNOW_COUNT = 260;
    const PARTICLE_LEAF_COUNT = 220;

    let pcRain = null, pcSnow = null, pcLeaves = null;
    const allParticles = { rain: [], snow: [], leaves: [] };

    // === إنشاء Texture واحدة بيضاء لكل نوع عبر mini offscreen canvas ===
    function _makeTexture(drawFn, w, h) {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        drawFn(ctx, w, h);
        return PIXI.Texture.from(c);
    }
    const TEX_RAIN = _makeTexture((ctx, w, h) => {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
    }, 2, 8);
    const TEX_SNOW = _makeTexture((ctx, w, h) => {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(w/2, h/2, w/2, 0, Math.PI * 2);
        ctx.fill();
    }, 6, 6);
    const TEX_LEAF = _makeTexture((ctx, w, h) => {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.ellipse(w/2, h/2, w/2 - 0.5, h/2 - 0.5, 0.5, 0, Math.PI * 2);
        ctx.fill();
    }, 7, 5);

    function _ensureContainers() {
        if (!pcRain) {
            pcRain = new PIXI.ParticleContainer(PARTICLE_RAIN_COUNT, {
                position: true, rotation: true, scale: false, uvs: false, alpha: true, tint: true
            });
            weatherParticleLayer.addChild(pcRain);
            pcRain.visible = false;
            for (let i = 0; i < PARTICLE_RAIN_COUNT; i++) {
                const s = new PIXI.Sprite(TEX_RAIN);
                s.tint = 0x89c2ff;
                s.alpha = 0.78;
                s.rotation = -0.28;
                s.x = Math.random() * MAP_WIDTH;
                s.y = Math.random() * MAP_HEIGHT;
                s._vx = -0.9; s._vy = 9 + Math.random() * 6;
                allParticles.rain.push(s);
                pcRain.addChild(s);
            }
        }
        if (!pcSnow) {
            pcSnow = new PIXI.ParticleContainer(PARTICLE_SNOW_COUNT, {
                position: true, rotation: true, scale: false, uvs: false, alpha: true, tint: true
            });
            weatherParticleLayer.addChild(pcSnow);
            pcSnow.visible = false;
            for (let i = 0; i < PARTICLE_SNOW_COUNT; i++) {
                const s = new PIXI.Sprite(TEX_SNOW);
                s.tint = 0xffffff;
                s.alpha = 0.88;
                s.x = Math.random() * MAP_WIDTH;
                s.y = Math.random() * MAP_HEIGHT;
                s._vx = (Math.random() - 0.5) * 0.7;
                s._vy = 0.8 + Math.random() * 1.2;
                s._driftPhase = Math.random() * 6.28;
                allParticles.snow.push(s);
                pcSnow.addChild(s);
            }
        }
        if (!pcLeaves) {
            pcLeaves = new PIXI.ParticleContainer(PARTICLE_LEAF_COUNT, {
                position: true, rotation: true, scale: false, uvs: false, alpha: true, tint: true
            });
            weatherParticleLayer.addChild(pcLeaves);
            pcLeaves.visible = false;
            const leafTints = [0xe08a3e, 0xc75b2a, 0xd35400, 0xf39c12, 0xb43d1a];
            for (let i = 0; i < PARTICLE_LEAF_COUNT; i++) {
                const s = new PIXI.Sprite(TEX_LEAF);
                s.tint = leafTints[Math.floor(Math.random() * leafTints.length)];
                s.alpha = 0.95;
                s.x = Math.random() * MAP_WIDTH;
                s.y = Math.random() * MAP_HEIGHT;
                s._vx = (Math.random() - 0.5) * 1.6;
                s._vy = 0.6 + Math.random() * 1.2;
                s._spin = (Math.random() - 0.5) * 0.08;
                s._driftPhase = Math.random() * 6.28;
                allParticles.leaves.push(s);
                pcLeaves.addChild(s);
            }
        }
    }

    function applyWeather(weather, season) {
        _ensureContainers();
        if (weather === currentWeather && season === currentSeason) return;
        currentWeather = weather;
        currentSeason = season || currentSeason;
        const wIcon = document.getElementById('weather-icon');
        const wText = document.getElementById('weather-text');
        pcRain.visible = (weather === 'rain');
        pcSnow.visible = (weather === 'snow');
        // الأوراق المتساقطة تظهر دائماً في الخريف + طقس غائم أو صافي
        const showLeaves = (currentSeason === 'autumn');
        pcLeaves.visible = showLeaves;

        if (weather === 'clear') {
            if (currentSeason === 'spring') { wIcon.textContent = '🌱'; wText.textContent = 'Clear (Spring)'; }
            else if (currentSeason === 'summer') { wIcon.textContent = '☀️'; wText.textContent = 'Clear (Summer)'; }
            else if (currentSeason === 'autumn') { wIcon.textContent = '🍂'; wText.textContent = 'Autumn Breeze'; }
            else { wIcon.textContent = '❄️'; wText.textContent = 'Clear (Winter)'; }
        } else if (weather === 'rain')  { wIcon.textContent = '🌧️'; wText.textContent = 'Raining'; ScreenEffects.shake(2, 22); SoundManager.play('rain_start'); }
        else if (weather === 'snow')  { wIcon.textContent = '🌨️'; wText.textContent = 'Snowing'; ScreenEffects.shake(1.5, 18); SoundManager.play('rain_start'); }

        console.log(`🌦️ [Weather] Changed → season=${currentSeason}, weather=${currentWeather}`);
    }

    // تحديث موقع الجزيئات كل إطار (Ticker)
    function tickFrame(delta) {
        _ensureContainers();
        if (pcRain.visible) {
            allParticles.rain.forEach(s => {
                s.x += s._vx * delta;
                s.y += s._vy * delta;
                if (s.y > MAP_HEIGHT + 10) { s.y = -10; s.x = Math.random() * MAP_WIDTH; }
                if (s.x < -10) s.x = MAP_WIDTH + 10;
            });
        }
        if (pcSnow.visible) {
            allParticles.snow.forEach(s => {
                s._driftPhase += 0.03 * delta;
                s.x += (s._vx + Math.sin(s._driftPhase) * 0.45) * delta;
                s.y += s._vy * delta;
                if (s.y > MAP_HEIGHT + 10) { s.y = -10; s.x = Math.random() * MAP_WIDTH; }
                if (s.x < -10) s.x = MAP_WIDTH + 10;
                if (s.x > MAP_WIDTH + 10) s.x = -10;
            });
        }
        if (pcLeaves.visible) {
            allParticles.leaves.forEach(s => {
                s._driftPhase += 0.025 * delta;
                s.x += (s._vx + Math.sin(s._driftPhase) * 0.8) * delta;
                s.y += s._vy * delta;
                s.rotation += s._spin * delta;
                if (s.y > MAP_HEIGHT + 10) { s.y = -10; s.x = Math.random() * MAP_WIDTH; }
                if (s.x < -10) s.x = MAP_WIDTH + 10;
                if (s.x > MAP_WIDTH + 10) s.x = -10;
            });
        }
    }

    return { applyWeather, tickFrame, init: _ensureContainers };
})();

// ============================================================
// ===========  [5] ===== SOUND MANAGER (Howler.js) ==========
// وظيفته: أصوات مؤثرات خفيفة harvest/birth/rain/mute.
// ممنوع Auto-Play: تبدأ muted حتى يضغط المستخدم على زر الصوت.
// نستخدم أصوات مولدة عبر Base64 WAV صغيرة جداً (أقل من 3KB إجمالاً)
// ============================================================
const SoundManager = (function () {
    let isMuted = true;
    let userHasInteracted = false;
    const sounds = {};
    const loaded = { ok: false };

    // ===== توليد أصوات صغيرة via Web Audio (بدون ملفات خارجية حتى لا نضيف assets) =====
    // إرجاع Base64 WAV 16-bit mono بسيط (بضعة آلاف بايت فقط)
    function _toneToWavDataURI(freqStart, freqEnd, durSec, type='sine', vol=0.22, fade=true) {
        const sr = 22050;
        const n = Math.floor(sr * durSec);
        const buf = new ArrayBuffer(44 + n * 2);
        const view = new DataView(buf);
        function wStr(p,s){for(let i=0;i<s.length;i++) view.setUint8(p+i,s.charCodeAt(i));}
        wStr(0,'RIFF'); view.setUint32(4, 36+n*2, true); wStr(8,'WAVE'); wStr(12,'fmt ');
        view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true);
        view.setUint32(24,sr,true); view.setUint32(28,sr*2,true); view.setUint16(32,2,true); view.setUint16(34,16,true);
        wStr(36,'data'); view.setUint32(40,n*2,true);
        for (let i = 0; i < n; i++) {
            const t = i / sr;
            const f = freqStart + (freqEnd - freqStart) * (t / durSec);
            let sample;
            if (type === 'sine') sample = Math.sin(2 * Math.PI * f * t);
            else if (type === 'square') sample = (Math.sin(2 * Math.PI * f * t) > 0 ? 1 : -1);
            else sample = (Math.random() * 2 - 1); // noise
            let amp = vol;
            if (fade) {
                const fadeIn = Math.min(1, t / 0.015);
                const fadeOut = Math.min(1, (durSec - t) / 0.08);
                amp *= fadeIn * fadeOut;
            }
            const v = Math.max(-1, Math.min(1, sample * amp));
            view.setInt16(44 + i*2, Math.floor(v * 32760), true);
        }
        // تحويل Buffer إلى DataURI
        let bin = '';
        const bytes = new Uint8Array(buf);
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return 'data:audio/wav;base64,' + btoa(bin);
    }

    function _buildAllSounds() {
        if (loaded.ok) return;
        // قمح: خفقان عالٍ سريع (harvest)
        sounds.harvest = new Howl({ src: [_toneToWavDataURI(880, 1480, 0.16, 'sine', 0.28)], volume: 0.35, html5: true, preload: true });
        // ولادة: تنبيه لطيف يرتفع ثم ينخفض
        sounds.birth = new Howl({ src: [_toneToWavDataURI(600, 1320, 0.45, 'sine', 0.34)], volume: 0.5, html5: true, preload: true });
        // بداية المطر: ضوضاء بيضاء تتلاشى (أول ثانية فقط)
        sounds.rain_start = new Howl({ src: [_toneToWavDataURI(400, 600, 0.5, 'noise', 0.14)], volume: 0.45, html5: true, preload: true });
        // زر: صفرة خفيفة
        sounds.click = new Howl({ src: [_toneToWavDataURI(1200, 1000, 0.06, 'square', 0.20)], volume: 0.28, html5: true, preload: true });
        loaded.ok = true;
        console.log("🔊 [SoundManager] Procedural audio built. All < 12KB total data URIs.");
    }

    function play(sfxName) {
        if (!userHasInteracted) return;
        if (isMuted) return;
        if (!loaded.ok) _buildAllSounds();
        if (sounds[sfxName]) {
            try { sounds[sfxName].play(); } catch (err) { console.warn("🔊 [SoundManager] Play fail:", sfxName, err); }
        }
    }

    // تفعيل الصوت بعد أول تفاعل للمستخدم (Browser Audio Policy)
    function ensureUnlocked() {
        if (!userHasInteracted) {
            userHasInteracted = true;
            _buildAllSounds();
            console.log("🔊 [SoundManager] Audio unlocked (user interacted).");
        }
    }

    function toggleMute() {
        ensureUnlocked();
        isMuted = !isMuted;
        const btn = document.getElementById('mute-btn');
        if (!btn) return;
        const textSpan = btn.querySelector('.tool-text');
        if (isMuted) {
            Howler.mute(true);
            btn.innerHTML = '🔇 <span class="tool-text">Muted</span>';
            btn.classList.remove('active');
            console.log("🔇 [SoundManager] Muted.");
        } else {
            Howler.mute(false);
            btn.innerHTML = '🔊 <span class="tool-text">Unmuted</span>';
            btn.classList.add('active');
            console.log("🔊 [SoundManager] Unmuted.");
            setTimeout(() => play('click'), 30);
        }
    }

    function _bindUI() {
        const mb = document.getElementById('mute-btn');
        if (mb) mb.addEventListener('click', () => { ensureUnlocked(); toggleMute(); });
        // أي نقرة في الصفحة = unlock
        document.addEventListener('click', ensureUnlocked, { once: false, passive: true });
        document.addEventListener('keydown', ensureUnlocked, { once: false, passive: true });
    }

    return {
        init: function () { _bindUI(); Howler.mute(true); },
        play, toggleMute, ensureUnlocked
    };
})();

// ============================================================
// ==========  [6] ===== STATS MANAGER (Charts + Minimap) ====
// وظيفته:
// - تجميع آخر 60 قيمة للإحصائيات → Chart.js 3 خطوط
// - رسم الخريطة المصغرة 120x120 كل 10 ticks فقط (TBD)
// ============================================================
const StatsManager = (function () {
    let charts = null;
    const populationHistory = [];
    const hungerHistory = [];
    const wheatHistory = [];
    const labels = [];
    let _minimapCounter = 0;
    let _chartsCounter = 0;

    function _createCharts() {
        if (charts) return;
        Chart.defaults.color = '#8f9bb6';
        Chart.defaults.borderColor = 'rgba(71, 85, 105, 0.35)';
        Chart.defaults.font.family = 'Segoe UI, Arial';
        Chart.defaults.font.size = 10;
        Chart.defaults.plugins.legend.display = false;

        function _mk(id, borderColor, bgGradientHexFrom) {
            const ctx = document.getElementById(id).getContext('2d');
            const grad = ctx.createLinearGradient(0, 0, 0, 130);
            grad.addColorStop(0, bgGradientHexFrom);
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            return new Chart(ctx, {
                type: 'line',
                data: { labels, datasets: [{
                    borderColor, data: id === 'chart-population' ? populationHistory
                               : id === 'chart-hunger' ? hungerHistory
                               : wheatHistory,
                    borderWidth: 2, fill: true, backgroundColor: grad,
                    pointRadius: 0, tension: 0.35, cubicInterpolationMode: 'monotone',
                }] },
                options: {
                    responsive: true, maintainAspectRatio: false, animation: { duration: 200 },
                    scales: {
                        x: { ticks: { display: false }, grid: { display: false } },
                        y: { ticks: { maxTicksLimit: 4, precision: 0 }, grid: { color: 'rgba(71,85,105,0.15)' } }
                    },
                    plugins: { tooltip: { enabled: true } }
                }
            });
        }

        charts = {
            population: _mk('chart-population', '#3b82f6', 'rgba(59,130,246,0.35)'),
            hunger:     _mk('chart-hunger',     '#f59e0b', 'rgba(245,158,11,0.35)'),
            wheat:      _mk('chart-wheat',      '#84cc16', 'rgba(132,204,22,0.35)'),
        };
        console.log("📊 [StatsManager] 3 live charts initialized.");
    }

    function recordSnapshot(tick) {
        const all = Array.from(agentsCache.values());
        const pop = all.filter(a => a.state !== 'dead').length;
        const aliveOnes = all.filter(a => a.state !== 'dead');
        const avgHunger = aliveOnes.length
            ? Math.round(aliveOnes.reduce((s, a) => s + (a.hunger || 0), 0) / aliveOnes.length) : 0;
        let wheat = 0;
        all.forEach(a => { wheat += (a.inventory?.wheat || 0); });

        labels.push(`T${tick}`);
        populationHistory.push(pop);
        hungerHistory.push(avgHunger);
        wheatHistory.push(wheat);
        while (labels.length > STATS_BUFFER_SIZE) labels.shift();
        while (populationHistory.length > STATS_BUFFER_SIZE) populationHistory.shift();
        while (hungerHistory.length > STATS_BUFFER_SIZE) hungerHistory.shift();
        while (wheatHistory.length > STATS_BUFFER_SIZE) wheatHistory.shift();

        if (!charts) _createCharts();
        charts.population.update('none');
        charts.hunger.update('none');
        charts.wheat.update('none');
    }

    function drawMinimap() {
        if (!cachedGrid || cachedGrid.length === 0) return;
        const cvs = document.getElementById('minimap-canvas');
        if (!cvs) return;
        const ctx = cvs.getContext('2d');
        const W = cvs.width, H = cvs.height;
        const cellW = W / GRID_SIZE, cellH = H / GRID_SIZE;
        // تدرج ألوان الخريطة
        for (let y = 0; y < GRID_SIZE; y++) {
            for (let x = 0; x < GRID_SIZE; x++) {
                const c = cachedGrid[y][x];
                const t = c.type;
                if (t === 1) ctx.fillStyle = '#1976d2';
                else if (t === 2) ctx.fillStyle = '#8d6e63';
                else if (t === 3) ctx.fillStyle = '#2e7d32';
                else ctx.fillStyle = ((x+y)%2===0) ? '#6aa83a' : '#78b542';
                ctx.fillRect(x * cellW, y * cellH, Math.ceil(cellW), Math.ceil(cellH));
                // محاصيل جاهزة = نقطة صفراء
                if (t === 2 && (c.crop_growth || 0) >= 95) {
                    ctx.fillStyle = '#fde047';
                    ctx.fillRect(x * cellW + cellW*0.3, y * cellH + cellH*0.3, cellW*0.4, cellH*0.4);
                }
            }
        }
        // نقاط الكائنات (ذكور أزرق / إناث وردي / موتى رمادي)
        agentsCache.forEach((a) => {
            const px = (a.x + 0.5) * cellW;
            const py = (a.y + 0.5) * cellH;
            ctx.beginPath();
            if (a.state === 'dead') ctx.fillStyle = '#64748b';
            else ctx.fillStyle = (a.gender === 'male') ? '#3b82f6' : '#ec4899';
            ctx.arc(px, py, Math.max(1.5, cellW * 0.45), 0, Math.PI * 2);
            ctx.fill();
            // إطار للـ agent المحدد حالياً (أخضر لامع)
            if (a.id === selectedAgentId) {
                ctx.strokeStyle = '#00ff7a';
                ctx.lineWidth = 1.3;
                ctx.beginPath();
                ctx.arc(px, py, cellW * 0.9, 0, Math.PI * 2);
                ctx.stroke();
            }
        });
        // إطار الكاميرا الحالي (مستطيل أصفر شفاف يوضح نطاق العرض الحالي)
        // نحسب المنطقة الظاهرة حاليًا عبر worldContainer transform
        try {
            const tl = worldContainer.toLocal({ x: 0, y: 0 });
            const br = worldContainer.toLocal({ x: app.screen.width, y: app.screen.height });
            const vx1 = (tl.x / MAP_WIDTH) * W;
            const vy1 = (tl.y / MAP_HEIGHT) * H;
            const vx2 = (br.x / MAP_WIDTH) * W;
            const vy2 = (br.y / MAP_HEIGHT) * H;
            ctx.strokeStyle = 'rgba(250, 204, 21, 0.85)';
            ctx.lineWidth = 1;
            ctx.strokeRect(vx1, vy1, vx2 - vx1, vy2 - vy1);
        } catch (err) { /* ignore */ }
    }

    // استدعاء بشكل متكرر كل Tick SSE (وليس كل إطار — لأداء أفضل)
    function onTickIncremented(tick) {
        _chartsCounter++;
        _minimapCounter++;
        // نضيف نقطة للـ charts كل 1 tick (لكن buffer 60 فقط)
        recordSnapshot(tick);
        // نرسم Minimap كل 10 ticks
        if (_minimapCounter >= 10) {
            _minimapCounter = 0;
            drawMinimap();
        }
    }

    function _bindUI() {
        const tgl = document.getElementById('toggle-charts-btn');
        if (tgl) {
            tgl.addEventListener('click', () => {
                const panel = document.getElementById('charts-panel');
                const isCollapsed = panel.classList.toggle('collapsed');
                tgl.classList.toggle('active', !isCollapsed);
                if (!isCollapsed && !charts) _createCharts();
                SoundManager.ensureUnlocked(); SoundManager.play('click');
                console.log(`📊 [StatsManager] Charts panel ${isCollapsed ? 'hidden' : 'shown'}.`);
            });
        }
    }

    function resetCharts() {
        populationHistory.length = 0;
        hungerHistory.length = 0;
        wheatHistory.length = 0;
        labels.length = 0;
        _chartsCounter = 0;
        _minimapCounter = 0;
        if (charts) {
            try {
                charts.population.data.labels = [];   charts.population.data.datasets[0].data = [];
                charts.hunger.data.labels = [];       charts.hunger.data.datasets[0].data = [];
                charts.wheat.data.labels = [];        charts.wheat.data.datasets[0].data = [];
                charts.population.update('none');
                charts.hunger.update('none');
                charts.wheat.update('none');
            } catch (e) { /* ignore */ }
        }
        console.log("📊 [StatsManager] Charts buffers cleared.");
    }

    return { init: function () { _bindUI(); }, onTickIncremented, drawMinimap, recordSnapshot, resetCharts };
})();

// ============================================================
// ==========  [E] ===== SCREEN EFFECTS ======================
// وظيفته: Screen Shake (عند الولادة/عاصفة) + Vignette ثابتة
// ============================================================
const ScreenEffects = (function () {
    let shakeFrames = 0;
    let shakeIntensity = 0;

    // Vignette ثابتة (تظليل حواف الشاشة لعمق سينمائي)
    const vignetteOverlay = new PIXI.Graphics();
    screenOverlayLayer.addChild(vignetteOverlay);

    function _drawVignette() {
        vignetteOverlay.clear();
        const w = app.screen.width, h = app.screen.height;
        const r = Math.max(w, h) * 0.85;
        const grad = vignetteOverlay.texture; // لا نستخدمها، نستخدم radial gradient يدوياً عبر دوائر
        // طريقة بسيطة: دوائر متداخلة متدرجة الشفافية
        for (let i = 20; i >= 1; i--) {
            const t = i / 20;
            vignetteOverlay.beginFill(0x000000, 0.22 * (1 - t));
            vignetteOverlay.drawRoundedRect(
                w/2 - r*t, h/2 - r*t, r*t*2, r*t*2, Math.max(6, 30*t)
            );
            vignetteOverlay.endFill();
        }
        // طبقة هالة شفافة جداً مركزية
        vignetteOverlay.beginFill(0x000000, 0.12);
        vignetteOverlay.drawRect(0,0,w,h);
        vignetteOverlay.endFill();
        // ثقب مركزي ناقص الشفافية ليعطي الإحساس بعمق
        // (نفذناها بدلاً من Canvas 2D Radial Gradient بسبب بساطة Pixi Graphics)
    }

    function shake(intensity, frames) {
        shakeIntensity = Math.max(shakeIntensity, intensity);
        shakeFrames = Math.max(shakeFrames, frames);
        console.log(`📳 [ScreenEffects] Screen shake triggered (${intensity}px × ${frames} frames).`);
    }

    function tickFrame(delta) {
        if (shakeFrames > 0) {
            const jitterX = (Math.random() * 2 - 1) * shakeIntensity;
            const jitterY = (Math.random() * 2 - 1) * shakeIntensity;
            // نطبق الاهتزاز فوق worldContainer.x/y بدون إفساد الـ Camera (بعدها يُعاد التعيين من CameraManager)
            worldContainer.x = app.screen.width/2 + jitterX;
            worldContainer.y = app.screen.height/2 + jitterY;
            shakeFrames -= delta;
            if (shakeFrames <= 0) {
                shakeFrames = 0; shakeIntensity = 0;
                worldContainer.x = app.screen.width/2;
                worldContainer.y = app.screen.height/2;
            }
        }
    }

    return {
        shake, tickFrame,
        init: function () {
            _drawVignette();
            // عند تغير حجم الشاشة (لو حدث) إعادة رسم
            window.addEventListener('resize', () => {
                setTimeout(_drawVignette, 100);
            });
        }
    };
})();

// ============================================================
// ====== MAP RENDERING (Base + Details + Water Waves) =======
// ============================================================
const waterTilesState = [];

function normalizeGrid(rawGrid) {
    if (!rawGrid) return [];
    if (Array.isArray(rawGrid[0]) && rawGrid.length === GRID_SIZE) return rawGrid;
    if (rawGrid.length === GRID_SIZE * GRID_SIZE) {
        const g = [];
        for (let y = 0; y < GRID_SIZE; y++) {
            const row = [];
            for (let x = 0; x < GRID_SIZE; x++) row.push(rawGrid[y * GRID_SIZE + x]);
            g.push(row);
        }
        return g;
    }
    console.warn("⚠️ [Grid] Unknown format. Defaulting empty.");
    return [];
}

function drawMapBase(gridData) {
    mapBaseContainer.removeChildren();
    waterTilesState.length = 0;
    // إطار خارجي
    const brd = new PIXI.Graphics();
    brd.lineStyle(3, 0x000000, 0.65);
    brd.drawRect(-0.5, -0.5, MAP_WIDTH + 1, MAP_HEIGHT + 1);
    mapBaseContainer.addChild(brd);
    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const cell = gridData[y][x];
            const palette = CELL_COLORS[cell.type] || CELL_COLORS[0];
            const color = ((x+y) % 2 === 0) ? palette.base : palette.alt;
            const g = new PIXI.Graphics();
            g.lineStyle(1, 0x000000, 0.05);
            g.beginFill(color);
            g.drawRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
            g.endFill();
            mapBaseContainer.addChild(g);
            if (cell.type === 1) waterTilesState.push({ x, y, offset: Math.random()*6.28 });
        }
    }
    console.log(`🗺️ [Map] Base drawn. Water tiles: ${waterTilesState.length}`);
}

function drawMapDetails(gridData) {
    mapDetailContainer.removeChildren();
    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const cell = gridData[y][x];
            const cx = x * CELL_SIZE + CELL_SIZE / 2;
            const cy = y * CELL_SIZE + CELL_SIZE / 2;
            if (cell.type === 3) {
                // شجرة: جذع + 3 دوائر ورق + ظل
                const t = new PIXI.Graphics();
                t.beginFill(0x000000, 0.22);
                t.drawEllipse(cx, cy + 4.5, 4.2, 1.6);
                t.endFill();
                t.beginFill(0x5d4037);
                t.drawRect(cx - 1.1, cy + 1.2, 2.2, 4);
                t.endFill();
                t.beginFill(0x1b5e20); t.drawCircle(cx, cy - 1, 5); t.endFill();
                t.beginFill(0x2e7d32); t.drawCircle(cx - 2.2, cy - 2.2, 3.2); t.endFill();
                t.beginFill(0x388e3c); t.drawCircle(cx + 2.2, cy - 2.2, 3.2); t.endFill();
                // rotation طفيف للرياح (نحفظه في كائن للـ ticker)
                t.pivot.set(cx, cy + 3.5);
                t.x = 0; t.y = 0;
                t._swayPhase = (x * 31 + y * 17) % 628 / 100;
                t._treeBaseX = 0; t._treeBaseY = 0;
                mapDetailContainer.addChild(t);
            }
            if (cell.type === 2) {
                const g = (cell.crop_growth || 0) / 100;
                if (g <= 0) continue;
                const cr = new PIXI.Graphics();
                if (g < 0.2) {
                    cr.beginFill(0x9ccc65); cr.drawCircle(cx, cy, 1.5); cr.endFill();
                } else if (g < 0.4) {
                    cr.beginFill(0x7cb342);
                    cr.drawRect(cx - 2, cy - 2, 1, 3.5);
                    cr.drawRect(cx + 1, cy - 2, 1, 3.5);
                    cr.endFill();
                } else if (g < 0.7) {
                    cr.beginFill(0x7cb342);
                    cr.drawRect(cx - 2.8, cy - 3, 5.6, 6);
                    cr.endFill();
                    cr.beginFill(0x558b2f);
                    cr.drawRect(cx - 2, cy - 5, 4, 3);
                    cr.endFill();
                } else if (g < 0.95) {
                    cr.beginFill(0x689f38);
                    cr.drawRect(cx - 3, cy - 3.2, 6, 6.5);
                    cr.endFill();
                    cr.beginFill(0x7cb342);
                    cr.drawRect(cx - 3.6, cy - 5.5, 7.2, 3.5);
                    cr.endFill();
                } else {
                    // ناضج ذهبي (جاهز للحصاد)
                    cr.beginFill(0xf9a825);
                    cr.drawRect(cx - 3, cy - 3.2, 6, 6.5);
                    cr.endFill();
                    cr.beginFill(0xfbc02d);
                    cr.drawRect(cx - 4.2, cy - 5.7, 8.4, 3.5);
                    cr.endFill();
                    cr.beginFill(0xffe082, 0.55);
                    cr.drawCircle(cx, cy - 4.5, 2.7);
                    cr.endFill();
                }
                mapDetailContainer.addChild(cr);
            }
            // طبقة مائية: دوائر بيضاء شفافة لموجات (تتراقص في ticker)
            if (cell.type === 1) {
                const wave = new PIXI.Graphics();
                const gx = x * CELL_SIZE, gy = y * CELL_SIZE;
                wave.beginFill(0xffffff, 0.12);
                wave.drawRoundedRect(gx + 1, gy + 4, CELL_SIZE - 2, 3, 1.2);
                wave.endFill();
                wave.beginFill(0xffffff, 0.08);
                wave.drawRoundedRect(gx + 3, gy + 10, CELL_SIZE - 6, 2, 1);
                wave.endFill();
                mapDetailContainer.addChild(wave);
                // index للرجوع إليه في التحديث
                const wt = waterTilesState.find(w => w.x === x && w.y === y);
                if (wt) wt.waveGfx = wave;
            }
        }
    }
    console.log("🌲 [Map] Details (trees/crops/waves) redrawn.");
}

// تحديث موجات الماء + اهتزاز الأشجار كل إطار (Ticker)
function updateEnvironmentPerFrame(delta, globalTime) {
    // موجات الماء
    waterTilesState.forEach(wt => {
        if (!wt.waveGfx) return;
        const sw = Math.sin(globalTime + wt.offset) * 0.8;
        wt.waveGfx.x = sw;
        wt.waveGfx.alpha = 0.55 + Math.sin(globalTime * 1.25 + wt.offset) * 0.45;
    });
    // اهتزاز الأشجار ±0.05 rad حول قاعدة الجذع
    mapDetailContainer.children.forEach(node => {
        if (node._swayPhase !== undefined) {
            node._swayPhase += 0.018 * delta;
            node.rotation = Math.sin(node._swayPhase) * 0.05;
        }
    });
}

// ============================================================
// ===== DASHBOARD UI UPDATE + EVENT LOG (Colored) ==========
// ============================================================
function updateDashboardCards() {
    const all = Array.from(agentsCache.values());
    document.getElementById('current-tick').textContent = currentTick;

    const total = all.length;
    const males = all.filter(a => a.gender === 'male').length;
    const females = total - males;
    document.getElementById('agent-count').textContent = total;
    document.getElementById('male-count').textContent = males;
    document.getElementById('female-count').textContent = females;

    const dead = all.filter(a => a.state === 'dead').length;
    document.getElementById('alive-count').textContent = total - dead;
    document.getElementById('dead-count').textContent = dead;

    const stateCounts = {};
    all.forEach(a => { const s = a.state || 'idle'; stateCounts[s] = (stateCounts[s] || 0) + 1; });
    const stateLabel = Object.entries(stateCounts)
        .filter(([,c]) => c>0)
        .sort((a,b)=>b[1]-a[1])
        .map(([s,c])=>`${s}:${c}`).join(' · ');
    document.getElementById('states-list').textContent = stateLabel || '-';

    let wheat = 0, wood = 0, stone = 0;
    all.forEach(a => {
        const i = a.inventory || {};
        wheat += (i.wheat || 0); wood += (i.wood || 0); stone += (i.stone || 0);
    });
    document.getElementById('wheat-total').textContent = wheat;
    document.getElementById('wood-total').textContent = wood;
    document.getElementById('stone-total').textContent = stone;

    const pregnant = all.filter(a => (a.pregnant_ticks && a.pregnant_ticks > 0) || a.state === 'pregnant').length;
    document.getElementById('pregnant-count').textContent = pregnant;
}

function addEventToLog(ev) {
    eventLog.unshift(ev);
    if (eventLog.length > MAX_EVENT_LOG) eventLog.pop();

    const rawType = (ev.event_type || ev.type || 'default').toLowerCase();
    const VALID_TYPES = { spawn:1, eat:1, sleep:1, walk:1, move:1, plant:1, harvest:1, birth:1, death:1, pregnant:1 };
    const cls = VALID_TYPES[rawType] ? 'event-' + rawType : 'event-default';
    const text = ev.text || ev.message || ev.description || JSON.stringify(ev.payload_json || ev.payload || '');
    const tick = ev.tick ?? currentTick;
    const agentName = ev.agent_name
        || (ev.agent_id != null && agentsCache.get(ev.agent_id)?.name)
        || '';

    const li = document.createElement('li');
    li.className = cls;
    li.innerHTML = `<span class="event-tick">[T${tick}]</span>${agentName ? `<strong>${agentName}</strong>: ` : ''}${text}`;

    const log = document.getElementById('event-log');
    log.insertBefore(li, log.firstChild);
    while (log.children.length > MAX_EVENT_LOG) log.removeChild(log.lastChild);

    // تشغيل أصوات للأحداث المهمة
    if (rawType === 'harvest') SoundManager.play('harvest');
    if (rawType === 'birth')   { SoundManager.play('birth'); ScreenEffects.shake(3, 25); }
    if (rawType === 'death')   { ScreenEffects.shake(2, 18); }
}

// ============================================================
// ======= AGENT DETAILS POPUP ===============================
// ============================================================
function showAgentDetails(a) {
    const isMale = a.gender === 'male';
    const av = document.getElementById('detail-avatar');
    av.className = 'avatar-circle' + (isMale ? '' : ' female');
    av.style.background = isMale
        ? 'linear-gradient(135deg, #3b82f6, #1e40af)'
        : 'linear-gradient(135deg, #ec4899, #9d174d)';
    av.textContent = (a.name || '?').charAt(0).toUpperCase();

    document.getElementById('detail-name').textContent = a.name || 'Unknown';

    const gb = document.getElementById('detail-gender-badge');
    gb.textContent = isMale ? '♂ Male' : '♀ Female';
    gb.className = 'gender-badge ' + (isMale ? 'male' : 'female');

    document.getElementById('detail-age').textContent = a.age ?? 'N/A';

    const sb = document.getElementById('detail-state-badge');
    const s = (a.state || 'idle').toLowerCase();
    sb.textContent = s;
    sb.className = 'state-badge ' + s;

    function sB(id, idNum, v, max) {
        const pct = Math.max(0, Math.min(100, (v / max) * 100));
        document.getElementById(id).style.width = pct + '%';
        document.getElementById(idNum).textContent = Math.round(pct) + '%';
    }
    sB('detail-hp', 'detail-hp-num', a.hp ?? 0, 100);
    sB('detail-hunger', 'detail-hunger-num', a.hunger ?? 0, 100);
    sB('detail-energy', 'detail-energy-num', a.energy ?? 0, 100);
    const moodNorm = ((a.mood ?? 0) + 100) / 2;
    sB('detail-mood', 'detail-mood-num', moodNorm, 100);

    const tr = a.traits || {};
    document.getElementById('trait-courage').style.width      = Math.round((tr.courage ?? 0.5) * 100) + '%';
    document.getElementById('trait-intelligence').style.width = Math.round((tr.intelligence ?? 0.5) * 100) + '%';
    document.getElementById('trait-fertility').style.width    = Math.round((tr.fertility ?? 0.5) * 100) + '%';
    document.getElementById('trait-aggression').style.width   = Math.round((tr.aggression ?? 0.5) * 100) + '%';

    const inv = a.inventory || {};
    document.getElementById('detail-wheat').textContent = inv.wheat ?? 0;
    document.getElementById('detail-wood').textContent  = inv.wood ?? 0;
    document.getElementById('detail-stone').textContent = inv.stone ?? 0;
    document.getElementById('detail-money').textContent = a.money ?? 0;

    const rels = a.relationships || {};
    const relEntries = Object.entries(rels);
    if (relEntries.length === 0) {
        document.getElementById('detail-relationships').textContent = 'No relationships yet.';
    } else {
        document.getElementById('detail-relationships').innerHTML = relEntries.map(([id, score]) => {
            const n = agentsCache.get(Number(id))?.name || `Agent ${id}`;
            const num = typeof score === 'object' ? (score.trust ?? 0) : (score || 0);
            const color = num > 50 ? '#10b981' : num < -50 ? '#ef4444' : '#8f9bb6';
            return `<span style="color:${color};font-weight:600;">${n}</span>: ${num>0?'+':''}${Math.round(num)}`;
        }).join(' · ');
    }
    document.getElementById('agent-details-popup').style.display = 'block';
}

(function bindPopupUI() {
    const popup = document.getElementById('agent-details-popup');
    popup.querySelector('.close-button').addEventListener('click', () => {
        popup.style.display = 'none';
        console.log("❌ [Popup] Closed via X.");
    });
    window.addEventListener('click', (e) => {
        if (e.target === popup) {
            popup.style.display = 'none';
            console.log("❌ [Popup] Closed via outside click.");
        }
    });
})();

// ============================================================
// ===== CONTROL PANEL + SSE COMMUNICATION (REST + SSE) ======
// ============================================================
function setConnectionStatus(status, text) {
    const dot = document.getElementById('status-dot');
    const txt = document.getElementById('status-text');
    dot.className = 'status-dot status-' + status;
    txt.textContent = text;
}

async function sendControlCommand(action, value = null) {
    console.log(`🎮 [Control] action="${action}"${value !== null ? `, value=${value}` : ''}`);
    SoundManager.ensureUnlocked(); SoundManager.play('click');
    try {
        const body = { action };
        if (value !== null) body.value = value;
        const res = await fetch(`${BACKEND_URL}/api/world/control`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!res.ok) console.error("❌ [Control] Backend responded:", res.statusText);
        else console.log("✅ [Control] Delivered.");

        if (action === 'reset') {
            console.log("🔄 [Control] Reset requested. Flushing frontend state...");
            // --- [Frontend Memory Cleanup QWEN 2.3]
            if (eventSource) {
                try { eventSource.close(); } catch (e) { /* ignore */ }
                eventSource = null;
            }
            agentsContainer.removeChildren();
            agentSprites.clear();
            agentsCache.clear();
            selectedAgentId = null; hoveredAgentId = null;
            CameraManager.stopFollow();
            eventLog.length = 0;
            document.getElementById('event-log').innerHTML = '';
            StatsManager.resetCharts();
            setTimeout(() => {
                fetchInitialWorldData();
                setupSSE();
            }, 1000); // تأخير بسيط لضمان نظافة الحالة
        }
    } catch (err) {
        console.error("❌ [Control] Send failed:", err);
    }
}

// أزرار التحكم السفلية
(function bindControlButtons() {
    document.getElementById('pause-btn').addEventListener('click', () => {
        console.log("⏸️ [Button] Pause.");
        sendControlCommand('pause');
    });
    document.getElementById('resume-btn').addEventListener('click', () => {
        console.log("▶️ [Button] Resume.");
        sendControlCommand('resume');
    });
    document.getElementById('reset-btn').addEventListener('click', () => {
        console.log("🔄 [Button] Reset.");
        if (confirm("Reset entire simulation world?")) sendControlCommand('reset');
    });
    // Speed presets + Active state
    document.querySelectorAll('.speed-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const val = parseFloat(btn.dataset.speed);
            const lbl = btn.textContent.trim();
            console.log(`⚡ [Button] Speed → ${lbl} (value=${val})`);
            document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentSpeedValue = val;
            sendControlCommand('set_speed', val);
        });
    });
    document.getElementById('clear-log-btn').addEventListener('click', () => {
        console.log("🗑️ [Button] Clear Event Log.");
        eventLog.length = 0;
        document.getElementById('event-log').innerHTML = '';
        SoundManager.ensureUnlocked(); SoundManager.play('click');
    });
})();

let eventSource = null;
async function fetchInitialWorldData() {
    console.log(`📡 [Init] Fetching initial world → ${BACKEND_URL}/api/world/init`);
    setConnectionStatus('connecting', 'Loading world...');
    try {
        const res = await fetch(`${BACKEND_URL}/api/world/init`);
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        console.log(`✅ [Init] Received. tick=${data.tick}, agents=${data.agents?.length||0}`);
        worldData = data;
        const grid = normalizeGrid(data.grid || data.map);
        console.log(`🧩 [Init] Grid shape: ${Array.isArray(grid[0])?'2D':'flat'} — ${grid.length} rows`);
        cachedGrid = grid;
        drawMapBase(grid);
        drawMapDetails(grid);

        (data.agents || []).forEach(a => agentsCache.set(a.id, a));
        (data.agents || []).forEach(a => SpriteFactory.drawAgent(a));

        currentTick = data.tick || 0;
        // world_state من الـ init إن وجد (للطقس والفصل)
        if (data.world_state) {
            WeatherManager.applyWeather(
                data.world_state.weather || 'clear',
                data.world_state.season  || 'spring'
            );
        }

        updateDashboardCards();
        StatsManager.onTickIncremented(currentTick);
        StatsManager.drawMinimap();
        setConnectionStatus('connected', 'Live');
    } catch (err) {
        console.error("❌ [Init] Failed:", err);
        setConnectionStatus('disconnected', 'Failed to load');
    }
}

function setupSSE() {
    if (eventSource) { eventSource.close(); eventSource = null; }
    const url = `${BACKEND_URL}/api/world/stream`;
    console.log(`🔗 [SSE] Opening stream → ${url}`);
    eventSource = new EventSource(url);
    eventSource.onopen = () => {
        console.log("✅ [SSE] Stream OPEN.");
        setConnectionStatus('connected', 'Live');
    };
    eventSource.onmessage = (ev) => {
        try {
            const payload = JSON.parse(ev.data);
            const prevTick = currentTick;

            if (payload.tick !== undefined) currentTick = payload.tick;

            // world_update (الطقس/الفصل/السوق) — فقط عند التغيير
            if (payload.world_update) {
                const wu = payload.world_update;
                WeatherManager.applyWeather(
                    wu.weather || currentWeather,
                    wu.season  || currentSeason
                );
                // مستقبلاً: market_price يمكن تخزينه للـ Charts
            }

            // تحديثات الكائنات (Delta only)
            if (payload.agents_delta) {
                payload.agents_delta.forEach(delta => {
                    const cached = agentsCache.get(delta.id) || {};
                    const merged = Object.assign({}, cached, delta);
                    agentsCache.set(delta.id, merged);
                    SpriteFactory.drawAgent(merged);
                });
            }

            // تحديثات الخريطة (تغييرات محاصيل/زراعة فقط)
            if (payload.grid_delta && cachedGrid.length) {
                let changed = false;
                payload.grid_delta.forEach(cd => {
                    if (cachedGrid[cd.y] && cachedGrid[cd.y][cd.x]) {
                        Object.assign(cachedGrid[cd.y][cd.x], cd);
                        changed = true;
                    }
                });
                if (changed) drawMapDetails(cachedGrid);
            }

            // أحداث جديدة
            if (payload.new_events && Array.isArray(payload.new_events)) {
                payload.new_events.forEach(evt => addEventToLog(evt));
            }

            updateDashboardCards();
            if (currentTick !== prevTick) StatsManager.onTickIncremented(currentTick);
        } catch (err) {
            console.error("❌ [SSE] Parse failed:", err, "\nRaw:", ev.data);
        }
    };
    eventSource.onerror = () => {
        console.log("SSE disconnected, reconnecting in 3s...");
        setConnectionStatus('disconnected', 'Reconnecting...');
        setTimeout(() => {
            if (eventSource) { try { eventSource.close(); } catch (e) { /* ignore */ } }
            eventSource = null;
            setupSSE();
        }, 3000);
    };
}

// ============================================================
// =============== MASTER TICKER (60 FPS) ====================
// === MICRO-ADJUSTMENT A: منفصل تماماً عن حدث SSE ==========
// ============================================================
let globalAnimTime = 0;
app.ticker.add((delta) => {
    globalAnimTime += 0.045 * delta; // وقت عالمي موحد للموجات والرياح

    // 1) تحريك الكائنات (Lerp + Hop + Breathing)
    SpriteFactory.updatePerFrame(delta);

    // 2) بيئة (موجات ماء + اهتزاز أشجار)
    updateEnvironmentPerFrame(delta, globalAnimTime);

    // 3) إدارة الكاميرا (Follow)
    CameraManager.tickFrame(delta);

    // 4) ليل ونهار
    DayNightManager.tickFrame(delta);

    // 5) جزيئات الطقس
    WeatherManager.tickFrame(delta);

    // 6) Screen Shake
    ScreenEffects.tickFrame(delta);
});

// ============================================================
// ================== INITIALIZATION =========================
// ============================================================
console.log("🚀 [BOOT] All managers constructed. Binding + initializing now.");

CameraManager.init();
DayNightManager.init();
WeatherManager.init();
SoundManager.init();
StatsManager.init();
ScreenEffects.init();

// اختبار الطقس DevTools (لاختبار المرحلة 1 قبل الـ Backend)
window.__toggleWeather = function (w, s) {
    w = w || (currentWeather === 'clear' ? 'rain' : (currentWeather === 'rain' ? 'snow' : 'clear'));
    s = s || currentSeason;
    console.log("🧪 [DEV] __toggleWeather →", w, "/", s);
    WeatherManager.applyWeather(w, s);
};
window.__nextSeason = function () {
    const order = ['spring','summer','autumn','winter'];
    const i = order.indexOf(currentSeason);
    const nxt = order[(i + 1) % order.length];
    console.log("🧪 [DEV] __nextSeason →", nxt);
    WeatherManager.applyWeather(currentWeather, nxt);
};

fetchInitialWorldData();
setupSSE();

console.log("🎉 [BOOT] Microverse v2 Frontend initialized. Open DevTools & try __toggleWeather() / __nextSeason().");
