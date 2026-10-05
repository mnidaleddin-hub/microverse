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
const CELL_SIZE = 32;
const MAP_WIDTH = GRID_SIZE * CELL_SIZE;   // 1280
const MAP_HEIGHT = GRID_SIZE * CELL_SIZE;  // 1280
const MAX_EVENT_LOG = 35;

// Tick/cycle parameters
const DAY_LENGTH_TICKS = 1440;             // 24 in-world hours = 1 real minute @ 1x (approx)
const STATS_BUFFER_SIZE = 60;              // 60 points in Chart.js

// ===== MOBILE DETECTION + PERFORMANCE THROTTLING =====
const isMobile = (() => {
    if (typeof navigator === "undefined") return false;
    const uaMatch = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent || "");
    const smallScreen = (typeof window !== "undefined") && Math.min(window.innerWidth || 9999, window.innerHeight || 9999) <= 900;
    const coarsePointer = (typeof window !== "undefined" && window.matchMedia) ? window.matchMedia("(pointer: coarse)").matches : false;
    return uaMatch || smallScreen || coarsePointer;
})();
const PARTICLE_RAIN_COUNT    = isMobile ? 200 : 480;
const PARTICLE_SNOW_COUNT    = isMobile ? 120 : 260;
const PARTICLE_LEAF_COUNT    = isMobile ? 100 : 220;
const PARTICLE_FIREFLY_COUNT = isMobile ? 150 : 300;
const MINIMAP_INTERVAL       = isMobile ? 30  : 15;
const _FPS_LOG = true;

console.log(`🌍 [BOOT] Microverse v2 Frontend initializing... isMobile=${isMobile}`);

// ============================================================
// PIXI APPLICATION + WORLD HIERARCHY
// ============================================================
const app = new PIXI.Application({
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    backgroundColor: 0x06120b,
    antialias: !isMobile,
    resolution: isMobile ? 1 : (window.devicePixelRatio || 1),
    autoDensity: true,
});
const container = document.getElementById('game-container');
if (!container) throw new Error("FATAL: #game-container not found in DOM");
app.view.style.display = 'block';
app.view.style.zIndex = '1';
app.view.style.position = 'relative';
container.appendChild(app.view);

// WorldContainer يحتوي على كل شيء (يلتف حوله Zoom/Pan/Shake)
const worldContainer = new PIXI.Container();
app.stage.addChild(worldContainer);

// [LEGACY REMOVED] Old test rect and raw grid containers eradicated for Phase 4 engine overhaul

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
let currentDarkness = 0.0;      // 0..1 (نهار ↔ منتصف الليل) — محدث من DayNightManager

// ====== حالة God Mode و Tile Editor ======
let tileEditMode = false;        // true عند تفعيل Edit Tile Mode
let _tileEditorTarget = null;    // {x, y} للخلية المحددة حالياً
let _tileEditorSnapshot = null;  // snapshot للخلية قبل التعديل (للـ rollback إن فشل الطلب)
let _agentEditSnapshot = null;   // snapshot للكائن قبل التعديل

// Color palette fixed (single definition)
const CELL_COLORS = {
    0: { base: 0x7CB342, alt: 0x8BC34A },  // Plains
    1: { base: 0x1565C0, alt: 0x1976D2 },  // Water
    2: { base: 0x6D4C41, alt: 0x795548 },  // Farmland
    3: { base: 0x2E7D32, alt: 0x388E3C },  // Forest
    4: { base: 0xFDD835, alt: 0xFFEE58 },  // Desert
    5: { base: 0xE3F2FD, alt: 0xBBDEFB },  // Snow
    6: { base: 0x558B2F, alt: 0x689F38 },  // Swamp
};
const BIOME_NAME = ['Plains','Water','Farmland','Forest','Desert','Snow','Swamp'];

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

    // ربط أحداث الـ Drag + Touch
    function _bindPanEvents() {
        const gc = document.getElementById('game-container');
        gc.addEventListener('pointerdown', (e) => {
            // فقط زر الأيسر (وليس Touch — نستخدم touch* مباشرة لـ Touch)
            if (e.pointerType === 'touch') return;
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
            if (e.pointerType === 'touch') return;
            // الطبقة مقلوبة بالإحداثيات بسبب pivot/zoom — نقسم على currentZoom للتعويض
            panOffsetX = panStartOffX + (panStartX - e.clientX) / currentZoom;
            panOffsetY = panStartOffY + (panStartY - e.clientY) / currentZoom;
            // إذا كان المستخدم يسحب يدوياً → إيقاف Follow تلقائياً
            if (followAgentId !== null) { followAgentId = null; _updateFollowButton(false); }
            _applyTransform();
        });
        window.addEventListener('pointerup', (e) => {
            if (e.pointerType === 'touch') return;
            if (!isPanning) return;
            isPanning = false;
            document.getElementById('game-container').classList.remove('panning');
        });

        // ===================== TOUCH CONTROLS =====================
        let lastTouchDistance = 0;
        let touchPanActive = false;
        let touchMoved = false;
        let lastTapTime = 0;

        // ---- Pinch-to-Zoom + Swipe-to-Pan (touchstart) ----
        gc.addEventListener('touchstart', (e) => {
            if (e.touches.length === 2) {
                e.preventDefault();
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                lastTouchDistance = Math.hypot(dx, dy);
                touchPanActive = false;
                touchMoved = false;
            } else if (e.touches.length === 1) {
                const t = e.touches[0];
                // تأكد أن النقر فوق canvas وليس فوق زر HTML
                const target = document.elementFromPoint(t.clientX, t.clientY);
                if (target && target.tagName && target.tagName.toLowerCase() === 'canvas') {
                    touchPanActive = true;
                    touchMoved = false;
                    isPanning = true;
                    panStartX = t.clientX; panStartY = t.clientY;
                    panStartOffX = panOffsetX; panStartOffY = panOffsetY;
                    gc.classList.add('panning');
                }
            }
        }, { passive: false });

        // ---- Pinch Zoom + Swipe Pan (touchmove) ----
        gc.addEventListener('touchmove', (e) => {
            if (e.touches.length === 2) {
                e.preventDefault();
                touchMoved = true;
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                const currentDistance = Math.hypot(dx, dy);
                if (lastTouchDistance > 0 && currentDistance > 0) {
                    const scaleFactor = currentDistance / lastTouchDistance;
                    const rect = gc.getBoundingClientRect();
                    const centerClientX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
                    const centerClientY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
                    const sx = (centerClientX - rect.left) * (app.view.width / rect.width);
                    const sy = (centerClientY - rect.top)  * (app.view.height / rect.height);
                    zoomAt(sx, sy, scaleFactor);
                }
                lastTouchDistance = currentDistance;
            } else if (e.touches.length === 1 && touchPanActive) {
                const t = e.touches[0];
                const dxPx = panStartX - t.clientX;
                const dyPx = panStartY - t.clientY;
                if (Math.abs(dxPx) > 4 || Math.abs(dyPx) > 4) touchMoved = true;
                e.preventDefault();
                panOffsetX = panStartOffX + dxPx / currentZoom;
                panOffsetY = panStartOffY + dyPx / currentZoom;
                if (followAgentId !== null) { followAgentId = null; _updateFollowButton(false); }
                _applyTransform();
            }
        }, { passive: false });

        // ---- Double-Tap to Center + Tap-to-Select fallback ----
        gc.addEventListener('touchend', (e) => {
            if (e.touches.length === 0) {
                // Double-tap detection
                const now = Date.now();
                const dt = now - lastTapTime;
                if (!touchMoved && dt < 300 && dt > 0) {
                    centerView();
                    console.log("🎯 [Touch] Double-tap detected → Center view");
                    lastTapTime = 0;
                } else if (!touchMoved) {
                    lastTapTime = now;
                } else {
                    lastTapTime = 0;
                }
                lastTouchDistance = 0;
                touchPanActive = false;
                touchMoved = false;
                isPanning = false;
                gc.classList.remove('panning');
            } else if (e.touches.length === 1) {
                // رفع إصبع واحد أثناء وجود إصبع آخر → ضبط panStart لمنع ارتداد
                const t = e.touches[0];
                panStartX = t.clientX; panStartY = t.clientY;
                panStartOffX = panOffsetX; panStartOffY = panOffsetY;
            }
        });
        gc.addEventListener('touchcancel', () => {
            lastTouchDistance = 0;
            touchPanActive = false;
            touchMoved = false;
            isPanning = false;
            gc.classList.remove('panning');
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
        sprite.direction = 'down';       // up/down/left/right
        sprite.deadCounter = 0;          // عدد التكات منذ دخول state dead

        // ---- طبقات مرتبة من الأسفل للأعلى (32x32 scale) ----
        // 1) Shadow (لا يتأثر بالـ Hop/Bounce)
        const shadow = new PIXI.Graphics();
        shadow.beginFill(0x000000, 0.35);
        shadow.drawEllipse(0, 15, 12, 4.2);
        shadow.endFill();
        sprite.addChild(shadow); sprite.shadow = shadow;

        // 1b) Lantern Glow (Additive — سطوع الفانوس ليلاً عند الزراعة)
        const lanternGlow = new PIXI.Graphics();
        lanternGlow.blendMode = PIXI.BLEND_MODES.ADD;
        lanternGlow.beginFill(0xffd54f, 0.0);
        lanternGlow.drawCircle(0, 0, 32);
        lanternGlow.endFill();
        lanternGlow.visible = false;
        sprite.addChild(lanternGlow); sprite.lanternGlow = lanternGlow;

        // 2) Rings (Hover/Selection/Pregnancy) تحت Body
        const hoverRing = new PIXI.Graphics();
        hoverRing.lineStyle(2, 0x00e5ff, 0.95);
        hoverRing.drawCircle(0, 0, 22);
        hoverRing.visible = false;
        sprite.addChildAt(hoverRing, 0);
        sprite.hoverRing = hoverRing;

        const selRing = new PIXI.Graphics();
        selRing.lineStyle(2.6, 0x00ff7a, 1);
        selRing.drawCircle(0, 0, 24);
        selRing.visible = false;
        sprite.addChildAt(selRing, 0);
        sprite.selRing = selRing;

        const pregRing = new PIXI.Graphics();
        pregRing.lineStyle(2.3, 0xffd54f, 0.9);
        pregRing.drawCircle(0, 0, 22);
        pregRing.visible = false;
        sprite.addChildAt(pregRing, 0);
        sprite.pregRing = pregRing;

        // 3) Bounce Container (تتحرك صعوداً عند Hop، وتتنفس عند السكون)
        const bounce = new PIXI.Container();
        sprite.addChild(bounce); sprite.bounce = bounce;

        // Legs (ساقان منفصلتان للتأرجح في walk cycle)
        const legs = new PIXI.Graphics();
        bounce.addChild(legs); sprite.legs = legs;

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

        // Tool (أداة — المعول عند الزراعة)
        const tool = new PIXI.Graphics();
        bounce.addChild(tool); sprite.tool = tool;

        // Zzz floating text (للعناية النوم)
        const zzz = new PIXI.Text('Z z z', {
            fontSize: 11, fill: 0xffffff, fontWeight: 'bold',
            stroke: 0x0a2540, strokeThickness: 2,
        });
        zzz.anchor.set(0.5, 0.5);
        zzz.visible = false;
        bounce.addChild(zzz); sprite.zzz = zzz;

        // State Icon (Emoji) فوق الرأس
        const stateIcon = new PIXI.Text('', { fontSize: 14 });
        stateIcon.anchor.set(0.5, 1);
        stateIcon.y = -26;
        bounce.addChild(stateIcon); sprite.stateIcon = stateIcon;

        // ChatBubble (أعلى من stateIcon)
        const cb = _buildChatBubble();
        cb.y = -56;
        bounce.addChild(cb);
        sprite.chat = cb;

        // NameTag (اسم تحت الكائن + stroke أسود — لا يتأثر بالـ Hop)
        const nameText = new PIXI.Text('', {
            fontSize: 10, fontWeight: 'bold',
            fill: 0xffffff,
            stroke: 0x000000, strokeThickness: 2.5,
        });
        nameText.anchor.set(0.5, 0);
        nameText.y = 20;
        sprite.addChild(nameText); sprite.nameText = nameText;

        // ===== Events =====
        sprite.on('pointerover', () => {
            hoveredAgentId = initialData.id;
            hoverRing.visible = true; sprite.scale.set(1.08);
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
        // دعم Touch للموبايل (Tap-to-Select) — hit area أكبر قليلاً للأصابع
        sprite.hitArea = new PIXI.Rectangle(-22, -56, 44, 68);
        sprite.on('touchstart', (e) => {
            try { e.stopPropagation(); } catch (_) {}
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
        const clothHilit  = isMale ? 0x64b5f6 : 0xf48fb1;
        const skinTone = SKIN_TONES[(a.id * 3) % SKIN_TONES.length];
        const hairColor = HAIR_COLORS[a.id % HAIR_COLORS.length];
        const hairStyle = (a.id * 7 + (isMale ? 0 : 3)) % 6;

        // ===== ساقان =====
        sprite.legs.clear();
        sprite.legs.lineStyle(0);
        sprite.legs.beginFill(clothShadow);
        sprite.legs.drawRoundedRect(-4, 6, 3.4, 7, 1.1);
        sprite.legs.drawRoundedRect(0.6, 6, 3.4, 7, 1.1);
        sprite.legs.endFill();
        // حذاء
        sprite.legs.beginFill(0x263238);
        sprite.legs.drawRoundedRect(-4.5, 12, 4.2, 2.3, 0.9);
        sprite.legs.drawRoundedRect(0.3,  12, 4.2, 2.3, 0.9);
        sprite.legs.endFill();

        // ===== Body + ظل الجسم (Gradient-like طبقات متداخلة) =====
        sprite.body.clear();
        // ظل خلف
        sprite.body.beginFill(0x000000, 0.18);
        sprite.body.drawRoundedRect(-6.6, 0.5, 13.2, 11.5, 3.5);
        sprite.body.endFill();
        // ملابس ظل
        sprite.body.beginFill(clothShadow);
        sprite.body.drawRoundedRect(-6.8, -0.6, 13.6, 10.6, 3.8);
        sprite.body.endFill();
        // ملابس رئيسية
        sprite.body.beginFill(clothColor);
        sprite.body.drawRoundedRect(-6.5, -1.2, 13, 9.6, 3.6);
        sprite.body.endFill();
        // حافة علوية ملونة (turtleneck / collar)
        sprite.body.beginFill(clothHilit);
        sprite.body.drawRoundedRect(-6.5, -1.2, 13, 2.3, [2.8, 2.8, 0, 0]);
        sprite.body.endFill();
        // حزام
        sprite.body.beginFill(0x424242);
        sprite.body.drawRect(-6.5, 6.3, 13, 1.8);
        sprite.body.endFill();
        // مشبك حزام
        sprite.body.beginFill(0xffd54f);
        sprite.body.drawRect(-1, 6.3, 2, 1.8);
        sprite.body.endFill();

        // ===== ذراعان (بلون الجلد + كم ملابس) =====
        sprite.arms.clear();
        // كم اليدين من القماش
        sprite.arms.beginFill(clothShadow);
        sprite.arms.drawRoundedRect(-8.5, -0.6, 2.6, 7.2, 1);
        sprite.arms.drawRoundedRect(5.9, -0.6, 2.6, 7.2, 1);
        sprite.arms.endFill();
        sprite.arms.beginFill(clothColor);
        sprite.arms.drawRoundedRect(-8.2, -0.4, 2, 5.5, 1);
        sprite.arms.drawRoundedRect(6.2, -0.4, 2, 5.5, 1);
        sprite.arms.endFill();
        // يدان (جلد مكشوف عند المعصمين)
        sprite.arms.beginFill(skinTone);
        sprite.arms.drawCircle(-7.2, 5.7, 1.5);
        sprite.arms.drawCircle(7.2, 5.7, 1.5);
        sprite.arms.endFill();

        // ===== رأس + خدود + أذنان =====
        sprite.head.clear();
        // رقبة
        sprite.head.beginFill(skinTone);
        sprite.head.drawRect(-1.8, -6.6, 3.6, 2.6);
        sprite.head.endFill();
        // رأس بيضاوي
        sprite.head.beginFill(skinTone);
        sprite.head.drawEllipse(0, -10.5, 5.6, 6.5);
        sprite.head.endFill();
        // ظل خفيف تحت الفك
        sprite.head.beginFill(0x000000, 0.08);
        sprite.head.drawEllipse(0, -7.8, 5.2, 2.5);
        sprite.head.endFill();
        // خدود
        sprite.head.beginFill(0xffab91, 0.36);
        sprite.head.drawCircle(-3.1, -9.3, 1.1);
        sprite.head.drawCircle(3.1, -9.3, 1.1);
        sprite.head.endFill();
        // أنف صغير
        sprite.head.lineStyle(0.6, 0x8d5524, 0.55);
        sprite.head.moveTo(0, -10.2); sprite.head.lineTo(0, -8.8); sprite.head.lineTo(0.7, -8.5);
        // شفايف
        sprite.head.lineStyle(0.6, 0xc2185b, 0.75);
        sprite.head.moveTo(-1.5, -7.5);
        sprite.head.quadraticCurveTo(0, -6.9, 1.5, -7.5);

        // ===== شعر — 6 ستايلات مختلفة بناءً على hairStyle =====
        sprite.hair.clear();
        sprite.hair.beginFill(hairColor);
        if (hairStyle === 0) {          // قصير مستدير
            sprite.hair.drawEllipse(0, -13.6, 5.8, 4.6);
            sprite.hair.drawRect(-5.8, -14.5, 11.6, 2.6);
        } else if (hairStyle === 1) {   // مسطح علوى + قصة عصرية
            sprite.hair.drawRect(-6.2, -15.8, 12.4, 3.5);
            sprite.hair.drawCircle(-5.8, -13.4, 2);
            sprite.hair.drawCircle(5.8, -13.4, 2);
            sprite.hair.drawCircle(0, -17, 2.2);
        } else if (hairStyle === 2) {   // mohawk / وسط مرتفع
            sprite.hair.drawRect(-1.5, -17.5, 3, 4.5);
            sprite.hair.drawCircle(0, -17.8, 1.8);
            sprite.hair.drawEllipse(0, -13.5, 5.5, 3.5);
        } else if (hairStyle === 3) {   // طويل مدرج للخلف
            sprite.hair.drawEllipse(0, -13.8, 6, 5);
            sprite.hair.drawRect(-6.5, -14.5, 13, 3);
            sprite.hair.drawRect(-6.6, -12, 2.6, 8.5);
            sprite.hair.drawRect(4, -12, 2.6, 8.5);
        } else if (hairStyle === 4) {   // شعر طويل ذيل حصان
            sprite.hair.drawEllipse(0, -13.8, 6, 5);
            sprite.hair.drawRect(-6.2, -14.5, 12.4, 3);
            sprite.hair.drawRoundedRect(-1.5, -16, 3, 13, 1.5);
        } else {                        // curly afro
            for (let k = 0; k < 13; k++) {
                const ang = (k / 13) * Math.PI * 2;
                sprite.hair.drawCircle(Math.cos(ang)*4, -13.5 + Math.sin(ang)*4, 2.2);
            }
            sprite.hair.drawEllipse(0, -13.6, 5.4, 5);
        }
        sprite.hair.endFill();
        // غرة أمامية (لجميع الستايلات باستثناء mohawk)
        if (hairStyle !== 2 && hairStyle !== 5) {
            sprite.hair.beginFill(hairColor);
            sprite.hair.drawEllipse(0, -15.3, 5.3, 2.2);
            sprite.hair.endFill();
        }

        // ===== عيون =====
        sprite.eyes.clear();
        if (a.state === 'dead') {
            // X عيون الموت
            sprite.eyes.lineStyle(1.1, 0xd32f2f, 1);
            sprite.eyes.moveTo(-3.5, -12.2); sprite.eyes.lineTo(-1.6, -10.4);
            sprite.eyes.moveTo(-1.6, -12.2); sprite.eyes.lineTo(-3.5, -10.4);
            sprite.eyes.moveTo(1.6, -12.2);  sprite.eyes.lineTo(3.5, -10.4);
            sprite.eyes.moveTo(3.5, -12.2);  sprite.eyes.lineTo(1.6, -10.4);
        } else if (a.state === 'sleeping') {
            // عيون مغلقة بأقواس
            sprite.eyes.lineStyle(1, 0x0f172a, 0.9);
            sprite.eyes.moveTo(-3.8, -10.8);
            sprite.eyes.quadraticCurveTo(-2.55, -11.6, -1.3, -10.8);
            sprite.eyes.moveTo(1.3, -10.8);
            sprite.eyes.quadraticCurveTo(2.55, -11.6, 3.8, -10.8);
        } else if (a.state === 'eating') {
            // عيون سعيدة (^ ^)
            sprite.eyes.lineStyle(1, 0x0f172a, 0.95);
            sprite.eyes.moveTo(-3.6, -11.1); sprite.eyes.lineTo(-2.5, -12.1); sprite.eyes.lineTo(-1.4, -11.1);
            sprite.eyes.moveTo(1.4, -11.1);  sprite.eyes.lineTo(2.5, -12.1);  sprite.eyes.lineTo(3.6, -11.1);
        } else {
            // عيون مفتوحة عادية + حدوة بيضاء
            sprite.eyes.beginFill(0xffffff);
            sprite.eyes.drawEllipse(-2.5, -11, 1.5, 1.9);
            sprite.eyes.drawEllipse(2.5, -11, 1.5, 1.9);
            sprite.eyes.endFill();
            // بؤبؤ (اللون بناءً على id)
            const irisColor = [0x3e2723, 0x1565c0, 0x2e7d32, 0x6a1b9a, 0x00838f][a.id % 5];
            sprite.eyes.beginFill(irisColor);
            sprite.eyes.drawCircle(-2.5, -10.9, 0.95);
            sprite.eyes.drawCircle(2.5, -10.9, 0.95);
            sprite.eyes.endFill();
            // حدوة داخلية
            sprite.eyes.beginFill(0x000000);
            sprite.eyes.drawCircle(-2.5, -10.9, 0.55);
            sprite.eyes.drawCircle(2.5, -10.9, 0.55);
            sprite.eyes.endFill();
            // بريق عين أبيض صغير
            sprite.eyes.beginFill(0xffffff, 0.95);
            sprite.eyes.drawCircle(-2.15, -11.4, 0.28);
            sprite.eyes.drawCircle(2.85, -11.4, 0.28);
            sprite.eyes.endFill();
        }

        // ===== أداة المعول عند الزراعة (farming) =====
        sprite.tool.clear();
        const showTool = (a.state === 'farming');
        if (showTool) {
            // عود خشبي
            sprite.tool.lineStyle(1, 0x4e342e, 0.6);
            sprite.tool.beginFill(0x6d4c41);
            sprite.tool.drawRoundedRect(7.2, -3, 1.4, 11, 0.5);
            sprite.tool.endFill();
            // رأس المعول (معدني)
            sprite.tool.beginFill(0x90a4ae);
            sprite.tool.moveTo(6.5, -5.5);
            sprite.tool.lineTo(11, -4);
            sprite.tool.lineTo(10.5, -1);
            sprite.tool.lineTo(6.8, -2.5);
            sprite.tool.closePath();
            sprite.tool.endFill();
            // حافة لامعة
            sprite.tool.beginFill(0xeceff1);
            sprite.tool.moveTo(6.7, -5.2);
            sprite.tool.lineTo(10.5, -3.8);
            sprite.tool.lineTo(10.3, -3.3);
            sprite.tool.lineTo(6.9, -4.5);
            sprite.tool.closePath();
            sprite.tool.endFill();
        }

        // ===== أيقونة حالة (Emoji) =====
        const preg = !!(a.pregnant_ticks && a.pregnant_ticks > 0) || a.state === 'pregnant';
        if (a.state === 'dead') sprite.stateIcon.text = '💀';
        else if (preg) sprite.stateIcon.text = '🤰';
        else sprite.stateIcon.text = STATE_ICONS[a.state] || '';

        // ===== حلقة الحمل + التحديد =====
        sprite.pregRing.visible = preg;
        sprite.selRing.visible = (selectedAgentId === a.id);

        // ===== الموتى: تلوين رمادي + شفافية =====
        if (a.state === 'dead') {
            sprite.alpha = Math.min(1, Math.max(0.18, sprite.alpha));
            sprite.tint = 0xb0bec5;
        } else {
            sprite.alpha = 1;
            sprite.tint = 0xffffff;
        }

        // ===== فانوس ليلاً (ضوء محلي) =====
        const isDark = currentDarkness > 0.6;
        const needsLight = showTool || a.state === 'building' || a.state === 'crafting';
        if (isDark && needsLight) {
            sprite.lanternGlow.visible = true;
            const la = 0.28 + (currentDarkness - 0.6) * 0.8;
            sprite.lanternGlow.clear();
            sprite.lanternGlow.beginFill(0xffd54f, Math.min(0.7, la));
            sprite.lanternGlow.drawCircle(0, 0, 42);
            sprite.lanternGlow.endFill();
            // هالة داخلية أشد سطوعاً
            sprite.lanternGlow.beginFill(0xfff176, Math.min(0.9, la * 1.2));
            sprite.lanternGlow.drawCircle(4, 4, 14);
            sprite.lanternGlow.endFill();
        } else {
            sprite.lanternGlow.visible = false;
        }

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
            const a = agentsCache.get(id);
            const prevX = sprite.x, prevY = sprite.y;
            sprite.x += (sprite.targetX - sprite.x) * lerpFactor;
            sprite.y += (sprite.targetY - sprite.y) * lerpFactor;

            // === Dead counter + hide after 300 ticks ===
            if (a && a.state === 'dead') {
                sprite.deadCounter = (sprite.deadCounter || 0) + (0.016 * delta);
                if (sprite.deadCounter > 5) {   // ~300 ticks تقريباً
                    sprite.visible = false;
                    sprite.alpha = 0;
                }
            } else {
                sprite.deadCounter = 0;
                sprite.visible = true;
            }

            // هل الكائن يتحرك حالياً؟
            const rawDx = sprite.targetX - sprite.x;
            const rawDy = sprite.targetY - sprite.y;
            const dx = Math.abs(rawDx);
            const dy = Math.abs(rawDy);
            const movedThisFrame = Math.hypot(sprite.x - prevX, sprite.y - prevY);
            const isMoving = (dx > 0.4 || dy > 0.4) && movedThisFrame > 0.02;

            // === اتجاه الحركة (4-direction) ===
            if (isMoving) {
                if (Math.abs(rawDx) >= Math.abs(rawDy)) sprite.direction = (rawDx > 0) ? 'right' : 'left';
                else                                      sprite.direction = (rawDy > 0) ? 'down'  : 'up';
            }
            // mirror للاتجاه الأيسر (بدون إنشاء textures)
            if (sprite.bounce) {
                sprite.bounce.scale.x = (sprite.direction === 'left') ? -1 : 1;
            }

            // === 1) Hop + Walk Cycle (تأرجح الأرجل والأذرع sin) ===
            if (isMoving) {
                sprite._hopPhase = (sprite._hopPhase || 0) + 0.38 * delta;
                const hopHeight = Math.abs(Math.sin(sprite._hopPhase)) * 3.2;
                sprite.bounce.y = -hopHeight;
                const squish = 1 - (hopHeight / 18);
                sprite.shadow.scale.set(squish, squish);
                sprite.shadow.alpha = 0.35 * squish;

                // swing الساقين والذراعين (أمام/خلف)
                const swing = Math.sin(sprite._hopPhase * 2) * 0.9;
                if (sprite.legs) sprite.legs.rotation = swing * 0.08;
                if (sprite.arms) sprite.arms.rotation = -swing * 0.09;
            } else {
                sprite._hopPhase = 0;
                sprite.bounce.y += (0 - sprite.bounce.y) * 0.25 * delta;
                sprite.shadow.scale.x += (1 - sprite.shadow.scale.x) * 0.25 * delta;
                sprite.shadow.scale.y += (1 - sprite.shadow.scale.y) * 0.25 * delta;
                sprite.shadow.alpha   += (0.35 - sprite.shadow.alpha) * 0.25 * delta;
                if (sprite.legs) sprite.legs.rotation += (0 - sprite.legs.rotation) * 0.2 * delta;
                if (sprite.arms) sprite.arms.rotation += (0 - sprite.arms.rotation) * 0.2 * delta;
            }

            // === 2) Farming: اهتزاز سريع لأعلى/لأسفل + دوران يد المعول ===
            if (a && a.state === 'farming') {
                sprite._farmPhase = (sprite._farmPhase || 0) + 0.5 * delta;
                const farmBob = Math.abs(Math.sin(sprite._farmPhase)) * 1.6;
                sprite.bounce.y -= farmBob;
                if (sprite.tool) sprite.tool.rotation = Math.sin(sprite._farmPhase) * 0.55;
            } else if (sprite.tool) {
                sprite.tool.rotation += (0 - sprite.tool.rotation) * 0.2 * delta;
            }

            // === 3) Sleep: استلقاء جانبي بسيط + Zzz عائم تتلاشى ===
            if (a && a.state === 'sleeping') {
                const targetRot = (sprite.direction === 'left' ? -1 : 1) * 0.55;
                sprite.bounce.rotation += (targetRot - sprite.bounce.rotation) * 0.08 * delta;
                // زيادة الشفافية تدريجياً = عمق نوم أعمق
                sprite.zzz.visible = true;
                sprite._zzzPhase = (sprite._zzzPhase || Math.random() * 6.28) + 0.05 * delta;
                const zp = sprite._zzzPhase;
                sprite.zzz.y = -30 + Math.sin(zp) * 4;
                sprite.zzz.x = Math.sin(zp * 0.7) * 6;
                const az = (0.5 + 0.5 * Math.sin(zp));
                sprite.zzz.alpha = 0.25 + az * 0.75;
                sprite.zzz.scale.set(0.85 + az * 0.35, 0.85 + az * 0.35);
            } else {
                sprite.bounce.rotation += (0 - sprite.bounce.rotation) * 0.15 * delta;
                sprite.zzz.visible = false;
                sprite.zzz.alpha = 0;
            }

            // === 4) Breathing (تنفس طفيف عند السكون — scale 0.985..1.015)
            //    (ملاحظة: لا نكتب bounce.scale.x مباشرة لأننا استخدمناه لـ mirror)
            sprite._breathPhase = (sprite._breathPhase || Math.random() * 6.28) + 0.04 * delta;
            if (!isMoving && !(a && a.state === 'sleeping')) {
                const by = 1 + Math.sin(sprite._breathPhase) * 0.015;
                const bx = (sprite.direction === 'left' ? -1 : 1) * (1 + Math.sin(sprite._breathPhase) * 0.008);
                sprite.bounce.scale.set(bx, by);
            } else if (!(a && a.state === 'sleeping')) {
                const tx = (sprite.direction === 'left' ? -1 : 1);
                sprite.bounce.scale.x += (tx - sprite.bounce.scale.x) * 0.2 * delta;
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

// تحويل إحداثيات الشاشة إلى إحداثيات خلية الشبكة (grid x,y)
function _screenToGridCell(clientX, clientY) {
    const gc = document.getElementById('game-container');
    const rect = gc.getBoundingClientRect();
    const viewSX = (clientX - rect.left) * (app.view.width / rect.width);
    const viewSY = (clientY - rect.top)  * (app.view.height / rect.height);
    const world = worldContainer.toLocal({ x: viewSX, y: viewSY });
    const gx = Math.floor(world.x / CELL_SIZE);
    const gy = Math.floor(world.y / CELL_SIZE);
    if (gx < 0 || gy < 0 || gx >= GRID_SIZE || gy >= GRID_SIZE) return null;
    return { x: gx, y: gy };
}

// إجراء داخلي لـ selectAgent (يستدعيه الـ SpriteFactory عند النقر فوق الكائن)
function _selectAgentInternal(id) {
    const prev = selectedAgentId;
    selectedAgentId = id;
    if (prev !== null && agentSprites.has(prev)) agentSprites.get(prev).selRing.visible = false;
    if (selectedAgentId !== null && agentSprites.has(selectedAgentId)) agentSprites.get(selectedAgentId).selRing.visible = true;
    const agent = agentsCache.get(id);
    const selNameEl = document.getElementById('god-selected-agent-name');
    const openBtn = document.getElementById('god-open-edit-btn');
    if (agent) {
        console.log(`✅ [Selection] #${id} ${agent.name} — ${agent.state} @(${agent.x},${agent.y})`);
        showAgentDetails(agent);
        if (selNameEl) selNameEl.textContent = `#${agent.id} — ${agent.name} (${agent.state})`;
        if (openBtn) { openBtn.disabled = false; openBtn.style.opacity = '1'; }
    } else {
        if (selNameEl) selNameEl.textContent = '—';
        if (openBtn) { openBtn.disabled = true; openBtn.style.opacity = '0.5'; }
    }
}

// فتح نافذة تعديل الخلية
function openTileEditor(gridX, gridY) {
    if (!cachedGrid || !cachedGrid[gridY] || !cachedGrid[gridY][gridX]) return;
    const tile = cachedGrid[gridY][gridX];
    _tileEditorTarget = { x: gridX, y: gridY };
    _tileEditorSnapshot = { ...tile };
    const xEl = document.getElementById('tile-pos-x');
    const yEl = document.getElementById('tile-pos-y');
    const curTypeEl = document.getElementById('tile-current-type');
    const curGrowthEl = document.getElementById('tile-current-growth');
    const growthRow = document.getElementById('tile-growth-row');
    const growthRange = document.getElementById('tile-growth-range');
    const growthVal = document.getElementById('tile-growth-val');
    if (xEl) xEl.textContent = gridX;
    if (yEl) yEl.textContent = gridY;
    if (curTypeEl) curTypeEl.textContent = BIOME_NAME[tile.type] || `Type ${tile.type}`;
    if (curGrowthEl) curGrowthEl.textContent = tile.type === 2 ? `Growth: ${Math.round((tile.crop_growth || 0) * 100)}%` : '';
    if (growthRow) growthRow.style.display = (tile.type === 2) ? 'flex' : 'none';
    if (growthRange) growthRange.value = tile.crop_growth || 0;
    if (growthVal) growthVal.textContent = Math.round((tile.crop_growth || 0) * 100) + '%';
    document.querySelectorAll('.tile-type-btn').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.type || '0', 10) === tile.type);
    });
    const pop = document.getElementById('tile-editor-popup');
    if (pop) pop.style.display = 'block';
    console.log(`🖌️ [TileEdit] Open editor for (${gridX},${gridY}) type=${tile.type}`);
}

// النقر فوق منطقة فارغة → إلغاء التحديد أو تعديل خلية
app.stage.eventMode = 'static';
app.stage.hitArea = app.screen;
app.stage.on('pointerdown', (e) => {
    const data = (e.data && e.data.global) ? { clientX: e.data.global.x, clientY: e.data.global.y } : null;
    if (!data && e.data && typeof e.data.getLocalPosition === 'function') {
        const sp = e.data.global;
        const gc = document.getElementById('game-container');
        const rect = gc.getBoundingClientRect();
        data = { clientX: rect.left + (sp.x / app.view.width) * rect.width,
                 clientY: rect.top  + (sp.y / app.view.height) * rect.height };
    }
    if (tileEditMode) {
        const gc = document.getElementById('game-container');
        const c2 = gc.getBoundingClientRect();
        const sx = e.data.global.x, sy = e.data.global.y;
        const relClientX = c2.left + (sx / app.view.width) * c2.width;
        const relClientY = c2.top  + (sy / app.view.height) * c2.height;
        const cell = _screenToGridCell(relClientX, relClientY);
        if (cell) {
            console.log(`🖱️ [TileEdit] Clicked cell (${cell.x},${cell.y})`);
            openTileEditor(cell.x, cell.y);
        }
        return;
    }
    if (e.target === app.stage && selectedAgentId !== null) {
        console.log("👆 [Selection] Deselected (clicked empty stage).");
        if (agentSprites.has(selectedAgentId)) agentSprites.get(selectedAgentId).selRing.visible = false;
        selectedAgentId = null;
        const selNameEl = document.getElementById('god-selected-agent-name');
        const openBtn = document.getElementById('god-open-edit-btn');
        if (selNameEl) selNameEl.textContent = '—';
        if (openBtn) { openBtn.disabled = true; openBtn.style.opacity = '0.5'; }
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
        currentDarkness = darkness;   // تصدير للـ SpriteFactory / God Mode
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
    // Particle counts (مستخرجة من isMobile أعلى الملف) — override إذا كان المستخدم يريد تخصيص
    // (يتم استخدام الثوابت العالمية PARTICLE_RAIN_COUNT الخ.)
    let pcRain = null, pcSnow = null, pcLeaves = null, pcFireflies = null;
    const allParticles = { rain: [], snow: [], leaves: [], fireflies: [] };

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
    const TEX_FIREFLY = _makeTexture((ctx, w, h) => {
        // دائرة متدرجة بيضاء نقية -> Bloom ADD مع tint أصفر يعطي التوهج
        const grad = ctx.createRadialGradient(w/2, h/2, 0, w/2, h/2, w/2);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(0.5, 'rgba(255,255,255,0.65)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
    }, 10, 10);

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
        // Fireflies (يراعات — توهج ADD للغابات ليلاً)
        if (!pcFireflies) {
            pcFireflies = new PIXI.ParticleContainer(PARTICLE_FIREFLY_COUNT, {
                position: true, rotation: false, scale: false, uvs: false, alpha: true, tint: true
            });
            pcFireflies.blendMode = PIXI.BLEND_MODES.ADD;
            weatherParticleLayer.addChild(pcFireflies);
            pcFireflies.visible = false;
            const tints = [0xfff59d, 0xffd54f, 0xffca28, 0xb2ff59, 0x76ff03];
            for (let i = 0; i < PARTICLE_FIREFLY_COUNT; i++) {
                const s = new PIXI.Sprite(TEX_FIREFLY);
                s.tint = tints[Math.floor(Math.random() * tints.length)];
                s.alpha = 0.5 + Math.random() * 0.5;
                s.x = Math.random() * MAP_WIDTH;
                s.y = Math.random() * MAP_HEIGHT;
                s._vx = (Math.random() - 0.5) * 0.8;
                s._vy = (Math.random() - 0.5) * 0.6;
                s._phase = Math.random() * 6.28;
                s._pref = {
                    bx: 40 + Math.random() * (MAP_WIDTH - 80),
                    by: 40 + Math.random() * (MAP_HEIGHT - 80),
                };
                allParticles.fireflies.push(s);
                pcFireflies.addChild(s);
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
        // اليراعات: تُحسب كل إطار بناءً على currentDarkness (ليلى فقط، خريف/صيف/ربيع)
        // (سنقوم بتحديثها في tickFrame أدناه بناءً على الظلام الفعلي)

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
        // اليراعات (Bloom ADD) مرئية ليلاً إذا darkness > 0.65 ولم يكن الشتاء
        if (pcFireflies) {
            const nightOK = currentDarkness > 0.65 && currentSeason !== 'winter';
            pcFireflies.visible = nightOK;
            if (nightOK) {
                allParticles.fireflies.forEach(s => {
                    s._phase += 0.03 * delta;
                    // تجوال عشوائي حول preferred area
                    s._vx += ((Math.random() - 0.5) * 0.3 - (s.x - s._pref.bx) / MAP_WIDTH * 0.1) * delta;
                    s._vy += ((Math.random() - 0.5) * 0.25 - (s.y - s._pref.by) / MAP_HEIGHT * 0.1) * delta;
                    s._vx = Math.max(-1.3, Math.min(1.3, s._vx * 0.98));
                    s._vy = Math.max(-1.1, Math.min(1.1, s._vy * 0.98));
                    s.x += s._vx * delta;
                    s.y += s._vy * delta;
                    // لف حول الحواف
                    if (s.x < 0) s.x = MAP_WIDTH - 1;
                    if (s.x > MAP_WIDTH) s.x = 1;
                    if (s.y < 0) s.y = MAP_HEIGHT - 1;
                    if (s.y > MAP_HEIGHT) s.y = 1;
                    // وميض طبيعي
                    s.alpha = 0.35 + (0.5 + 0.5 * Math.sin(s._phase * 3 + s._vx * 7)) * 0.6;
                });
            }
        }
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
        // تدرج ألوان الخريطة المصغرة (7 biomes كاملة)
        for (let y = 0; y < GRID_SIZE; y++) {
            for (let x = 0; x < GRID_SIZE; x++) {
                const c = cachedGrid[y][x];
                const t = c.type;
                if (t === 1)      ctx.fillStyle = '#1565C0';   // Water
                else if (t === 2) ctx.fillStyle = '#6D4C41';   // Farmland
                else if (t === 3) ctx.fillStyle = '#2E7D32';   // Forest
                else if (t === 4) ctx.fillStyle = '#FDD835';   // Desert
                else if (t === 5) ctx.fillStyle = '#E3F2FD';   // Snow
                else if (t === 6) ctx.fillStyle = '#558B2F';   // Swamp
                else ctx.fillStyle = ((x+y)%2===0) ? '#7CB342' : '#8BC34A'; // Plains
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
        // نرسم Minimap كل MINIMAP_INTERVAL ticks (توفير أداء — Mobile 30, Desktop 15)
        if (_minimapCounter >= MINIMAP_INTERVAL) {
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
        const cx = w / 2, cy = h / 2;
        const maxR = Math.hypot(cx, cy);
        // دوائر حلقية مركزية متداخلة — رسمة واحدة فقط عند resize
        const RINGS = 36;
        for (let i = RINGS; i >= 1; i--) {
            const t = i / RINGS;
            const alpha = 0.46 * (1 - t);
            vignetteOverlay.beginFill(0x000000, Math.min(0.68, alpha));
            vignetteOverlay.drawCircle(cx, cy, maxR * t);
            vignetteOverlay.endFill();
        }
        // طبقة خارجية خفيفة جداً لضمان انسياب الحواف
        vignetteOverlay.beginFill(0x000000, 0.18);
        vignetteOverlay.drawRect(0, 0, w, h);
        vignetteOverlay.endFill();
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

// [ENGINE] Phase 4 Tilemap — HTML5 Canvas 2D with 50x50 grid, 32x32 tiles, pan/zoom, 10 agent circles
function initTilemapEngine() {
    const canvas = document.createElement('canvas');
    canvas.id = 'tilemap-canvas';
    canvas.width = 1600; canvas.height = 1600;
    canvas.style.display = 'block';
    canvas.style.borderRadius = '8px';
    const ctx = canvas.getContext('2d');
    const container = document.getElementById('game-container');
    if (container) container.appendChild(canvas);

    const TILE_SIZE = 32;
    const GRID_W = 50; const GRID_H = 50;
    let offsetX = 0; let offsetY = 0; let scale = 1;
    let isDragging = false; let dragStart = { x: 0, y: 0 };

    // Tile colors (pixel-art style)
    const TILE_COLORS = {
        0: '#7cb342', 1: '#1565c0', 2: '#6d4c41', 3: '#2e7d32',
        4: '#fdd835', 5: '#e3f2fd', 6: '#558b2f'
    };

    function drawGrid() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.translate(offsetX, offsetY);
        ctx.scale(scale, scale);
        for (let y = 0; y < GRID_H; y++) {
            for (let x = 0; x < GRID_W; x++) {
                const type = (x + y) % 7;
                ctx.fillStyle = TILE_COLORS[type] || TILE_COLORS[0];
                ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
                // Pixel border
                ctx.strokeStyle = 'rgba(0,0,0,0.15)';
                ctx.lineWidth = 0.5;
                ctx.strokeRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
            }
        }
        // Render 10 agent circles with labels
        for (let i = 0; i < 10; i++) {
            const ax = (i * 5 + 2) * TILE_SIZE + TILE_SIZE / 2;
            const ay = (i * 3 + 3) * TILE_SIZE + TILE_SIZE / 2;
            ctx.beginPath();
            ctx.arc(ax, ay, 10, 0, Math.PI * 2);
            ctx.fillStyle = i % 2 === 0 ? '#3b82f6' : '#ec4899';
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.fillStyle = '#fff';
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`A${i + 1}`, ax, ay);
        }
        ctx.restore();
    }

    // Pan (mouse drag)
    canvas.addEventListener('mousedown', (e) => {
        isDragging = true;
        dragStart = { x: e.clientX, y: e.clientY };
        canvas.style.cursor = 'grabbing';
    });
    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        offsetX += e.clientX - dragStart.x;
        offsetY += e.clientY - dragStart.y;
        dragStart = { x: e.clientX, y: e.clientY };
        drawGrid();
    });
    window.addEventListener('mouseup', () => {
        isDragging = false;
        canvas.style.cursor = 'grab';
    });

    // Zoom (scroll wheel)
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.1 : 0.9;
        scale = Math.max(0.5, Math.min(3, scale * factor));
        drawGrid();
    }, { passive: false });

    drawGrid();
    console.log("🗺️ [Engine] Phase 4 Tilemap: 50x50 grid, 32px tiles, pan/zoom, 10 agents rendered.");
}

// Initialize tilemap on boot
initTilemapEngine();

// ============================================================
// ===== DASHBOARD UI UPDATE + EVENT LOG (Colored) ==========
// ============================================================
function updateDashboardCards() {
    const all = Array.from(agentsCache.values());
    const total = all.length;
    const alive = all.filter(a => a.state !== 'dead').length;
    const dead = all.filter(a => a.state === 'dead').length;
    const males = all.filter(a => a.gender === 'male').length;
    const females = total - males;
    const pregnant = all.filter(a => a.gender === 'female' && ((a.pregnant_ticks && a.pregnant_ticks > 0) || a.state === 'pregnant')).length;

    const states = { sleeping:0, eating:0, farming:0, walking:0, idle:0 };
    all.forEach(a => { const s = a.state || 'idle'; if (states[s] !== undefined) states[s]++; });

    // Update stat cards with animation
    const cards = [
        { id: 'total-count', val: total, label: 'Total Agents' },
        { id: 'alive-count', val: alive, label: 'Alive', cls: 'alive' },
        { id: 'dead-count', val: dead, label: 'Dead', cls: 'dead' },
        { id: 'pregnant-count', val: pregnant, label: 'Pregnant' },
        { id: 'male-count', val: males, label: 'Males' },
        { id: 'female-count', val: females, label: 'Females' },
        { id: 'state-sleeping', val: states.sleeping, label: 'Sleeping' },
        { id: 'state-eating', val: states.eating, label: 'Eating' },
        { id: 'state-farming', val: states.farming, label: 'Farming' },
        { id: 'state-walking', val: states.walking, label: 'Walking' },
    ];
    cards.forEach(c => {
        const el = document.getElementById(c.id);
        if (el) {
            el.textContent = c.val;
            if (c.cls) el.classList.add(c.cls);
        }
    });

    // Resources
    let wheat = 0, wood = 0, stone = 0, money = 0;
    let grain = 0, vegetable = 0, fruit = 0, industrial = 0, metal = 0, animal_product = 0;
    all.forEach(a => {
        const inv = a.inventory || {};
        wheat += (inv.wheat || 0); wood += (inv.wood || 0); stone += (inv.stone || 0); money += (a.money || 0);
        grain += ((inv.grain || 0) + (inv.wheat || 0)); vegetable += (inv.vegetable || 0); fruit += (inv.fruit || 0);
        industrial += (inv.industrial || 0); metal += (inv.metal || 0); animal_product += (inv.animal_product || 0);
    });
    const resCards = [
        { id: 'wheat-total', val: wheat }, { id: 'wood-total', val: wood }, { id: 'stone-total', val: stone },
        { id: 'money-total', val: money.toFixed(1) }, { id: 'grain-total', val: grain },
        { id: 'vegetable-total', val: vegetable }, { id: 'fruit-total', val: fruit },
        { id: 'industrial-total', val: industrial }, { id: 'metal-total', val: metal },
        { id: 'animal_product-total', val: animal_product },
    ];
    resCards.forEach(c => { const el = document.getElementById(c.id); if (el) el.textContent = c.val; });

    // Season / Weather / Price
    const seasonEl = document.getElementById('season-val');
    if (seasonEl) seasonEl.textContent = currentSeason ? currentSeason.charAt(0).toUpperCase() + currentSeason.slice(1) : 'Spring';
    const weatherEl = document.getElementById('weather-val');
    if (weatherEl) weatherEl.textContent = currentWeather ? currentWeather.charAt(0).toUpperCase() + currentWeather.slice(1) : 'Clear';
    const priceEl = document.getElementById('wheat-price');
    if (priceEl) {
        const aliveAgents = all.filter(a => a.state !== 'dead').length;
        const supplyFactor = wheat > 0 ? Math.min(2, 50 / Math.max(1, wheat)) : 2.0;
        const demandFactor = aliveAgents > 0 ? Math.min(1.5, aliveAgents / 10) : 1.0;
        priceEl.textContent = (1.0 * supplyFactor * demandFactor).toFixed(2);
    }

    // Demographics (English labels)
    function renderTop5(ulId, arr, labelFn) {
        const ul = document.getElementById(ulId);
        if (!ul) return;
        ul.innerHTML = '';
        arr.slice(0, 5).forEach(a => {
            const li = document.createElement('li');
            li.innerHTML = labelFn(a);
            ul.appendChild(li);
        });
    }
    const aliveAgents = all.filter(a => a.state !== 'dead');
    renderTop5('demo-top-money', [...aliveAgents].sort((a,b) => (b.money||0)-(a.money||0)), a => `<span class="demo-rank">${a.name}</span> 💰 <strong>${(a.money||0).toFixed(1)}</strong>`);
    renderTop5('demo-top-hp', [...aliveAgents].sort((a,b) => (b.hp||0)-(a.hp||0)), a => `<span class="demo-rank">${a.name}</span> ❤️ <strong>${Math.round(a.hp||0)}%</strong>`);
    renderTop5('demo-top-intelligence', [...aliveAgents].sort((a,b) => ((b.traits||{}).intelligence||0.5)-((a.traits||{}).intelligence||0.5)), a => `<span class="demo-rank">${a.name}</span> 🧠 <strong>${Math.round(((a.traits||{}).intelligence||0.5)*100)}%</strong>`);
    renderTop5('demo-top-courage', [...aliveAgents].sort((a,b) => ((b.traits||{}).courage||0.5)-((a.traits||{}).courage||0.5)), a => `<span class="demo-rank">${a.name}</span> 🛡️ <strong>${Math.round(((a.traits||{}).courage||0.5)*100)}%</strong>`);
    renderTop5('demo-top-fertility', [...aliveAgents].sort((a,b) => ((b.traits||{}).fertility||0.5)-((a.traits||{}).fertility||0.5)), a => `<span class="demo-rank">${a.name}</span> 👶 <strong>${Math.round(((a.traits||{}).fertility||0.5)*100)}%</strong>`);

    // Animals count
    const gacEl = document.getElementById('god-animals-count');
    if (gacEl) gacEl.textContent = (worldData && worldData.animals ? worldData.animals.length : 0);
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
let _editModeActive = false;
let _currentDetailAgentId = null;

function showAgentDetails(a) {
    _currentDetailAgentId = a.id;
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

    // Money stat row
    const mStatEl = document.getElementById('detail-money-stat');
    if (mStatEl) mStatEl.textContent = a.money ?? 0;

    // ====== Traits ديناميكية: Object.entries ======
    const traitsGrid = document.getElementById('detail-traits');
    if (traitsGrid) {
        traitsGrid.innerHTML = '';
        const tr = a.traits || {};
        Object.entries(tr).forEach(([key, val]) => {
            const vv = typeof val === 'number' ? val : 0.5;
            const pct = Math.round(vv * 100);
            const labelNice = key.charAt(0).toUpperCase() + key.slice(1).replace(/([a-z])([A-Z])/g, '$1 $2');
            const div = document.createElement('div');
            div.className = 'trait-item';
            div.innerHTML = `<span>${labelNice}</span><div class="mini-bar"><div style="width:${pct}%"></div></div>`;
            traitsGrid.appendChild(div);
        });
    }

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

    // ====== Edit Mode: تعبئة حقول الإدخال + Sliders بالقيم الحالية ======
    const eHp = document.getElementById('edit-hp');
    const eHpR = document.getElementById('edit-hp-range');
    const eHunger = document.getElementById('edit-hunger');
    const eHungerR = document.getElementById('edit-hunger-range');
    const eEnergy = document.getElementById('edit-energy');
    const eEnergyR = document.getElementById('edit-energy-range');
    const eMood = document.getElementById('edit-mood');
    const eMoodR = document.getElementById('edit-mood-range');
    const eMoney = document.getElementById('edit-money');
    const eState = document.getElementById('edit-state');
    const hpVal = Math.round(a.hp ?? 0);
    const hungerVal = Math.round(a.hunger ?? 0);
    const energyVal = Math.round(a.energy ?? 0);
    const moodVal = Math.round(a.mood ?? 0);
    if (eHp) eHp.value = hpVal;
    if (eHpR) eHpR.value = hpVal;
    if (eHunger) eHunger.value = hungerVal;
    if (eHungerR) eHungerR.value = hungerVal;
    if (eEnergy) eEnergy.value = energyVal;
    if (eEnergyR) eEnergyR.value = energyVal;
    if (eMood) eMood.value = moodVal;
    if (eMoodR) eMoodR.value = moodVal;
    if (eMoney) eMoney.value = (a.money ?? 0).toFixed(2);
    if (eState) eState.value = (a.state || 'idle');

    // حفظ snapshot للـ Rollback عند الضغط على Cancel أو فشل الحفظ
    _agentEditSnapshot = JSON.parse(JSON.stringify(a));

    if (_editModeActive) {
        _applyEditModeVisuals(true);
    }

    document.getElementById('agent-details-popup').style.display = 'block';
}

function _applyEditModeVisuals(active) {
    const fieldWraps = document.querySelectorAll('.edit-field-wrap');
    const editSelects = document.querySelectorAll('.edit-select');
    const saveBtn = document.getElementById('edit-save-btn');
    const cancelBtn = document.getElementById('edit-cancel-btn');
    const toggleBtn = document.getElementById('edit-toggle-btn');
    const stateBadge = document.getElementById('detail-state-badge');
    const hpNum = document.getElementById('detail-hp-num');
    const hungerNum = document.getElementById('detail-hunger-num');
    const energyNum = document.getElementById('detail-energy-num');
    const moodNum = document.getElementById('detail-mood-num');
    const moneyNum = document.getElementById('detail-money-stat');

    fieldWraps.forEach(w => { w.style.display = active ? 'flex' : 'none'; });
    editSelects.forEach(s => { s.style.display = active ? 'inline-block' : 'none'; });
    if (saveBtn) saveBtn.style.display = active ? 'inline-flex' : 'none';
    if (cancelBtn) cancelBtn.style.display = active ? 'inline-flex' : 'none';
    if (stateBadge) stateBadge.style.display = active ? 'none' : 'inline-block';
    if (hpNum) hpNum.style.display = active ? 'none' : 'inline-block';
    if (hungerNum) hungerNum.style.display = active ? 'none' : 'inline-block';
    if (energyNum) energyNum.style.display = active ? 'none' : 'inline-block';
    if (moodNum) moodNum.style.display = active ? 'none' : 'inline-block';
    if (moneyNum) moneyNum.style.display = active ? 'none' : 'inline-block';
    if (toggleBtn) {
        toggleBtn.classList.toggle('active', active);
        toggleBtn.innerHTML = active ? '✏️ Editing…' : '✏️';
    }
}

async function _saveAgentEdits() {
    if (_currentDetailAgentId == null) return;
    const updates = {};
    const eHp = document.getElementById('edit-hp');
    const eHunger = document.getElementById('edit-hunger');
    const eEnergy = document.getElementById('edit-energy');
    const eMood = document.getElementById('edit-mood');
    const eMoney = document.getElementById('edit-money');
    const eState = document.getElementById('edit-state');
    if (eHp && eHp.value !== '') updates.hp = Number(eHp.value);
    if (eHunger && eHunger.value !== '') updates.hunger = Number(eHunger.value);
    if (eEnergy && eEnergy.value !== '') updates.energy = Number(eEnergy.value);
    if (eMood && eMood.value !== '') updates.mood = Number(eMood.value);
    if (eMoney && eMoney.value !== '') updates.money = Number(eMoney.value);
    if (eState && eState.value.trim() !== '') updates.state = eState.value.trim().toLowerCase();

    if (Object.keys(updates).length === 0) {
        console.log("💾 [Edit] No changes to save.");
        return;
    }

    // ====== Optimistic UI: تطبيق محلي فوري ======
    const snapshot = _agentEditSnapshot ? JSON.parse(JSON.stringify(_agentEditSnapshot)) : null;
    const prevCached = agentsCache.get(_currentDetailAgentId);
    try {
        if (prevCached) {
            const optimistic = Object.assign({}, prevCached, updates);
            if (updates.money != null && optimistic.inventory) {
                optimistic.inventory = Object.assign({}, optimistic.inventory, { money: updates.money });
            }
            agentsCache.set(_currentDetailAgentId, optimistic);
            SpriteFactory.drawAgent(optimistic);
            showAgentDetails(optimistic);
            _editModeActive = false;
            _applyEditModeVisuals(false);
        }

        const res = await fetch(`${BACKEND_URL}/api/admin/agent`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agent_id: _currentDetailAgentId, updates })
        });
        const data = await res.json();
        if (!data.ok) {
            // ====== Rollback ======
            console.warn("🔄 [Edit] Server rejected, rolling back...", data.error);
            if (snapshot) {
                agentsCache.set(_currentDetailAgentId, snapshot);
                SpriteFactory.drawAgent(snapshot);
                showAgentDetails(snapshot);
            }
            alert("Save failed: " + (data.error || "unknown"));
            return;
        }
        console.log("💾 [Edit] Saved successfully (confirmed by server).", data);
        if (data.agent) {
            agentsCache.set(data.agent.id, data.agent);
            SpriteFactory.drawAgent(data.agent);
        }
        updateDashboardCards();
    } catch (err) {
        console.error("❌ [Edit] Save failed, rolling back:", err);
        if (snapshot) {
            agentsCache.set(_currentDetailAgentId, snapshot);
            SpriteFactory.drawAgent(snapshot);
            showAgentDetails(snapshot);
        }
        alert("Network error while saving — changes reverted.");
    }
}

// إلغاء التعديلات وإعادة Snapshot
function _cancelAgentEdits() {
    if (_agentEditSnapshot && _currentDetailAgentId != null) {
        agentsCache.set(_currentDetailAgentId, JSON.parse(JSON.stringify(_agentEditSnapshot)));
        SpriteFactory.drawAgent(_agentEditSnapshot);
        showAgentDetails(_agentEditSnapshot);
    }
    _editModeActive = false;
    _applyEditModeVisuals(false);
    console.log("❌ [Edit] Changes cancelled (rolled back to snapshot).");
}

// ربط Slider ↔ Number Input بطريقة ثنائية الاتجاه
function _linkSliderAndNumber(rangeId, numId, transformOut) {
    const rEl = document.getElementById(rangeId);
    const nEl = document.getElementById(numId);
    if (!rEl || !nEl) return;
    rEl.addEventListener('input', () => {
        nEl.value = transformOut ? transformOut(Number(rEl.value)) : rEl.value;
    });
    nEl.addEventListener('input', () => {
        const v = Number(nEl.value);
        if (!Number.isNaN(v)) {
            rEl.value = Math.max(Number(rEl.min), Math.min(Number(rEl.max), v));
        }
    });
}

(function bindPopupUI() {
    // ===== ربط Sliders ↔ Number Inputs =====
    _linkSliderAndNumber('edit-hp-range', 'edit-hp');
    _linkSliderAndNumber('edit-hunger-range', 'edit-hunger');
    _linkSliderAndNumber('edit-energy-range', 'edit-energy');
    _linkSliderAndNumber('edit-mood-range', 'edit-mood');

    const popup = document.getElementById('agent-details-popup');
    popup.querySelector('.close-button').addEventListener('click', () => {
        popup.style.display = 'none';
        _editModeActive = false;
        _applyEditModeVisuals(false);
        console.log("❌ [Popup] Closed via X.");
    });
    window.addEventListener('click', (e) => {
        if (e.target === popup) {
            popup.style.display = 'none';
            _editModeActive = false;
            _applyEditModeVisuals(false);
            console.log("❌ [Popup] Closed via outside click.");
        }
    });

    const tog = document.getElementById('edit-toggle-btn');
    if (tog) tog.addEventListener('click', () => {
        _editModeActive = !_editModeActive;
        _applyEditModeVisuals(_editModeActive);
        console.log(`✏️ [Edit] Mode ${_editModeActive ? 'ENABLED' : 'DISABLED'}`);
    });
    const sv = document.getElementById('edit-save-btn');
    if (sv) sv.addEventListener('click', _saveAgentEdits);
    const cn = document.getElementById('edit-cancel-btn');
    if (cn) cn.addEventListener('click', _cancelAgentEdits);

    // زر "Open Editor" من God Mode Tab
    const godOpen = document.getElementById('god-open-edit-btn');
    if (godOpen) godOpen.addEventListener('click', () => {
        if (selectedAgentId == null) return;
        const a = agentsCache.get(selectedAgentId);
        if (!a) return;
        showAgentDetails(a);
        _editModeActive = true;
        _applyEditModeVisuals(true);
        console.log(`✏️ [GodMode] Opened editor for agent #${selectedAgentId}.`);
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

async function sendControlCommand(action, value = null, payload = null) {
    console.log(`🎮 [Control] action="${action}"${value !== null ? `, value=${value}` : ''}${payload !== null ? `, payload=${JSON.stringify(payload)}` : ''}`);
    SoundManager.ensureUnlocked(); SoundManager.play('click');
    try {
        const body = { action };
        if (value !== null) body.value = value;
        if (payload !== null) body.payload = payload;
        const res = await fetch(`${BACKEND_URL}/api/world/control`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) console.error("❌ [Control] Backend responded:", res.statusText, data);
        else {
            console.log("✅ [Control] Delivered.", data);
            // Update animals count if spawn_animals returned it
            if (data && data.animals_count != null) {
                const gacEl = document.getElementById('god-animals-count');
                if (gacEl) gacEl.textContent = data.animals_count;
            }
        }

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

// تفعيل/إيقاف وضع تعديل الخلايا (Tile Edit Mode)
function _setTileEditMode(on) {
    tileEditMode = !!on;
    const gc = document.getElementById('game-container');
    const statusEl = document.getElementById('tile-edit-status');
    const toggleBtn = document.getElementById('tile-edit-toggle-btn');
    if (gc) gc.classList.toggle('tile-edit-mode', tileEditMode);
    if (statusEl) {
        statusEl.textContent = tileEditMode ? 'ON' : 'OFF';
        statusEl.classList.toggle('active', tileEditMode);
    }
    if (toggleBtn) toggleBtn.classList.toggle('active', tileEditMode);
    console.log(`🖌️ [TileEdit] Mode → ${tileEditMode ? 'ENABLED' : 'DISABLED'}`);
}

// إغلاق نافذة Tile Editor
function _closeTileEditor() {
    const pop = document.getElementById('tile-editor-popup');
    if (pop) pop.style.display = 'none';
    _tileEditorTarget = null;
    _tileEditorSnapshot = null;
}

// إرسال تعديل خلية إلى الـ Backend مع Optimistic UI
async function _applyTileEdit() {
    if (!_tileEditorTarget) return;
    const { x, y } = _tileEditorTarget;
    const activeBtn = document.querySelector('.tile-type-btn.active');
    const tileType = activeBtn ? parseInt(activeBtn.dataset.type || '0', 10) : 0;
    const growthEl = document.getElementById('tile-growth-range');
    const cropGrowth = (tileType === 2 && growthEl) ? Number(growthEl.value) : 0.0;

    const snapshot = _tileEditorSnapshot ? { ..._tileEditorSnapshot } : null;
    // ===== Optimistic UI =====
    if (cachedGrid[y] && cachedGrid[y][x]) {
        Object.assign(cachedGrid[y][x], {
            type: tileType,
            crop_growth: cropGrowth,
            crop_type: tileType === 2 ? (cachedGrid[y][x].crop_type || null) : null,
        });
        drawMapDetails(cachedGrid);
    }
    try {
        const res = await fetch(`${BACKEND_URL}/api/admin/tile`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ x, y, tile_type: tileType, crop_growth: cropGrowth })
        });
        const data = await res.json();
        if (!data.ok) {
            console.warn("🔄 [TileEdit] Server rejected, rollback:", data.error);
            if (snapshot && cachedGrid[y] && cachedGrid[y][x]) {
                Object.assign(cachedGrid[y][x], snapshot);
                drawMapDetails(cachedGrid);
            }
            alert("Tile edit failed: " + (data.error || "unknown"));
            return;
        }
        console.log(`💾 [TileEdit] Applied (${x},${y})→type=${tileType} growth=${cropGrowth}`, data);
        _closeTileEditor();
    } catch (err) {
        console.error("❌ [TileEdit] Network error, rollback:", err);
        if (snapshot && cachedGrid[y] && cachedGrid[y][x]) {
            Object.assign(cachedGrid[y][x], snapshot);
            drawMapDetails(cachedGrid);
        }
        alert("Network error while editing tile — reverted.");
    }
}

// ============================================================
// ===== TABS SWITCHING + GOD MODE BINDINGS ==================
// ============================================================
(function bindTabsAndGodMode() {
    // Tabs switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.tab;
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            const tPanel = document.getElementById(target);
            if (tPanel) tPanel.classList.add('active');
            SoundManager.ensureUnlocked(); SoundManager.play('click');
            console.log(`📑 [Tabs] Switched → ${target}`);
        });
    });

    // Collapsible sections inside God Mode Tab
    document.querySelectorAll('.section-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.dataset.target;
            const content = document.getElementById(targetId);
            if (!content) return;
            const collapsed = content.classList.toggle('collapsed');
            btn.textContent = btn.textContent.replace(/▾|▸/g, collapsed ? '▸' : '▾');
            SoundManager.ensureUnlocked(); SoundManager.play('click');
        });
    });

    // ===== Tile Edit Mode Toggle =====
    const tileToggleBtn = document.getElementById('tile-edit-toggle-btn');
    if (tileToggleBtn) tileToggleBtn.addEventListener('click', () => {
        _setTileEditMode(!tileEditMode);
        SoundManager.ensureUnlocked(); SoundManager.play('click');
    });

    // ===== Tile Type Buttons inside Tile Editor =====
    document.querySelectorAll('.tile-type-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tile-type-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const t = parseInt(btn.dataset.type || '0', 10);
            const growthRow = document.getElementById('tile-growth-row');
            if (growthRow) growthRow.style.display = (t === 2) ? 'flex' : 'none';
            SoundManager.ensureUnlocked(); SoundManager.play('click');
        });
    });
    // Tile growth slider live display
    const tGrowth = document.getElementById('tile-growth-range');
    const tGrowthVal = document.getElementById('tile-growth-val');
    if (tGrowth && tGrowthVal) {
        tGrowth.addEventListener('input', () => {
            tGrowthVal.textContent = Math.round(Number(tGrowth.value) * 100) + '%';
        });
    }
    // Tile editor close/cancel/apply
    const tClose = document.querySelector('#tile-editor-popup .tile-close');
    if (tClose) tClose.addEventListener('click', () => {
        if (_tileEditorSnapshot && _tileEditorTarget) {
            const { x, y } = _tileEditorTarget;
            if (cachedGrid[y] && cachedGrid[y][x]) Object.assign(cachedGrid[y][x], _tileEditorSnapshot);
            drawMapDetails(cachedGrid);
        }
        _closeTileEditor();
    });
    const tCancel = document.getElementById('tile-cancel-btn');
    if (tCancel) tCancel.addEventListener('click', () => {
        if (_tileEditorSnapshot && _tileEditorTarget) {
            const { x, y } = _tileEditorTarget;
            if (cachedGrid[y] && cachedGrid[y][x]) Object.assign(cachedGrid[y][x], _tileEditorSnapshot);
            drawMapDetails(cachedGrid);
        }
        _closeTileEditor();
    });
    const tApply = document.getElementById('tile-apply-btn');
    if (tApply) tApply.addEventListener('click', _applyTileEdit);
    // Outside click closes tile editor (with rollback)
    window.addEventListener('click', (e) => {
        const pop = document.getElementById('tile-editor-popup');
        if (pop && e.target === pop) {
            if (_tileEditorSnapshot && _tileEditorTarget) {
                const { x, y } = _tileEditorTarget;
                if (cachedGrid[y] && cachedGrid[y][x]) Object.assign(cachedGrid[y][x], _tileEditorSnapshot);
                drawMapDetails(cachedGrid);
            }
            _closeTileEditor();
        }
    });

    // God Mode — Weather
    document.querySelectorAll('.weather-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const w = btn.dataset.weather;
            console.log(`🌤️ [GodMode] Force weather → ${w}`);
            sendControlCommand('force_weather', null, w);
            WeatherManager.applyWeather(w, currentSeason);
        });
    });

    // God Mode — Season
    document.querySelectorAll('.season-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const s = btn.dataset.season;
            console.log(`🌱 [GodMode] Force season → ${s}`);
            sendControlCommand('force_season', null, s);
            WeatherManager.applyWeather(currentWeather, s);
        });
    });

    // God Mode — Spawn Animals (legacy buttons + new .global-cmd)
    document.querySelectorAll('.spawn-btn').forEach(btn => {
        if (btn.classList.contains('global-cmd')) return; // handled below
        btn.addEventListener('click', () => {
            const c = parseInt(btn.dataset.count || '5', 10);
            console.log(`🐄 [GodMode] Spawn ${c} animals`);
            sendControlCommand('spawn_animals', c);
        });
    });

    // ===== Global Commands (.global-cmd buttons) =====
    document.querySelectorAll('.global-cmd').forEach(btn => {
        btn.addEventListener('click', async () => {
            const action = btn.dataset.action || '';
            const value = btn.dataset.value;
            const numValue = (value !== undefined && value !== '')
                ? (isNaN(Number(value)) ? value : Number(value))
                : null;
            console.log(`⚡ [GodMode] Global command → ${action}`, numValue != null ? `value=${numValue}` : '');
            SoundManager.ensureUnlocked(); SoundManager.play('click');
            // تأكيد خطير للأوامر القاتلة
            if (action === 'kill_all' && !confirm("☠️ Are you sure you want to KILL ALL agents?")) return;
            // تنفيذ الأمر عبر world/control
            sendControlCommand(action, numValue, numValue);
            // تحديثات محلية فورية للأوامر الشائعة (Optimistic UI خفيف)
            if (action === 'fill_all_needs') {
                agentsCache.forEach((a, id) => {
                    if (a.state !== 'dead') {
                        const opt = Object.assign({}, a, { hp: 100, energy: 100, hunger: 0, mood: 80 });
                        agentsCache.set(id, opt);
                        SpriteFactory.drawAgent(opt);
                    }
                });
            } else if (action === 'give_money_all') {
                const amt = numValue || 0;
                agentsCache.forEach((a, id) => {
                    if (a.state !== 'dead') {
                        const opt = Object.assign({}, a, { money: (Number(a.money) || 0) + Number(amt) });
                        if (opt.inventory) opt.inventory = Object.assign({}, opt.inventory, { money: opt.money });
                        agentsCache.set(id, opt);
                        SpriteFactory.drawAgent(opt);
                    }
                });
            }
            updateDashboardCards();
        });
    });
})();

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

// ============================================================
// SIDEBAR TOGGLE (Hamburger Button + Backdrop)
// ============================================================
(function _bindSidebarToggle() {
    const toggle = document.getElementById('sidebar-toggle');
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    if (!toggle || !sidebar) return;

    function setSidebar(open) {
        if (open) sidebar.classList.add('open');
        else sidebar.classList.remove('open');
        if (backdrop) {
            if (open) backdrop.classList.add('visible');
            else backdrop.classList.remove('visible');
        }
        SoundManager.ensureUnlocked(); SoundManager.play('click');
        console.log(`📱 [Sidebar] ${open ? 'Opened' : 'Closed'}`);
    }
    toggle.addEventListener('click', (e) => {
        e.preventDefault();
        const open = !sidebar.classList.contains('open');
        setSidebar(open);
    });
    if (backdrop) backdrop.addEventListener('click', () => setSidebar(false));
})();

// ============================================================
// MOBILE BOTTOM NAVIGATION — Tabs Sync + Sidebar Open
// ============================================================
(function _bindMobileNav() {
    const btns = document.querySelectorAll('#mobile-nav .nav-btn');
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    if (btns.length === 0) return;

    function _activateNav(target) {
        btns.forEach(b => b.classList.toggle('active', b.dataset.tab === target));
    }
    // مزامنة مع الأزرار الأصلية في الـ Sidebar
    document.querySelectorAll('.tab-btn').forEach(origBtn => {
        origBtn.addEventListener('click', () => {
            const t = origBtn.dataset.tab;
            if (t) _activateNav(t);
        });
    });

    btns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            _activateNav(tab);
            // اضغط زر الـ Tab المطابق داخل الـ Sidebar
            let clicked = false;
            document.querySelectorAll('.tab-btn').forEach(origBtn => {
                if (origBtn.dataset.tab === tab) {
                    origBtn.click();
                    clicked = true;
                }
            });
            // فتح الـ Sidebar إذا كان موجوداً
            if (sidebar) {
                sidebar.classList.add('open');
                if (backdrop) backdrop.classList.add('visible');
            }
            SoundManager.ensureUnlocked(); SoundManager.play('click');
            console.log(`📱 [Mobile Nav] Switched to tab: ${tab} (originalBtnClicked=${clicked})`);
        });
    });
})();

// ============================================================
// PIXI RENDERER RESIZE — تكييف مع حجم الـ #game-container
// ============================================================
(function _bindResize() {
    window.addEventListener('resize', _resizeRenderer);
    window.addEventListener('orientationchange', _resizeRenderer);
    setTimeout(_resizeRenderer, 120);
    setTimeout(_resizeRenderer, 600);
})();
function _resizeRenderer() {
    const gc = document.getElementById('game-container');
    if (!gc) return;
    const rect = gc.getBoundingClientRect();
    const targetW = Math.max(200, Math.floor(rect.width));
    const targetH = Math.max(200, Math.floor(rect.height));
    try { app.renderer.resize(targetW, targetH); } catch (_) {}
}

// ============================================================
// FPS MONITOR (Console only — every 2s if isMobile)
// ============================================================
(function _fpsMonitor() {
    if (!_FPS_LOG) return;
    let fpsCounter = 0;
    let lastFpsUpdate = Date.now();
    let worstFps = 999;
    app.ticker.add(() => {
        fpsCounter++;
        const now = Date.now();
        const dt = now - lastFpsUpdate;
        if (dt >= 2000) {
            const fps = Math.round((fpsCounter * 1000) / dt);
            worstFps = Math.min(worstFps, fps);
            const isLow = isMobile ? fps < 30 : fps < 45;
            const tag = isLow ? '⚠️' : '📊';
            console.log(`${tag} [FPS] avg=${fps}fps  worst_min=${worstFps}fps  isMobile=${isMobile}`);
            fpsCounter = 0;
            lastFpsUpdate = now;
        }
    });
})();

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

// ============================================================
// ====== PHASE 2: 200-ENTITY JSON REGISTRY (Codex) =============
// ============================================================
let entityRegistry = null;

async function loadEntityRegistry() {
    try {
        const res = await fetch('src/data/registry.json');
        entityRegistry = await res.json();
        console.log(`📚 [Codex] Registry loaded: ${entityRegistry.total_entities} entities`);
        renderCodexGrid();
    } catch (err) {
        console.error("❌ [Codex] Failed to load registry:", err);
    }
}

function renderCodexGrid(filterText = '') {
    const grid = document.getElementById('codex-grid');
    if (!grid || !entityRegistry) return;
    grid.innerHTML = '';
    const filter = filterText.toLowerCase();
    const categories = ['agents', 'wildlife', 'flora', 'structures', 'resources'];
    categories.forEach(cat => {
        const items = (entityRegistry.categories[cat]?.items || []).filter(e =>
            e.name.toLowerCase().includes(filter) || e.entity_id.toLowerCase().includes(filter)
        );
        items.forEach(e => {
            const card = document.createElement('div');
            card.className = 'codex-card';
            card.innerHTML = `
                <h4>${e.name}</h4>
                <div class="entity-meta">${e.category} · ${e.entity_id}</div>
                <div class="entity-stats">
                    <span class="stat-pill">HP ${e.stats.hp}</span>
                    <span class="stat-pill">SPD ${e.stats.speed}</span>
                    <span class="stat-pill">${e.stats.rarity}</span>
                </div>
            `;
            grid.appendChild(card);
        });
    });
}

(function bindCodexUI() {
    const filterInput = document.getElementById('codex-filter');
    if (filterInput) {
        filterInput.addEventListener('input', (e) => renderCodexGrid(e.target.value));
    }
    const closeBtn = document.getElementById('codex-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            document.getElementById('codex-panel').style.display = 'none';
        });
    }
})();

loadEntityRegistry();

// ============================================================
// ====== PHASE 4: CREATIVE POLISH (Particles, Camera, Audio, Tooltips) =======
// ============================================================
// Enhanced particle pooling with bloom effects
const ENHANCED_PARTICLE_POOL = {
    rain: { max: PARTICLE_RAIN_COUNT, texture: null, tint: 0x89c2ff },
    snow: { max: PARTICLE_SNOW_COUNT, texture: null, tint: 0xffffff },
    leaves: { max: PARTICLE_LEAF_COUNT, texture: null, tint: 0xe08a3e },
    fireflies: { max: PARTICLE_FIREFLY_COUNT, texture: null, tint: 0xffd54f }
};

// Smooth Lerp Camera Follow (enhanced)
function smoothCameraFollow(delta) {
    if (followAgentId !== null && agentSprites.has(followAgentId)) {
        const spr = agentSprites.get(followAgentId);
        const targetPanX = spr.x - MAP_WIDTH / 2;
        const targetPanY = spr.y - MAP_HEIGHT / 2;
        const easeFactor = 0.06 * delta;
        panOffsetX += (targetPanX - panOffsetX) * easeFactor;
        panOffsetY += (targetPanY - panOffsetY) * easeFactor;
        _applyTransform();
    }
}

// Tooltip Micro-interaction System
function showTooltip(x, y, text) {
    const tooltip = document.getElementById('tooltip') || document.createElement('div');
    tooltip.id = 'tooltip';
    tooltip.className = 'glass-tooltip';
    tooltip.textContent = text;
    tooltip.style.position = 'fixed';
    tooltip.style.left = x + 'px';
    tooltip.style.top = y + 'px';
    tooltip.style.zIndex = '300';
    tooltip.style.padding = '6px 12px';
    tooltip.style.background = 'rgba(6,11,20,0.92)';
    tooltip.style.backdropFilter = 'blur(10px)';
    tooltip.style.border = '1px solid rgba(255,255,255,0.15)';
    tooltip.style.borderRadius = '8px';
    tooltip.style.color = '#e8eef7';
    tooltip.style.fontSize = '0.8rem';
    tooltip.style.pointerEvents = 'none';
    tooltip.style.animation = 'fadeIn 0.15s ease';
    if (!document.getElementById('tooltip')) document.body.appendChild(tooltip);
}
function hideTooltip() {
    const tooltip = document.getElementById('tooltip');
    if (tooltip) tooltip.remove();
}

// Enhanced Audio Toggle with Visual Feedback
function enhanceAudioUI() {
    const btn = document.getElementById('mute-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
        SoundManager.ensureUnlocked();
        SoundManager.toggleMute();
        btn.classList.toggle('active', !SoundManager.isMuted);
        btn.innerHTML = SoundManager.isMuted ? '🔇 <span class="tool-text">Muted</span>' : '🔊 <span class="tool-text">Unmuted</span>';
    });
}

// Initialize enhanced polish
enhanceAudioUI();
console.log("✨ [Polish] Enhanced particles, smooth camera, tooltips, audio UI initialized.");

// ============================================================
// ====== PHASE 5-9: 9 SYSTEMS INTEGRATION (Frontend JS) =======
// ============================================================
import { updateSocialAI, initSocialAI } from '../src/systems/social_ai.js';
import { updateEconomy, initEconomy } from '../src/systems/economy.js';
import { updateConflictPolitics, initConflictPolitics } from '../src/systems/conflict_politics.js';
import { updateCulture, initCulture } from '../src/systems/culture.js';
import { updateEnvironment, initEnvironment } from '../src/systems/environment.js';
import { updateGameplay, initGameplay } from '../src/systems/gameplay.js';
import { updateVisual, initVisual } from '../src/systems/visual.js';
import { updateAnalytics, initAnalytics } from '../src/systems/analytics.js';
import { updateObserver, initObserver } from '../src/systems/observer.js';

initSocialAI(); initEconomy(); initConflictPolitics(); initCulture();
initEnvironment(); initGameplay(); initVisual(); initAnalytics(); initObserver();
console.log("📦 [Systems] All 9 frontend systems initialized (Social, Economy, Conflict, Culture, Environment, Gameplay, Visual, Analytics, Observer).");

fetchInitialWorldData();
setupSSE();

console.log("🎉 [BOOT] Microverse v2 Frontend initialized. Open DevTools & try __toggleWeather() / __nextSeason().");
