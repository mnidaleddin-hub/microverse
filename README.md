# Microverse — Phase 1

نواة خلفية لمحاكاة اجتماعية 2D باستخدام FastAPI + SSE + PostgreSQL.

## 🏗️ Architecture

```
app/
├── main.py              # FastAPI + endpoints + lifespan
├── config.py            # إعدادات البيئة
├── database.py          # SQLAlchemy Async engine
├── models.py            # ORM Models
├── schemas.py           # Pydantic Schemas
├── simulation/
│   ├── world.py         # World class + tick loop + SSE broadcast
│   ├── agent.py         # Agent + Utility AI (FSM)
│   ├── farming.py       # Harvest / Plant دوال الزراعة
│   ├── reproduction.py  # دوال التكاثر الفارغة
│   └── pathfinding.py   # BFS يدوي
└── static/index.html    # واجهة المرحلة 1
```

## 🚀 Local Run

```bash
# اختبار محلي بدون Postgres (SQLite)
pip install -r requirements.txt
uvicorn app.main:app --port 7860 --reload
```

افتح المتصفح: `http://localhost:7860`

## 🐳 Docker Local

```bash
docker build -t microverse .
docker run -p 7860:7860 -e DATABASE_URL="sqlite+aiosqlite:///./microverse.db" microverse
```

## ☁️ Hugging Face Spaces Deployment (خطوة بخطوة)

### الخطوة 1: أنشئ قاعدة بيانات على Neon
1. اذهب إلى [neon.tech](https://neon.tech) وأنشئ مشروع جديد
2. انسخ **Connection String** (Pooled) من شاشة Dashboard
3. ستكون بالشكل: `postgresql://...:...@...neon.tech/...?sslmode=require`

### الخطوة 2: أنشئ HF Space Docker
1. اذهب إلى [huggingface.co/new-space](https://huggingface.co/new-space)
2. **License**: أي شيء
3. **Select the Space SDK**: اختر **Docker**
4. **Docker Template**: اختر **Blank**
5. **Space hardware**: اختر **CPU basic • 2 vCPU • 16 GB** (مجاني)
6. اضغط **Create Space**

### الخطوة 3: أضف Repository Secrets
اذهب إلى **Space Settings** → **Repository secrets** وأضف:

| الاسم | القيمة |
|---|---|
| `DATABASE_URL` | سلسلة اتصال Neon الكاملة مع `?sslmode=require` |
| *(اختياري)* `GROQ_API_KEY` | مفتاح Groq (ليس مستخدماً في المرحلة 1) |

> ملاحظة: Secrets غير ظاهرة بعد الإنشاء، لذا احتفظ بنسخة احتياطية.

### الخطوة 4: ارفع الملفات إلى HF Space

**الطريقة 1 — Git (موصى بها):**
```bash
# انسخ الـ Repo URL من صفحة الـ Space
git clone https://huggingface.co/spaces/USERNAME/SPACE_NAME
cd SPACE_NAME

# انسخ كل ملفات المشروع هنا:
# - app/
# - requirements.txt
# - Dockerfile
# - (اختياري) README.md

git add -A
git commit -m "Phase 1 initial deploy"
git push
```

**الطريقة 2 — Files UI:**
من صفحة الـ Space → تبويب **Files** → زر **Add file** → **Upload files** → اسحب وأفلت كل الملفات والمجلدات.

### الخطوة 5: انتظر البناء
بعد الدفع أو الرفع، HF سيبدأ بناء الـ Docker تلقائياً. تابع علامة التبويب **Logs** لمراقبة:
- تثبيت الحزم
- بدء Uvicorn
- ظهور `Uvicorn running on http://0.0.0.0:7860`

### الخطوة 6: اختبر الـ Space
افتح الـ URL الخاص بالـ Space، ستظهر شاشة Microverse مع:
- مؤشر Tick يزيد كل ثانية
- SSE يبث أحداث spawn, eat, sleep, plant, harvest
- أزرار التحكم تعمل (Pause/Resume/10x/100x/Reset)

## 🧪 اختبار الـ Endpoints

### 1. GET /health (من المتصفح)
```
https://USERNAME-SPACE_NAME.hf.space/health
```
النتيجة المتوقعة:
```json
{"status": "alive", "tick": 123, "agents_count": 15}
```

### 2. GET /api/world/init
```
https://USERNAME-SPACE_NAME.hf.space/api/world/init
```
يعيد: `tick`, `map` (40x40 tiles), `agents` (15 كائناً).

### 3. GET /api/world/stream — SSE
**من المتصفح (جافا سكريبت):**
```javascript
const es = new EventSource("/api/world/stream");
es.onmessage = (ev) => console.log(JSON.parse(ev.data));
```

**من Terminal (curl):**
```bash
curl -N "https://USERNAME-SPACE_NAME.hf.space/api/world/stream"
```
سترى سطراً كل ثانية بالشكل:
```
data: {"tick":5,"agents_delta":[{"id":1,"hunger":0.3,"energy":99.9}],"new_events":[{"tick":5,"agent_id":3,"type":"move","text":"..."}]}
```

### 4. POST /api/world/control
```bash
# إيقاف المؤقت
curl -X POST "https://.../api/world/control" \
  -H "Content-Type: application/json" \
  -d '{"action":"pause"}'

# استئناف
curl -X POST ".../control" -H "Content-Type: application/json" \
  -d '{"action":"resume"}'

# تغيير السرعة إلى 10x (0.1 ثانية بين ticks)
curl -X POST ".../control" -H "Content-Type: application/json" \
  -d '{"action":"set_speed","value":0.1}'

# 100x سرعة
curl -X POST ".../control" -H "Content-Type: application/json" \
  -d '{"action":"set_speed","value":0.01}'

# إعادة تعيين العالم
curl -X POST ".../control" -H "Content-Type: application/json" \
  -d '{"action":"reset"}'
```

## 🧠 المرحلة 1 Spec Checklist

| الميزة | الحالة |
|---|---|
| FastAPI + Docker على HF (Port 7860) | ✅ |
| Grid 40x40 (grass/water/farmland/forest) | ✅ |
| 15 Agents بأسماء عشوائية + جنس + traits | ✅ |
| Tick كل 1 ثانية قابل للتعديل | ✅ |
| Utility AI: sleep/eat/harvest/plant/random-walk | ✅ |
| BFS يدوي للبحث عن أقرب مزرعة ناضجة | ✅ |
| SSE يدوي (StreamingResponse) مع Delta فقط | ✅ |
| Save كل 60 tick إلى world_state | ✅ |
| Events فورية (spawn/eat/sleep/plant/harvest) | ✅ |
| استعادة state عند restart من DB | ✅ |
| agent_profiles على مقاعد البيانات | ✅ |
| هيكل التكاثر الفارغ (give_birth الخ) | ✅ |
| Static page تحمل تلقائياً من `/` | ✅ |

## 🛡️ Performance Tips على HF Free Tier
- السرعة الافتراضية 1x (1 ثانية لكل tick) مريحة جداً لـ CPU
- عند التشغيل على 100x لفترة طويلة: راقب Logs للتأكد من عدم إعادة تشغيل الحاوية
- ملف `events_log` ينمو — نظفه دورياً من Neon Console إذا زاد حجمها

## 📂 Required Repository Secrets (مرة واحدة فقط)

| Secret | المكان | الاستخدام |
|---|---|---|
| `DATABASE_URL` | HF Space → Settings → Secrets | اتصال Neon PostgreSQL (sslmode=require) |
| *في المستخدمة الآن* | `GROQ_API_KEY` | نفس المكان | للمرحلة 2 عندما نضيف LLM |

> 🔒 هذي الـ Secrets **لا تظهر** لأحد حتى صاحب الـ Space بعد حفظها — لذلك احتفظ بنسخة عندك.

## ❓ Common Issues

1. **`ModuleNotFoundError: No module named 'app'`**
   → تأكد أن الـ `Dockerfile` ينسخ مجلد `app/` كاملاً، وأن `CMD` يشير إلى `app.main:app`.

2. **`could not connect to server` في Postgres**
   → أضف `?sslmode=require` نهاية الـ DATABASE_URL. تأكد أنك استخدمت **Pooled connection string** من Neon.

3. **SSE لا يعمل على المتصفح المباشر**
   → HF Space يعمل أحياناً عبر iframe جافا سكريبت فقط. استخدم `curl -N` أو افتح الـ App في tab منفصل (زر ⚙️ top-right → "Embed this space" → "Direct link").

4. **CPU usage عالي**
   → خفض السرعة إلى 1x أو راقب عدد الـ events.

## 🔜 المراحل القادمة
- **Phase 2**: إضافة LLM (Groq) للحداث بين الكائنات + Social Memory
- **Phase 3**: تفعيل التكاثر الفعلي + المورثة + الوفادة الفعلية
- **UI**: PixiJS 2D Rendering للخريطة والكائنات المتحركة
