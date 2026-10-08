import express from 'express';
import dotenv from 'dotenv';
import crypto from 'crypto';
import net from 'net';

dotenv.config();

const app = express();

// ซ่อนข้อมูล framework และกำหนดจำนวน proxy ที่เชื่อถือ (Vercel/Render/Nginx = 1)
// ปรับด้วย env TRUST_PROXY ให้ตรงกับโครงสร้างจริง ไม่งั้น req.ip จะถูกปลอมได้
app.disable('x-powered-by');
app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1));

// ---------------------------------------------------------------------------
// ⚙️ Config
// ---------------------------------------------------------------------------
const CONFIG = {
    maxTextLength: 1000,
    maxNameLength: 100,
    // ลูกค้าในโรงภาพยนตร์มักใช้ WiFi เดียวกัน (IP เดียวกัน) จึงตั้งค่าเริ่มต้นให้สูงพอ
    rateLimitPerIp: Number(process.env.RATE_LIMIT_PER_IP) || 30,           // กี่ครั้ง ต่อ IP
    rateLimitWindowSec: Number(process.env.RATE_LIMIT_WINDOW_SEC) || 600,  // ในกี่วินาที
    rateLimitGlobalPerHour: Number(process.env.RATE_LIMIT_GLOBAL_PER_HOUR) || 300, // เพดานรวมทั้งระบบ (กัน quota LINE หมด)
    resolvedTtlSec: 60 * 60 * 24 * 90,   // จำสถานะ ticket ที่แก้แล้ว 90 วัน
    fetchTimeoutMs: 8000,
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHONE_REGEX = /^[0-9+\-()\s]{6,20}$/;

// ตัดช่องว่างและเครื่องหมาย " หรือ ' ที่ครอบค่า (มักติดมาตอนก๊อปจาก .env ไปวางใน Vercel/Render)
const env = (name) => (process.env[name] ?? '').trim().replace(/^(["'])(.*)\1$/s, '$2').trim();

/** ปิดบัง ID ใน log: แสดงเฉพาะ 6 ตัวท้าย */
const maskId = (id) => (id ? `…${String(id).slice(-6)}` : '-');

// เตือนตั้งแต่เริ่มระบบ ถ้าตั้งค่าไม่ครบ
(function checkEnvOnStartup() {
    if (!env('LINE_CHANNEL_SECRET')) console.error('❌ LINE_CHANNEL_SECRET is not set — /api/webhook will reject all requests');
    if (!env('LINE_CHANNEL_ACCESS_TOKEN')) console.error('❌ LINE_CHANNEL_ACCESS_TOKEN is not set');
    if (!env('LINE_TARGET_ID')) console.warn('⚠️ LINE_TARGET_ID is not set — feedback cannot be pushed (คำสั่ง "id" ในกลุ่มยังใช้ได้)');
    if (!env('UPSTASH_REDIS_REST_URL') || !env('UPSTASH_REDIS_REST_TOKEN')) {
        console.warn('⚠️ Redis is not configured — ใช้ in-memory แทน (เลขลำดับ/สถานะ ticket/rate limit/ข้อมูล Feedback จะหายเมื่อ restart และไม่ทำงานข้าม instance)');
    }
    if (!env('TURNSTILE_SECRET_KEY')) {
        if (env('REQUIRE_TURNSTILE') === 'true') {
            console.error('❌ REQUIRE_TURNSTILE=true แต่ไม่ได้ตั้ง TURNSTILE_SECRET_KEY — /api/feedback จะปฏิเสธทุกคำขอ');
        } else {
            console.warn('⚠️ Turnstile ไม่ได้เปิดใช้งาน (ไม่มีการตรวจบอท) — บน production แนะนำให้ตั้ง TURNSTILE_SECRET_KEY และ REQUIRE_TURNSTILE=true');
        }
    }
})();

// ---------------------------------------------------------------------------
// 🔒 Security Headers
// ---------------------------------------------------------------------------
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-XSS-Protection', '0'); // header เก่า แนะนำให้ปิด (0) เพราะอาจสร้างช่องโหว่เองในบราวเซอร์รุ่นเก่า
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    res.setHeader('Cache-Control', 'no-store');
    next();
});

// CORS: ปิดไว้เป็นค่าเริ่มต้น (same-origin เท่านั้น)
// ถ้าหน้าเว็บอยู่คนละโดเมน ให้ตั้ง ALLOWED_ORIGINS=https://example.com,https://www.example.com
app.use('/api/feedback', (req, res, next) => {
    const allowed = env('ALLOWED_ORIGINS').split(',').map((s) => s.trim()).filter(Boolean);
    const origin = req.headers.origin;

    if (origin && allowed.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

// ---------------------------------------------------------------------------
// 🌐 Helpers: fetch พร้อม timeout
// ---------------------------------------------------------------------------
function fetchWithTimeout(url, options = {}, timeoutMs = CONFIG.fetchTimeoutMs) {
    return fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// 🗄️ Storage Layer: Redis (Upstash REST) พร้อม fallback เป็น In-Memory
// ---------------------------------------------------------------------------
const redisEnabled = () => Boolean(env('UPSTASH_REDIS_REST_URL') && env('UPSTASH_REDIS_REST_TOKEN'));

async function redisRequest(path, body) {
    const baseUrl = env('UPSTASH_REDIS_REST_URL').replace(/\/+$/, '');
    const response = await fetchWithTimeout(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${env('UPSTASH_REDIS_REST_TOKEN')}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    }, 5000);
    if (!response.ok) throw new Error(`Redis HTTP ${response.status}`);
    return response.json();
}

async function redisCommand(command) {
    const data = await redisRequest('', command);
    if (data.error) throw new Error(data.error);
    return data.result;
}

async function redisPipeline(commands) {
    const data = await redisRequest('/pipeline', commands);
    const failed = data.find((item) => item.error);
    if (failed) throw new Error(failed.error);
    return data.map((item) => item.result);
}

const memory = {
    resolved: new Set(),
    counterYear: null,
    counter: 0,
    lastLine: null, // { seq, ticketId, at } ของ Ticket ล่าสุดที่ส่งเข้า LINE สำเร็จ
    rate: new Map(), // key -> { count, resetAt }
};

// ล้างข้อมูล rate limit ที่หมดอายุใน memory
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of memory.rate) {
        if (entry.resetAt <= now) memory.rate.delete(key);
    }
}, 10 * 60 * 1000).unref();

/**
 * ดึงปี ค.ศ. ตามเวลาประเทศไทย (Asia/Bangkok)
 */
function getBangkokYear() {
    return Number(
        new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', year: 'numeric' }).format(new Date())
    );
}

/**
 * เวลาปัจจุบันตามไทย รูปแบบ "14:49 น."
 */
function getBangkokTimeLabel() {
    return new Intl.DateTimeFormat('th-TH', {
        timeZone: 'Asia/Bangkok',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).format(new Date()) + ' น.';
}

/**
 * เลขลำดับ Feedback ประจำปี (รีเซ็ตเมื่อขึ้นปีใหม่)
 * ใช้ Redis INCR เพื่อให้เลขไม่ซ้ำ/ไม่รีเซ็ต แม้ระบบ restart หรือรันหลาย instance
 */
async function getNextTicketNumber() {
    const year = getBangkokYear();

    if (redisEnabled()) {
        // 🔒 โหมดเข้มงวด: ถ้า Redis ใช้ไม่ได้ จะไม่ถอยไปนับใน memory (เสี่ยงเลขซ้ำ) แต่ throw error ให้ผู้ใช้ส่งใหม่
        const key = `feedback:ticket_counter:${year}`;
        let lastError;
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                const n = await redisCommand(['INCR', key]);
                if (n === 1) {
                    try {
                        await redisCommand(['EXPIRE', key, 60 * 60 * 24 * 800]);
                    } catch (e) {
                        console.error('⚠️ Redis EXPIRE for counter failed (ignored):', e.message);
                    }
                }
                return n;
            } catch (err) {
                lastError = err;
                console.error(`❌ Redis counter error (attempt ${attempt}/2):`, err.message);
                if (attempt < 2) await sleep(300);
            }
        }
        throw new Error(`TICKET_COUNTER_UNAVAILABLE: ${lastError?.message}`);
    }

    // ไม่ได้ตั้งค่า Redis เลย: ถ้าบังคับด้วย REQUIRE_REDIS=true จะไม่ยอมใช้ memory
    if (env('REQUIRE_REDIS') === 'true') {
        throw new Error('TICKET_COUNTER_UNAVAILABLE: Redis is required but not configured');
    }

    if (memory.counterYear !== year) {
        memory.counterYear = year;
        memory.counter = 0;
    }
    memory.counter += 1;
    return memory.counter;
}

/**
 * คืนเลข Ticket ที่เพิ่งออกให้ (ใช้เมื่อส่งไม่สำเร็จเลย เพื่อไม่ให้เลขข้าม)
 * ลดเลขลงเฉพาะเมื่อเลขล่าสุดยังเป็นเลขของเราเท่านั้น (กันไปลบเลขของคำขออื่น)
 */
async function releaseTicketNumber(seq) {
    const year = getBangkokYear();
    try {
        if (redisEnabled()) {
            const lua = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DECR', KEYS[1]) end return nil";
            await redisCommand(['EVAL', lua, 1, `feedback:ticket_counter:${year}`, String(seq)]);
            return;
        }
        if (memory.counterYear === year && memory.counter === seq) memory.counter -= 1;
    } catch (err) {
        console.error('⚠️ releaseTicketNumber failed (ignored):', err.message);
    }
}

/**
 * จำ Ticket ล่าสุดที่ส่งเข้า LINE สำเร็จ (ใช้อ้างอิงตอนต้องสลับไปแจ้งเตือนทาง Telegram)
 */
async function rememberLineTicket(seq, ticketId) {
    const record = { seq, ticketId, at: Date.now() };
    memory.lastLine = record;
    if (!redisEnabled()) return;
    try {
        await redisCommand(['SET', `feedback:last_line:${getBangkokYear()}`, JSON.stringify(record), 'EX', 60 * 60 * 24 * 800]);
    } catch (err) {
        console.error('⚠️ rememberLineTicket failed (ignored):', err.message);
    }
}

async function getLastLineTicket() {
    if (redisEnabled()) {
        try {
            const raw = await redisCommand(['GET', `feedback:last_line:${getBangkokYear()}`]);
            if (raw) return JSON.parse(raw);
        } catch (err) {
            console.error('⚠️ getLastLineTicket failed (fallback to memory):', err.message);
        }
    }
    return memory.lastLine;
}

/**
 * บันทึกว่า Ticket ถูกแก้ไขแล้ว (atomic)
 * @returns {Promise<boolean>} true = เพิ่งบันทึกครั้งแรก, false = เคยถูกแก้ไขไปแล้ว
 */
async function markTicketResolved(ticketId) {
    if (redisEnabled()) {
        try {
            const result = await redisCommand([
                'SET', `feedback:resolved:${ticketId}`, '1', 'NX', 'EX', CONFIG.resolvedTtlSec
            ]);
            return result === 'OK';
        } catch (err) {
            console.error('❌ Redis resolve error (fallback to memory):', err.message);
        }
    }

    if (memory.resolved.has(ticketId)) return false;

    if (memory.resolved.size >= 3000) {
        const oldest = memory.resolved.values().next().value;
        memory.resolved.delete(oldest);
    }
    memory.resolved.add(ticketId);
    return true;
}

// ---------------------------------------------------------------------------
// 💾 Feedback Persistence: เก็บข้อมูล Feedback ลง Redis อัตโนมัติ (fallback เป็น In-Memory)
// ---------------------------------------------------------------------------
// เก็บข้อมูลกี่วัน (มีชื่อ/เบอร์โทรลูกค้า ควรกำหนดอายุเสมอ) ปรับด้วย env FEEDBACK_RETENTION_DAYS
// ค่าเริ่มต้น 400 วัน (> 1 ปี) เพื่อให้ยังมีข้อมูลของ 1 ม.ค. เหลืออยู่ตอนสรุปประจำปีรันในวันที่ 1 ม.ค. ปีถัดไป
const FEEDBACK_TTL_SEC = (Number(process.env.FEEDBACK_RETENTION_DAYS) || 400) * 60 * 60 * 24;
const FEEDBACK_INDEX_KEY = 'feedback:index'; // sorted set: score = เวลาที่สร้าง (ms), member = ticketId
const feedbackKey = (ticketId) => `feedback:ticket:${ticketId}`;

const feedbackMemory = new Map(); // ticketId -> record (สำรองเมื่อไม่มี Redis / Redis ล้มเหลว)

function rememberFeedbackInMemory(record) {
    if (feedbackMemory.size >= 3000) {
        feedbackMemory.delete(feedbackMemory.keys().next().value); // ลบอันเก่าสุด
    }
    feedbackMemory.set(record.ticketId, record);
}

/**
 * @param {'sent'|'failed'} status
 * @param {'line'|'telegram'|null} deliveredVia
 */
function buildFeedbackRecord(alertData, status, deliveredVia) {
    return {
        ticketId: alertData.ticketId,
        seq: status === 'failed' ? null : alertData.ticketSeqNumber, // เลขที่ถูกคืนแล้วจะไม่ผูกกับ record
        year: getBangkokYear(),
        text: alertData.customerText,
        name: alertData.name || null,
        phone: alertData.phone || null,
        status,                 // sent | failed | resolved
        deliveredVia,           // line | telegram | null
        createdAt: Date.now(),
        createdAtLabel: alertData.formattedDate,
        resolvedAt: null,
        resolvedBy: null,
    };
}

/**
 * บันทึก Feedback (ไม่ throw — ความล้มเหลวของการเก็บข้อมูลต้องไม่ทำให้ลูกค้าเห็น error
 * ทั้งที่แจ้งเตือนส่งสำเร็จแล้ว)
 */
async function saveFeedbackRecord(record) {
    rememberFeedbackInMemory(record);

    if (!redisEnabled()) return false;

    try {
        const commands = [
            ['SET', feedbackKey(record.ticketId), JSON.stringify(record), 'EX', FEEDBACK_TTL_SEC],
            ['ZADD', FEEDBACK_INDEX_KEY, record.createdAt, record.ticketId],
            // ล้าง index ของรายการที่หมดอายุแล้ว ไม่ให้ sorted set โตไม่จำกัด
            ['ZREMRANGEBYSCORE', FEEDBACK_INDEX_KEY, '-inf', Date.now() - FEEDBACK_TTL_SEC * 1000],
        ];
        if (record.seq) {
            commands.push(['SET', `feedback:seq:${record.year}:${record.seq}`, record.ticketId, 'EX', FEEDBACK_TTL_SEC]);
        }
        await redisPipeline(commands);
        return true;
    } catch (err) {
        console.error('⚠️ saveFeedbackRecord failed (ignored):', err.message);
        return false;
    }
}

/**
 * อัปเดตบางฟิลด์ของ record (เช่น ตอนกด "ทำการแก้ไขแล้ว") — ใช้ KEEPTTL ไม่ต่ออายุข้อมูลโดยไม่ตั้งใจ
 */
async function updateFeedbackRecord(ticketId, patch) {
    try {
        let record = null;

        if (redisEnabled()) {
            const raw = await redisCommand(['GET', feedbackKey(ticketId)]);
            if (raw) record = JSON.parse(raw);
        }
        if (!record) record = feedbackMemory.get(ticketId) || null;
        if (!record) {
            console.warn(`⚠️ updateFeedbackRecord: ไม่พบ record ของ ${ticketId} (อาจหมดอายุ ถูกลบหลังสรุปประจำปี หรือเป็น ticket เก่าก่อนเปิดใช้ระบบเก็บข้อมูล)`);
            return false;
        }

        const updated = { ...record, ...patch };
        feedbackMemory.set(ticketId, updated);

        if (redisEnabled()) {
            await redisCommand(['SET', feedbackKey(ticketId), JSON.stringify(updated), 'KEEPTTL']);
        }
        return true;
    } catch (err) {
        console.error('⚠️ updateFeedbackRecord failed (ignored):', err.message);
        return false;
    }
}

// ---------------------------------------------------------------------------
// 🚦 Rate limiting
// ---------------------------------------------------------------------------

/**
 * แปลง IP เป็นคีย์สำหรับ rate limit
 * - IPv4 → ใช้ตามเดิม
 * - IPv4-mapped IPv6 (::ffff:1.2.3.4) → แปลงเป็น IPv4
 * - IPv6 → รวมเป็นกลุ่ม /64 (ผู้ใช้ปลายทางมักได้รับทั้ง /64) กันการหมุนที่อยู่เลี่ยง limit
 */
function ipKey(raw) {
    if (!raw) return 'unknown';
    let ip = String(raw).trim().split('%')[0];

    const mapped = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
    if (mapped) ip = mapped[1];

    const kind = net.isIP(ip);
    if (kind === 4) return ip;
    if (kind !== 6) return 'unknown';

    // ขยาย IPv6 ให้ครบ 8 กลุ่ม
    let s = ip;
    if (s.includes('.')) { // มี IPv4 ต่อท้าย เช่น ::1.2.3.4
        const idx = s.lastIndexOf(':');
        const v4 = s.slice(idx + 1).split('.').map(Number);
        const hi = ((v4[0] << 8) | v4[1]).toString(16);
        const lo = ((v4[2] << 8) | v4[3]).toString(16);
        s = `${s.slice(0, idx + 1)}${hi}:${lo}`;
    }
    const hasGap = s.includes('::');
    const [l, r = ''] = s.split('::');
    const left = l ? l.split(':') : [];
    const right = r ? r.split(':') : [];
    const fill = hasGap ? Math.max(0, 8 - left.length - right.length) : 0;
    const groups = [...left, ...Array(fill).fill('0'), ...right].map((g) => parseInt(g, 16).toString(16));

    return `${groups.slice(0, 4).join(':')}::/64`;
}

/**
 * Fixed-window rate limiter
 */
async function consumeRateLimit(key, limit, windowSec) {
    if (redisEnabled()) {
        try {
            const rkey = `feedback:rl:${key}`;
            // SET NX EX + INCR ใน pipeline เดียว ป้องกัน key ค้างโดยไม่มี TTL
            const [, count] = await redisPipeline([
                ['SET', rkey, '0', 'NX', 'EX', windowSec],
                ['INCR', rkey]
            ]);
            return { limited: count > limit, retryAfterSec: windowSec };
        } catch (err) {
            console.error('❌ Redis rate-limit error (fallback to memory):', err.message);
        }
    }

    const now = Date.now();
    let entry = memory.rate.get(key);
    if (!entry || entry.resetAt <= now) {
        entry = { count: 0, resetAt: now + windowSec * 1000 };
        memory.rate.set(key, entry);
    }
    entry.count += 1;
    return {
        limited: entry.count > limit,
        retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
    };
}

/**
 * Rate limit ต่อ IP (ด่านแรก ราคาถูก)
 * ตัวนับรวมทั้งระบบ (global) ย้ายไปหักใน handler หลังผ่าน validation + Turnstile
 * เพื่อไม่ให้ request ขยะใช้โควต้ารวมของลูกค้าจริงหมด
 */
async function feedbackRateLimit(req, res, next) {
    try {
        const perIp = await consumeRateLimit(`ip:${ipKey(req.ip)}`, CONFIG.rateLimitPerIp, CONFIG.rateLimitWindowSec);
        if (perIp.limited) {
            res.setHeader('Retry-After', String(perIp.retryAfterSec));
            const waitMin = Math.max(1, Math.ceil(perIp.retryAfterSec / 60));
            return res.status(429).json({ error: `ส่งข้อความบ่อยเกินไป กรุณารออีกประมาณ ${waitMin} นาทีแล้วลองใหม่` });
        }
        next();
    } catch (err) {
        console.error('❌ Rate limit middleware error:', err.message);
        next(); // ถ้าตัว limiter เสียเอง ไม่ควรทำให้ฟอร์มใช้ไม่ได้ทั้งระบบ
    }
}

// ---------------------------------------------------------------------------
// 🧹 Input Sanitizing & Validation
// ---------------------------------------------------------------------------
const codePointLength = (str) => [...str].length;

/**
 * ทำความสะอาดข้อความ: ลบ Control Characters, Null Bytes และอักขระควบคุมทิศทางข้อความ (Bidi)
 * ที่ใช้หลอกตาได้ (ไม่แปลงเป็น HTML Entities เพื่อให้แสดงผลบน LINE Flex ได้ถูกต้อง)
 */
function cleanTextInput(input) {
    if (typeof input !== 'string') return '';
    return input
        .normalize('NFC')
        .replace(/\r\n?/g, '\n')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '')              // Control Characters
        .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, '')    // Zero-width / Bidi override
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * ตรวจสอบ Cloudflare Turnstile
 * - ตั้ง TURNSTILE_SECRET_KEY → ตรวจจริง
 * - ไม่ได้ตั้ง และ REQUIRE_TURNSTILE=true → ปฏิเสธ (fail-closed) กันลืมตั้งค่าบน production
 * - ไม่ได้ตั้ง และไม่บังคับ → ข้าม (เหมาะกับ dev)
 */
async function verifyTurnstile(token, ip) {
    const secret = env('TURNSTILE_SECRET_KEY');
    if (!secret) return env('REQUIRE_TURNSTILE') !== 'true';
    if (typeof token !== 'string' || !token || token.length > 2048) return false;

    try {
        const response = await fetchWithTimeout('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ secret, response: token, remoteip: ip || '' })
        });
        const data = await response.json();
        return data.success === true;
    } catch (err) {
        console.error('❌ Turnstile verification error:', err.message);
        return false;
    }
}

// ---------------------------------------------------------------------------
// 🔏 LINE Signature Verification
// ---------------------------------------------------------------------------
function saveRawBody(req, res, buf) {
    req.rawBody = buf;
}

function verifyLineSignature(req, res, next) {
    const channelSecret = env('LINE_CHANNEL_SECRET');
    const signature = req.headers['x-line-signature'];

    // 🔒 Fail-closed: ถ้าไม่ได้ตั้งค่า Secret ต้องปฏิเสธ ห้ามปล่อยผ่าน
    if (!channelSecret) {
        console.error('❌ LINE_CHANNEL_SECRET is not set. Rejecting webhook request.');
        return res.status(500).send('Server misconfigured');
    }

    if (typeof signature !== 'string' || !req.rawBody) {
        return res.status(401).send('Unauthorized: Missing signature or body');
    }

    const hash = crypto
        .createHmac('sha256', channelSecret)
        .update(req.rawBody)
        .digest('base64');

    // 🔒 ป้องกัน Timing Attack
    const signatureBuffer = Buffer.from(signature);
    const hashBuffer = Buffer.from(hash);

    if (
        signatureBuffer.length !== hashBuffer.length ||
        !crypto.timingSafeEqual(signatureBuffer, hashBuffer)
    ) {
        console.error('❌ Invalid LINE Webhook Signature');
        return res.status(403).send('Forbidden: Invalid signature');
    }

    next();
}

// ---------------------------------------------------------------------------
// 📤 LINE Messaging helpers
// ---------------------------------------------------------------------------
function buildFlexPayload({ customerText, name, phone, formattedDate, ticketSeqNumber, ticketId }) {
    const customerInfo = `${name || 'ไม่ระบุชื่อ'} (${phone || 'ไม่ระบุเบอร์โทร'})`;

    const singleLine = customerText.replace(/\s+/g, ' ');
    const shortAltText = codePointLength(singleLine) > 50
        ? [...singleLine].slice(0, 50).join('') + '...'
        : singleLine;

    const postbackData = new URLSearchParams({
        action: 'resolve',
        ticket_id: ticketId,
        seq: String(ticketSeqNumber)
    }).toString();

    return {
        type: 'flex',
        altText: `📬 Feedback ใหม่ (#${ticketSeqNumber}): ${shortAltText}`,
        contents: {
            type: 'bubble',
            header: {
                type: 'box',
                layout: 'vertical',
                contents: [
                    {
                        type: 'box',
                        layout: 'horizontal',
                        contents: [
                            { type: 'text', text: '📢 แจ้งเตือน Feedback', weight: 'bold', color: '#ffffff', size: 'md', flex: 4 },
                            { type: 'text', text: `#${ticketSeqNumber}`, weight: 'bold', color: '#ffffff', size: 'md', align: 'end', flex: 1 }
                        ]
                    },
                    { type: 'text', text: 'Cinema • สาขากาฬสินธุ์', color: '#ffffffcc', size: 'xs', margin: 'xs' }
                ],
                backgroundColor: '#03C755',
                paddingAll: 'md'
            },
            body: {
                type: 'box',
                layout: 'vertical',
                contents: [
                    {
                        type: 'box',
                        layout: 'horizontal',
                        contents: [
                            { type: 'text', text: '👤 ผู้ส่ง:', size: 'xs', color: '#8c8c8c', flex: 2 },
                            { type: 'text', text: customerInfo, size: 'xs', color: '#111111', weight: 'bold', flex: 5, wrap: true }
                        ]
                    },
                    {
                        type: 'box',
                        layout: 'horizontal',
                        contents: [
                            { type: 'text', text: '📅 เวลา:', size: 'xs', color: '#8c8c8c', flex: 2 },
                            { type: 'text', text: formattedDate, size: 'xs', color: '#111111', flex: 5, wrap: true }
                        ],
                        margin: 'xs'
                    },
                    { type: 'separator', margin: 'md' },
                    {
                        type: 'box',
                        layout: 'vertical',
                        contents: [
                            { type: 'text', text: '💬 ข้อความที่ได้รับ:', size: 'xs', color: '#8c8c8c' },
                            { type: 'text', text: `"${customerText}"`, size: 'lg', color: '#111111', weight: 'bold', wrap: true, margin: 'xs' }
                        ],
                        margin: 'md',
                        backgroundColor: '#f8f9fa',
                        paddingAll: 'md',
                        cornerRadius: 'md'
                    }
                ]
            },
            footer: {
                type: 'box',
                layout: 'vertical',
                contents: [
                    {
                        type: 'button',
                        action: {
                            type: 'postback',
                            label: '☑ ทำการแก้ไขแล้ว',
                            data: postbackData,
                            // ข้อความสั้น ๆ ที่แสดงในแชทเมื่อกดปุ่ม (ไม่ใส่เนื้อหา Feedback เพื่อไม่ให้ยาวเกินไป)
                            displayText: `รับทราบ/ทำการแก้ไข Feedback #${ticketSeqNumber} เรียบร้อยแล้ว`
                        },
                        style: 'primary',
                        color: '#007bff',
                        height: 'sm'
                    }
                ]
            }
        }
    };
}

/**
 * ส่ง LINE Push Alert (Flex Message)
 * ใช้ X-Line-Retry-Key ทำให้การ retry ปลอดภัย ไม่ส่งซ้ำ
 * @returns {Promise<{ok: boolean, quotaExceeded: boolean}>}
 *   quotaExceeded = true เฉพาะกรณี LINE ตอบ 429 ว่าโควต้าข้อความรายเดือนหมด
 */
async function sendLinePushAlert(payloadData) {
    const channelToken = env('LINE_CHANNEL_ACCESS_TOKEN');
    const targetId = env('LINE_TARGET_ID');

    if (!channelToken || !targetId) {
        console.error('❌ Missing LINE API Token or Target ID in environment variables');
        return { ok: false, quotaExceeded: false };
    }

    const flexPayload = buildFlexPayload(payloadData);
    const body = JSON.stringify({ to: targetId, messages: [flexPayload] });

    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const response = await fetchWithTimeout('https://api.line.me/v2/bot/message/push', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${channelToken}`,
                    'X-Line-Retry-Key': payloadData.ticketId
                },
                body
            });

            // 409 = LINE เคยรับ Retry Key นี้ไปแล้ว (ส่งสำเร็จไปก่อนหน้า)
            if (response.ok || response.status === 409) return { ok: true, quotaExceeded: false };

            const errBody = (await response.text()).slice(0, 500);
            console.error(`❌ LINE API Rejected Push (HTTP ${response.status}):`, errBody);

            // โควต้าข้อความรายเดือนหมด: retry ไม่มีประโยชน์ ให้หยุดทันทีและแจ้งผู้เรียกว่าโควต้าหมด
            if (response.status === 429 && /monthly limit/i.test(errBody)) {
                console.error('🚫 LINE monthly message quota reached — will not retry');
                return { ok: false, quotaExceeded: true };
            }

            // Error ฝั่งผู้ใช้ (4xx ยกเว้น 429) ไม่ต้อง retry
            if (response.status < 500 && response.status !== 429) return { ok: false, quotaExceeded: false };
        } catch (err) {
            console.error('❌ Network Error while sending LINE Push Alert:', err.message);
        }

        if (attempt < 2) await sleep(500);
    }
    return { ok: false, quotaExceeded: false };
}

/**
 * ส่งแจ้งเตือนสำรองไป Telegram (ใช้เฉพาะเมื่อโควต้าข้อความรายเดือนของ LINE หมดเท่านั้น)
 * ต้องตั้ง TELEGRAM_BOT_TOKEN และ TELEGRAM_CHAT_ID
 */
async function sendTelegramAlert({ customerText, name, phone, formattedDate, ticketSeqNumber, lastLineTicket }) {
    const token = env('TELEGRAM_BOT_TOKEN');
    const chatId = env('TELEGRAM_CHAT_ID');
    if (!token || !chatId) {
        console.warn('⚠️ Telegram fallback not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)');
        return false;
    }

    // อ้างอิง Ticket ล่าสุดที่ส่งเข้า LINE สำเร็จ ก่อนโควต้าจะเต็ม
    let lineRef = '↩️ ต่อจาก LINE ล่าสุด: (ยังไม่มีประวัติ)';
    if (lastLineTicket?.seq) {
        const lastTime = new Intl.DateTimeFormat('th-TH', {
            timeZone: 'Asia/Bangkok',
            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false
        }).format(new Date(lastLineTicket.at)) + ' น.';
        lineRef = `↩️ ต่อจาก LINE ล่าสุด: #${lastLineTicket.seq} (${lastLineTicket.ticketId?.slice(0, 8) || '-'} • ${lastLineTicket.at ? lastTime : '-'})`;
    }

    const text = [
        `📢 Feedback ใหม่ #${ticketSeqNumber}`,
        '⚠️ ส่งผ่าน Telegram เพราะโควต้า LINE รายเดือนเต็ม',
        lineRef,
        '',
        `👤 ผู้ส่ง: ${name || 'ไม่ระบุชื่อ'} (${phone || 'ไม่ระบุเบอร์โทร'})`,
        `📅 เวลา: ${formattedDate}`,
        '',
        `💬 ข้อความ:\n${customerText}`
    ].join('\n');

    try {
        // ไม่ใช้ parse_mode เพื่อให้ข้อความลูกค้าแสดงตามจริง ไม่ถูกตีความเป็น Markdown/HTML
        const response = await fetchWithTimeout(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true })
        });
        if (!response.ok) {
            // ไม่ log URL เพราะมี bot token อยู่ในนั้น
            console.error(`❌ Telegram sendMessage failed (HTTP ${response.status}):`, (await response.text()).slice(0, 300));
            return false;
        }
        return true;
    } catch (err) {
        console.error('❌ Network Error while sending Telegram alert:', err.message);
        return false;
    }
}

/**
 * ตอบกลับด้วย replyToken (ใช้ได้ครั้งเดียว อายุสั้น)
 * @returns {Promise<boolean>} true = ส่งสำเร็จ
 */
async function sendLineReply(replyToken, text) {
    const channelToken = env('LINE_CHANNEL_ACCESS_TOKEN');
    if (!channelToken) {
        console.error('❌ LINE_CHANNEL_ACCESS_TOKEN is not set — cannot reply');
        return false;
    }
    if (!replyToken) {
        console.error('❌ No replyToken in event — cannot reply');
        return false;
    }

    try {
        const response = await fetchWithTimeout('https://api.line.me/v2/bot/message/reply', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${channelToken}`
            },
            body: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] })
        });
        if (!response.ok) {
            console.error(`❌ LINE Reply failed (HTTP ${response.status}):`, (await response.text()).slice(0, 500));
            return false;
        }
        return true;
    } catch (err) {
        console.error('❌ Network Error while sending LINE reply:', err.message);
        return false;
    }
}

/**
 * ส่งข้อความแบบ Push ไปยังห้อง/กลุ่ม/ผู้ใช้ (ใช้เป็นตัวสำรองเมื่อ reply ล้มเหลว)
 */
async function sendLinePushText(to, text) {
    const channelToken = env('LINE_CHANNEL_ACCESS_TOKEN');
    if (!channelToken || !to) return false;

    try {
        const response = await fetchWithTimeout('https://api.line.me/v2/bot/message/push', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${channelToken}`
            },
            body: JSON.stringify({ to, messages: [{ type: 'text', text }] })
        });
        if (!response.ok) {
            console.error(`❌ LINE Push (text) failed (HTTP ${response.status}):`, (await response.text()).slice(0, 500));
            return false;
        }
        return true;
    } catch (err) {
        console.error('❌ Network Error while sending LINE push text:', err.message);
        return false;
    }
}

/**
 * พยายามตอบด้วย reply ก่อน ถ้าไม่สำเร็จ (เช่น token หมดอายุ) ให้ push เข้าห้องเดิมแทน
 */
async function replyOrPush(event, text) {
    const replied = await sendLineReply(event.replyToken, text);
    if (replied) return true;

    const to = event.source?.groupId || event.source?.roomId || event.source?.userId;
    console.warn('⚠️ Reply failed — falling back to push message');
    return sendLinePushText(to, text);
}

// ---------------------------------------------------------------------------
// 📝 Endpoint: รับ Feedback
// ---------------------------------------------------------------------------
app.post(
    '/api/feedback',
    feedbackRateLimit,
    express.json({ limit: '10kb' }),
    async (req, res) => {
        try {
            const body = req.body ?? {};

            // 🍯 Honeypot: ฟิลด์ซ่อน "website" บอทมักกรอก ผู้ใช้จริงจะเว้นว่าง
            if (typeof body.website === 'string' && body.website.trim() !== '') {
                return res.json({ success: true, line_sent: true }); // ตอบเหมือนสำเร็จ ไม่บอกบอท
            }

            if (typeof body.text !== 'string') {
                return res.status(400).json({ error: 'กรุณากรอกข้อความ Feedback ให้ถูกต้อง' });
            }

            const cleanText = cleanTextInput(body.text);
            const cleanName = cleanTextInput(body.name);
            const cleanPhone = cleanTextInput(body.phone);

            if (!cleanText) {
                return res.status(400).json({ error: 'กรุณากรอกข้อความ Feedback ให้ถูกต้อง' });
            }
            if (codePointLength(cleanText) > CONFIG.maxTextLength) {
                return res.status(400).json({ error: `ข้อความยาวเกินไป (สูงสุด ${CONFIG.maxTextLength} ตัวอักษร)` });
            }
            if (codePointLength(cleanName) > CONFIG.maxNameLength) {
                return res.status(400).json({ error: `ชื่อยาวเกินไป (สูงสุด ${CONFIG.maxNameLength} ตัวอักษร)` });
            }
            if (cleanPhone && !PHONE_REGEX.test(cleanPhone)) {
                return res.status(400).json({ error: 'รูปแบบเบอร์โทรไม่ถูกต้อง' });
            }

            // 🤖 ตรวจสอบ Turnstile
            const humanOk = await verifyTurnstile(body.turnstileToken, req.ip);
            if (!humanOk) {
                return res.status(403).json({ error: 'การตรวจสอบความปลอดภัยไม่ผ่าน กรุณาลองใหม่' });
            }

            // 🌍 เพดานรวมทั้งระบบ: หักเฉพาะ request ที่ผ่าน validation + Turnstile แล้วเท่านั้น
            //    (กัน request ขยะจากหลาย IP ใช้โควต้ารวมจนลูกค้าจริงส่งไม่ได้)
            try {
                const globalLimit = await consumeRateLimit('global', CONFIG.rateLimitGlobalPerHour, 3600);
                if (globalLimit.limited) {
                    res.setHeader('Retry-After', String(globalLimit.retryAfterSec));
                    return res.status(429).json({ error: 'ระบบมีผู้ใช้งานจำนวนมาก กรุณาลองใหม่ภายหลัง' });
                }
            } catch (err) {
                console.error('❌ Global rate limit error (ignored):', err.message);
            }

            const now = new Date();
            const formattedDate = now.toLocaleString('th-TH', {
                timeZone: 'Asia/Bangkok',
                year: 'numeric', month: 'short', day: 'numeric',
                hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
            }) + ' น.';

            let ticketSeqNumber;
            try {
                ticketSeqNumber = await getNextTicketNumber();
            } catch (err) {
                console.error('❌ Cannot issue ticket number:', err.message);
                return res.status(503).json({
                    success: false,
                    line_sent: false,
                    error: 'ระบบไม่พร้อมให้บริการชั่วคราว กรุณาลองใหม่อีกครั้ง'
                });
            }
            const ticketId = crypto.randomUUID();

            const alertData = {
                customerText: cleanText,
                name: cleanName,
                phone: cleanPhone,
                formattedDate,
                ticketSeqNumber,
                ticketId
            };

            // 1) ส่งเข้า LINE ก่อนเสมอ
            const lineResult = await sendLinePushAlert(alertData);
            if (lineResult.ok) {
                await rememberLineTicket(ticketSeqNumber, ticketId); // จำไว้เป็นอ้างอิงสำหรับ Telegram
                await saveFeedbackRecord(buildFeedbackRecord(alertData, 'sent', 'line')); // 💾 เก็บลง Redis
                return res.json({ success: true, line_sent: true, delivered_via: 'line' });
            }

            // 2) ส่งไป Telegram เฉพาะเมื่อโควต้า LINE รายเดือนหมดเท่านั้น
            //    ใช้เลข Ticket เดียวกัน จึงต่อเนื่องจาก Ticket ล่าสุดที่ส่งเข้า LINE สำเร็จ
            if (lineResult.quotaExceeded) {
                const lastLineTicket = await getLastLineTicket();
                const telegramOk = await sendTelegramAlert({ ...alertData, lastLineTicket });
                if (telegramOk) {
                    await saveFeedbackRecord(buildFeedbackRecord(alertData, 'sent', 'telegram')); // 💾 เก็บลง Redis
                    // ตอบสำเร็จเหมือนปกติ ลูกค้าไม่เห็นข้อผิดพลาด
                    // (line_sent: true เพื่อให้หน้าเว็บเดิมที่ตรวจ field นี้ไม่แสดง error; ช่องทางจริงดูที่ delivered_via)
                    return res.json({ success: true, line_sent: true, delivered_via: 'telegram' });
                }
            }

            // 3) ส่งไม่สำเร็จเลย: คืนเลข Ticket เพื่อไม่ให้เลขข้าม แล้วแจ้งผู้ใช้ให้กดส่งใหม่
            await releaseTicketNumber(ticketSeqNumber);
            await saveFeedbackRecord(buildFeedbackRecord(alertData, 'failed', null)); // 💾 เก็บข้อความลูกค้าไว้ ไม่ให้หาย
            return res.status(502).json({
                success: false,
                line_sent: false,
                error: 'ไม่สามารถส่งข้อความได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง'
            });
        } catch (error) {
            console.error('❌ Error inside /api/feedback:', error.message);
            return res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ' });
        }
    }
);

// ---------------------------------------------------------------------------
// 🤖 Endpoint: LINE Webhook
// ---------------------------------------------------------------------------
async function handlePostback(event) {
    const targetId = env('LINE_TARGET_ID');

    // 🔒 รับเฉพาะ Postback ที่มาจากกลุ่ม/ห้องเป้าหมายของระบบเท่านั้น
    const sourceId = event.source?.groupId || event.source?.roomId || event.source?.userId;
    console.log(`📥 Postback received (source=${event.source?.type}, id=${maskId(sourceId)}, hasReplyToken=${Boolean(event.replyToken)})`);

    if (targetId && sourceId !== targetId) {
        // ถ้าเจอบรรทัดนี้ใน log แปลว่า LINE_TARGET_ID ไม่ตรงกับห้องที่กดปุ่ม → บอทจึงเงียบ
        // (ปิดบัง ID ไว้ แสดงแค่ 6 ตัวท้ายเพื่อเทียบกันได้)
        console.warn(`⚠️ Ignored postback from non-target source. sourceId=${maskId(sourceId)} / LINE_TARGET_ID=${maskId(targetId)}`);
        return;
    }

    let params;
    try {
        params = new URLSearchParams(event.postback?.data || '');
    } catch (e) {
        console.error('❌ Error parsing postback data:', e.message);
        return;
    }

    const action = params.get('action');
    const ticketId = params.get('ticket_id');
    const seq = params.get('seq');

    if (action !== 'resolve' || !ticketId || !UUID_REGEX.test(ticketId)) return;

    // ใช้เลข Ticket (#seq) อ้างอิง ถ้าไม่มีให้ใช้ UUID 8 ตัวแรกแทน
    const ticketLabel = seq && /^\d{1,10}$/.test(seq) ? `#${seq}` : ticketId.slice(0, 8);

    const isFirstResolve = await markTicketResolved(ticketId);

    if (!isFirstResolve) {
        console.log(`⚠️ Ticket ID: ${ticketId} ถูกแก้ไขไปแล้ว (ข้ามการประมวลผล)`);
        await replyOrPush(
            event,
            `⚠️ [แจ้งเตือน]\nFeedback ${ticketLabel} ได้รับการตรวจสอบ/แก้ไขไปแล้วก่อนหน้านี้ครับ`
        );
        return;
    }

    console.log(`✅ บันทึกการแก้ไข Ticket ID: ${ticketId} (${ticketLabel}) สำเร็จ`);

    // 💾 อัปเดตสถานะใน record ที่เก็บไว้ (ไม่ throw)
    await updateFeedbackRecord(ticketId, {
        status: 'resolved',
        resolvedAt: Date.now(),
        resolvedBy: event.source?.userId || null,
    });

    const sent = await replyOrPush(
        event,
        `✅ [อัปเดตสถานะ]\nFeedback ${ticketLabel} ได้รับการตรวจสอบ/แก้ไขเรียบร้อยแล้ว เมื่อเวลา ${getBangkokTimeLabel()}`
    );
    if (!sent) console.error(`❌ Could not send resolve confirmation for ${ticketLabel}`);
}

async function handleTextMessage(event) {
    const groupId = event.source?.groupId;
    const text = event.message?.text;

    if (!groupId || !event.replyToken || typeof text !== 'string') return;
    if (text.toLowerCase().trim() !== 'id') return;

    // คำสั่ง "id" ใช้สำหรับตั้งค่าครั้งแรก — ปิดอัตโนมัติเมื่อมี LINE_TARGET_ID แล้ว
    // (หากต้องการเปิดต่อ ให้ตั้ง ENABLE_ID_COMMAND=true)
    const idCommandEnabled = !env('LINE_TARGET_ID') || env('ENABLE_ID_COMMAND') === 'true';
    if (!idCommandEnabled) return;

    await sendLineReply(event.replyToken, `📌 Group ID ของกลุ่มนี้คือ:\n${groupId}`);
}

app.post(
    '/api/webhook',
    express.json({ limit: '256kb', verify: saveRawBody }),
    verifyLineSignature,
    async (req, res) => {
        const events = Array.isArray(req.body?.events) ? req.body.events : [];
        console.log(`📨 Webhook received ${events.length} event(s): ${events.map((e) => e.type).join(', ') || '-'}`);

        for (const event of events) {
            try {
                if (event.type === 'postback') {
                    await handlePostback(event);
                } else if (event.type === 'message' && event.message?.type === 'text') {
                    await handleTextMessage(event);
                }
            } catch (err) {
                // error ใน event หนึ่งต้องไม่ทำให้ event อื่นหยุดทำงาน
                console.error('❌ Webhook event error:', err.message);
            }
        }

        // ตอบ 200 เสมอ เพื่อไม่ให้ LINE ส่ง event เดิมซ้ำ
        return res.status(200).send('OK');
    }
);

// ---------------------------------------------------------------------------
// 📊 สรุป Feedback ประจำปี + 🧹 ลบข้อมูลของปีนั้นหลังส่งครบ
//    (เรียกโดย Vercel Cron ตอนขึ้นปีใหม่ตามเวลาไทย)
//    - สรุปเนื้อหา Feedback เต็มทุกรายการ ไม่ตัดคำ
//    - ถ้าใส่ใน LINE ได้ครบทุกคำ → ส่ง LINE เสมอ
//    - ถ้า LINE ใส่ไม่ครบ (จำกัด 5 ข้อความ x 5,000 ตัวอักษร) หรือ LINE ส่งไม่ได้ → ส่ง Telegram แทน
//    - ลบข้อมูลเฉพาะเมื่อส่งครบทุกรายการสำเร็จแล้วเท่านั้น
//    - มี lock กันการรันซ้อนกัน (cron retry / กดเรียกเอง)
// ---------------------------------------------------------------------------
const LINE_CHUNK_MAX_CHARS = 4500;     // LINE จำกัดข้อความละ 5000 ตัวอักษร เผื่อที่ไว้สำหรับหัวข้อ/หมายเหตุ
const LINE_MAX_MESSAGES = 5;           // LINE จำกัด push ครั้งละไม่เกิน 5 ข้อความ (ข้อความที่ 1 = สรุปยอด)
const TELEGRAM_CHUNK_MAX_CHARS = 4000; // Telegram จำกัดข้อความละ 4096 ตัวอักษร
const TELEGRAM_MAX_MESSAGES = 15;      // เกินนี้จะส่งเป็นไฟล์ .txt แทน (กลุ่ม Telegram จำกัดราว 20 ข้อความ/นาที)
const SUMMARY_SENT_TTL_SEC = 60 * 60 * 24 * 800;
const SUMMARY_LOCK_TTL_SEC = 300;      // lock หมดอายุเองใน 5 นาที กันค้างถ้า function ถูกตัดกลางทาง

// ตั้ง PURGE_AFTER_SUMMARY=false ถ้าต้องการปิดการลบอัตโนมัติ (ค่าเริ่มต้น = เปิด)
const PURGE_ENABLED = env('PURGE_AFTER_SUMMARY') !== 'false';

/** ช่วงเวลาของปี ค.ศ. นั้นตามเวลาไทย (UTC+7) เป็น millisecond */
function bangkokYearRangeMs(year) {
    const offset = 7 * 60 * 60 * 1000;
    return { start: Date.UTC(year, 0, 1) - offset, end: Date.UTC(year + 1, 0, 1) - offset - 1 };
}

async function loadYearFeedback(year) {
    const { start, end } = bangkokYearRangeMs(year);
    const ids = await redisCommand(['ZRANGEBYSCORE', FEEDBACK_INDEX_KEY, start, end]);
    const records = [];
    for (let i = 0; i < ids.length; i += 100) {
        const raws = await redisCommand(['MGET', ...ids.slice(i, i + 100).map(feedbackKey)]);
        for (const raw of raws) {
            if (!raw) continue; // หมดอายุไปแล้ว
            try { records.push(JSON.parse(raw)); } catch { /* ข้าม record ที่เสียหาย */ }
        }
    }
    return records; // เรียงตามเวลาที่สร้างอยู่แล้ว (จาก sorted set)
}

/**
 * ลบข้อมูลของปีนั้นออกจาก Redis (เรียกหลังส่งสรุปครบแล้วเท่านั้น)
 * - ไม่ลบ record ที่สถานะ failed เพราะข้อความเหล่านั้นไม่เคยถูกส่งถึงใคร (ไม่อยู่ในสรุป) ปล่อยให้หมดอายุเองตาม TTL
 * - ไม่แตะข้อมูลของปีใหม่ (counter ปีใหม่, record ที่เพิ่งเข้ามา) และไม่ลบ key "yearly_summary_sent"
 */
async function purgeYearData(year, records) {
    const deletable = records.filter((r) => r.status !== 'failed');

    for (let i = 0; i < deletable.length; i += 100) {
        const batch = deletable.slice(i, i + 100);
        const keys = batch.flatMap((r) => [
            feedbackKey(r.ticketId),
            `feedback:resolved:${r.ticketId}`,
            ...(r.seq ? [`feedback:seq:${r.year ?? year}:${r.seq}`] : []),
        ]);
        await redisPipeline([
            ['DEL', ...keys],
            ['ZREM', FEEDBACK_INDEX_KEY, ...batch.map((r) => r.ticketId)],
        ]);
    }

    await redisCommand(['DEL', `feedback:ticket_counter:${year}`, `feedback:last_line:${year}`]);
    for (const r of deletable) feedbackMemory.delete(r.ticketId);

    return { purged: deletable.length, keptFailed: records.length - deletable.length };
}

/** ลบแล้วบันทึกลงใน sent marker ว่าลบเสร็จ (ไม่ throw) */
async function purgeAndMark(year, sentKey, sentInfo, records) {
    try {
        const result = await purgeYearData(year, records);
        await redisCommand(['SET', sentKey, JSON.stringify({ ...sentInfo, purgedAt: Date.now(), ...result }), 'EX', SUMMARY_SENT_TTL_SEC]);
        return result;
    } catch (err) {
        // ลบไม่สำเร็จ: ไม่เป็นไร รอบหน้าของ Cron จะลองลบใหม่โดยไม่ส่งสรุปซ้ำ
        console.error('❌ Purge failed (will retry on next cron run):', err.message);
        return { purged: 0, purgeError: err.message };
    }
}

const summaryDateFormat = new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false
});

/** 1 รายการ = เลข Ticket + วันเวลา + สถานะ + ผู้ส่ง + ข้อความเต็ม (ไม่ตัดคำ) */
function formatSummaryEntry(r) {
    const status = r.status === 'resolved' ? '✅ แก้ไขแล้ว' : '⏳ ยังไม่ได้กดแก้ไข';
    const who = `${r.name || 'ไม่ระบุชื่อ'} (${r.phone || 'ไม่ระบุเบอร์โทร'})`;
    return `#${r.seq} • ${summaryDateFormat.format(new Date(r.createdAt))} • ${status}\n👤 ${who}\n💬 ${r.text}`;
}

/**
 * แบ่งบล็อกเป็นก้อนไม่เกิน maxChars และไม่เกิน maxChunks ก้อน (นับเป็น UTF-16 เหมือน JS .length ซึ่งปลอดภัยไว้ก่อน)
 * บล็อกที่เหลือเกินจะนับเป็น omitted
 */
function chunkBlocks(blocks, maxChars, maxChunks, sep = '\n\n') {
    // กันกรณีบล็อกเดียวยาวเกินขีดจำกัด (ปกติไม่เกิดขึ้น) โดยหั่นเป็นชิ้นแทนการตัดทิ้ง
    const items = blocks.flatMap((b) => {
        const parts = [];
        for (let i = 0; i < b.length; i += maxChars) parts.push(b.slice(i, i + maxChars));
        return parts.length ? parts : [''];
    });

    const chunks = [];
    let i = 0;
    while (i < items.length && chunks.length < maxChunks) {
        let cur = '';
        while (i < items.length && (cur ? cur.length + sep.length : 0) + items[i].length <= maxChars) {
            cur += (cur ? sep : '') + items[i];
            i++;
        }
        chunks.push(cur);
    }
    return { chunks, omitted: items.length - i };
}

function buildYearlySummaryParts(year, totalIssued, records) {
    let resolved = 0, pending = 0, failed = 0, telegram = 0;
    const delivered = [];
    for (const r of records) {
        if (r.status === 'failed') { failed++; continue; }
        delivered.push(r);
        if (r.status === 'resolved') resolved++; else pending++;
        if (r.deliveredVia === 'telegram') telegram++;
    }

    const total = Math.max(totalIssued, delivered.length);
    const headLines = [
        `📊 สรุป Feedback ประจำปี ${year}`,
        'Cinema • สาขากาฬสินธุ์',
        '──────────────',
        `📬 รวมทั้งปี: ${total} ครั้ง`,
        `✅ แก้ไขแล้ว: ${resolved}`,
        `⏳ ยังไม่ได้กดแก้ไข: ${pending}`,
    ];
    if (telegram > 0) headLines.push(`📨 ส่งผ่าน Telegram: ${telegram}`);
    if (failed > 0) headLines.push(`⚠️ ส่งไม่สำเร็จ (เก็บข้อความไว้ ไม่นับในเลขลำดับ): ${failed}`);
    if (delivered.length < total) {
        headLines.push(`ℹ️ มีรายละเอียดเก็บไว้ ${delivered.length} จาก ${total} รายการ (ที่เหลือเป็นช่วงก่อนเปิดระบบเก็บข้อมูล)`);
    }
    headLines.push(`🔄 ปี ${year + 1} เลขลำดับจะเริ่มที่ #1 ใหม่`);

    return {
        head: headLines.join('\n'),
        listHeader: delivered.length ? `📋 รายการ Feedback ปี ${year} ทั้งหมด (เรียงตามเวลา)` : '',
        entries: delivered.map(formatSummaryEntry),
        total,
        stats: { resolved, pending, failed, telegram, stored: records.length },
    };
}

/** วางแผนส่ง LINE: คืน messages และจำนวนรายการที่ใส่ไม่ได้ (omitted = 0 แปลว่าครบทุกคำ) */
function planLineMessages({ head, listHeader, entries }) {
    const { chunks, omitted } = chunkBlocks(entries, LINE_CHUNK_MAX_CHARS, LINE_MAX_MESSAGES - 1);
    if (chunks.length) chunks[0] = `${listHeader}\n\n${chunks[0]}`;
    return { messages: [head, ...chunks], omitted };
}

/** ส่งหลายข้อความใน push เดียว (ไม่เกิน 5) ใช้ Retry Key เดียวกันทั้งสองรอบ จึงไม่ส่งซ้ำ */
async function sendLinePushTexts(texts) {
    const channelToken = env('LINE_CHANNEL_ACCESS_TOKEN');
    const targetId = env('LINE_TARGET_ID');
    if (!channelToken || !targetId) {
        console.error('❌ Missing LINE API Token or Target ID in environment variables');
        return { ok: false, quotaExceeded: false };
    }

    const retryKey = crypto.randomUUID();
    const body = JSON.stringify({ to: targetId, messages: texts.map((text) => ({ type: 'text', text })) });

    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const response = await fetchWithTimeout('https://api.line.me/v2/bot/message/push', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${channelToken}`,
                    'X-Line-Retry-Key': retryKey
                },
                body
            });
            if (response.ok || response.status === 409) return { ok: true, quotaExceeded: false };

            const errBody = (await response.text()).slice(0, 500);
            console.error(`❌ LINE yearly summary rejected (HTTP ${response.status}):`, errBody);
            if (response.status === 429 && /monthly limit/i.test(errBody)) return { ok: false, quotaExceeded: true };
            if (response.status < 500 && response.status !== 429) return { ok: false, quotaExceeded: false };
        } catch (err) {
            console.error('❌ Network Error while sending LINE yearly summary:', err.message);
        }
        if (attempt < 2) await sleep(500);
    }
    return { ok: false, quotaExceeded: false };
}

async function telegramSendMessage(text) {
    const response = await fetchWithTimeout(`https://api.telegram.org/bot${env('TELEGRAM_BOT_TOKEN')}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: env('TELEGRAM_CHAT_ID'), text, disable_web_page_preview: true })
    });
    if (!response.ok) throw new Error(`Telegram sendMessage HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
}

async function telegramSendDocument(filename, content, caption) {
    const form = new FormData();
    form.append('chat_id', env('TELEGRAM_CHAT_ID'));
    if (caption) form.append('caption', caption.slice(0, 1000));
    form.append('document', new Blob([content], { type: 'text/plain; charset=utf-8' }), filename);
    const response = await fetchWithTimeout(`https://api.telegram.org/bot${env('TELEGRAM_BOT_TOKEN')}/sendDocument`, {
        method: 'POST',
        body: form
    }, 30000);
    if (!response.ok) throw new Error(`Telegram sendDocument HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
}

/**
 * ส่งสรุปเต็มทุกคำไป Telegram
 * - พอดีใน 15 ข้อความ → ส่งเป็นข้อความ (ข้อความแรก = สรุปยอด)
 * - เกินกว่านั้น → ส่งสรุปยอดเป็นข้อความ + รายการทั้งหมดเป็นไฟล์ .txt
 * @returns {Promise<'messages'|'document'|null>} null = ส่งไม่สำเร็จ/ไม่ได้ตั้งค่า
 */
async function sendYearlySummaryToTelegram(year, { head, listHeader, entries }) {
    if (!env('TELEGRAM_BOT_TOKEN') || !env('TELEGRAM_CHAT_ID')) {
        console.warn('⚠️ Telegram not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)');
        return null;
    }

    try {
        const { chunks } = chunkBlocks(entries, TELEGRAM_CHUNK_MAX_CHARS, Infinity);
        if (chunks.length) chunks[0] = `${listHeader}\n\n${chunks[0]}`;

        if (1 + chunks.length <= TELEGRAM_MAX_MESSAGES) {
            for (const text of [head, ...chunks]) await telegramSendMessage(text);
            return 'messages';
        }

        await telegramSendMessage(`${head}\n\n📎 รายการ Feedback ทั้งหมดอยู่ในไฟล์แนบ (มากเกินกว่าจะส่งเป็นข้อความ)`);
        await telegramSendDocument(`feedback-${year}.txt`, `${head}\n\n${listHeader}\n\n${entries.join('\n\n')}\n`, `Feedback ประจำปี ${year} ทั้งหมด`);
        return 'document';
    } catch (err) {
        console.error('❌ Telegram yearly summary failed:', err.message);
        return null;
    }
}

/**
 * ส่งสรุปประจำปี แล้วลบข้อมูลของปีนั้น — ส่งซ้ำไม่ได้ถ้าเคยส่งสำเร็จแล้ว เว้นแต่ force
 *  0) ขอ lock ก่อน ถ้ามีรอบอื่นกำลังรันอยู่ → คืน in_progress ทันที (กันส่งซ้ำ)
 *  1) ถ้า LINE ใส่ได้ครบทุกคำ → ส่ง LINE ก่อนเสมอ (ถ้า LINE ส่งไม่สำเร็จ → ลอง Telegram)
 *  2) ถ้า LINE ใส่ไม่ครบ → ส่ง Telegram ฉบับเต็มแทน
 *  3) ถ้า Telegram ใช้ไม่ได้ในกรณี 2 → ส่ง LINE ฉบับตัด (มีหมายเหตุบอกจำนวนที่ไม่ได้แสดง) ดีกว่าไม่ส่งเลย
 *     แต่กรณีนี้ "ไม่ลบข้อมูล" เพราะยังส่งไม่ครบ
 *  4) ลบข้อมูลเฉพาะเมื่อส่งครบทุกรายการสำเร็จแล้วเท่านั้น
 * หมายเหตุ: ตัวนับเลข Ticket เก็บแยกตามปี (feedback:ticket_counter:<ปี>) ปีใหม่จึงเริ่มที่ 0 เองโดยไม่ต้องลบอะไร
 */
async function sendYearlySummary(year, { force = false } = {}) {
    const sentKey = `feedback:yearly_summary_sent:${year}`;
    const lockKey = `feedback:summary_lock:${year}`;

    // 🔐 ขอ lock (SET NX EX) — ถ้าไม่ได้ แปลว่ามีอีกรอบกำลังทำงาน
    const lock = await redisCommand(['SET', lockKey, String(Date.now()), 'NX', 'EX', SUMMARY_LOCK_TTL_SEC]);
    if (lock !== 'OK') return { status: 'in_progress' };

    try {
        // เคยส่งแล้ว?
        const prevRaw = await redisCommand(['GET', sentKey]);
        const prev = prevRaw ? JSON.parse(prevRaw) : null;

        if (prev) {
            if (prev.purgedAt) {
                // ข้อมูลถูกลบไปแล้ว ห้าม force ส่งซ้ำ เพราะจะได้สรุปว่างเปล่า
                return { status: force ? 'already_purged' : 'already_sent', purgedAt: prev.purgedAt };
            }
            if (!force) {
                // ส่งครบแล้วแต่ครั้งก่อนลบไม่เสร็จ → ลบต่อ โดยไม่ส่งสรุปซ้ำ
                if (PURGE_ENABLED && prev.delivery !== 'truncated') {
                    const records = await loadYearFeedback(year);
                    const purge = await purgeAndMark(year, sentKey, prev, records);
                    return { status: 'already_sent', ...purge };
                }
                return { status: 'already_sent' };
            }
        }

        const [records, counterRaw] = await Promise.all([
            loadYearFeedback(year),
            redisCommand(['GET', `feedback:ticket_counter:${year}`]),
        ]);
        const parts = buildYearlySummaryParts(year, Number(counterRaw) || 0, records);
        const linePlan = planLineMessages(parts);
        const fitsInLine = linePlan.omitted === 0;

        let via = null, delivery = null, truncated = 0;

        if (fitsInLine) {
            const line = await sendLinePushTexts(linePlan.messages);
            if (line.ok) { via = 'line'; delivery = 'messages'; }
        }

        if (!via) {
            const tg = await sendYearlySummaryToTelegram(year, parts);
            if (tg) { via = 'telegram'; delivery = tg; }
        }

        if (!via && !fitsInLine) {
            // Telegram ใช้ไม่ได้ และ LINE ใส่ไม่ครบ: ส่ง LINE ฉบับตัดดีกว่าไม่ส่งเลย พร้อมบอกชัดว่าไม่ครบ
            const messages = [...linePlan.messages];
            messages[messages.length - 1] += `\n\n… และอีก ${linePlan.omitted} รายการ ไม่ได้แสดง (LINE จำกัดจำนวนข้อความ และส่งไป Telegram ไม่สำเร็จ)`;
            const line = await sendLinePushTexts(messages);
            if (line.ok) { via = 'line'; delivery = 'truncated'; truncated = linePlan.omitted; }
        }

        if (!via) return { status: 'send_failed' };

        const sentInfo = { at: Date.now(), via, delivery };
        await redisCommand(['SET', sentKey, JSON.stringify(sentInfo), 'EX', SUMMARY_SENT_TTL_SEC]);

        // 🧹 ลบข้อมูลเฉพาะเมื่อส่งครบทุกรายการแล้วเท่านั้น (ฉบับตัด 'truncated' = ยังส่งไม่ครบ ห้ามลบ)
        let purge = { purged: 0, skipped: true };
        if (PURGE_ENABLED && delivery !== 'truncated') {
            purge = await purgeAndMark(year, sentKey, sentInfo, records);
        }

        return {
            status: 'sent', via, delivery, year, total: parts.total, entries: parts.entries.length,
            lineMessages: via === 'line' ? linePlan.messages.length : undefined, truncated, ...parts.stats, ...purge,
        };
    } finally {
        // ปล่อย lock เสมอ (สำเร็จ/ล้มเหลว/exception) เพื่อให้ลองใหม่ได้ทันที
        // ถ้าส่งสำเร็จแล้ว sent marker จะกันการส่งซ้ำเอง
        try {
            await redisCommand(['DEL', lockKey]);
        } catch (err) {
            console.error('⚠️ Could not release summary lock (will expire by TTL):', err.message);
        }
    }
}

/**
 * Endpoint สำหรับ Vercel Cron (ส่ง GET พร้อม Authorization: Bearer <CRON_SECRET> ให้อัตโนมัติ)
 * ?year=2026  สรุปปีที่ระบุ (ค่าเริ่มต้น = ปีที่แล้วตามเวลาไทย)   ?force=1  ส่งซ้ำแม้เคยส่งแล้ว (ถ้ายังไม่ถูกลบ)
 */
app.get('/api/cron/yearly-summary', async (req, res) => {
    const secret = env('CRON_SECRET');
    if (!secret) {
        console.error('❌ CRON_SECRET is not set — yearly summary endpoint disabled');
        return res.status(503).json({ error: 'CRON_SECRET is not configured' });
    }
    const provided = Buffer.from(String(req.headers.authorization || ''));
    const expected = Buffer.from(`Bearer ${secret}`);
    if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!redisEnabled()) {
        return res.status(503).json({ error: 'Redis is required for the yearly summary' });
    }

    const currentYear = getBangkokYear();
    const year = req.query?.year ? Number(req.query.year) : currentYear - 1;
    if (!Number.isInteger(year) || year < 2000 || year > currentYear) {
        return res.status(400).json({ error: 'Invalid year' });
    }

    try {
        const result = await sendYearlySummary(year, { force: req.query?.force === '1' });
        const code = result.status === 'send_failed' ? 502 : 200;
        console.log(`📊 Yearly summary ${year}:`, JSON.stringify(result));
        return res.status(code).json(result);
    } catch (err) {
        console.error('❌ Yearly summary error:', err.message);
        return res.status(500).json({ error: 'Yearly summary failed' });
    }
});

// ---------------------------------------------------------------------------
// 🚧 404 & Global Error Handler
// ---------------------------------------------------------------------------
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') {
        return res.status(413).json({ error: 'ข้อมูลที่ส่งมีขนาดใหญ่เกินไป' });
    }
    if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
        return res.status(400).json({ error: 'รูปแบบข้อมูลไม่ถูกต้อง' });
    }
    console.error('❌ Unhandled error:', err.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ' });
});

export default app;