import express from 'express';
import dotenv from 'dotenv';
import crypto from 'crypto';

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

const env = (name) => process.env[name]?.trim() || '';

// เตือนตั้งแต่เริ่มระบบ ถ้าตั้งค่าไม่ครบ
(function checkEnvOnStartup() {
    if (!env('LINE_CHANNEL_SECRET')) console.error('❌ LINE_CHANNEL_SECRET is not set — /api/webhook will reject all requests');
    if (!env('LINE_CHANNEL_ACCESS_TOKEN')) console.error('❌ LINE_CHANNEL_ACCESS_TOKEN is not set');
    if (!env('LINE_TARGET_ID')) console.warn('⚠️ LINE_TARGET_ID is not set — feedback cannot be pushed (คำสั่ง "id" ในกลุ่มยังใช้ได้)');
    if (!env('UPSTASH_REDIS_REST_URL') || !env('UPSTASH_REDIS_REST_TOKEN')) {
        console.warn('⚠️ Redis is not configured — ใช้ in-memory แทน (เลขลำดับ/สถานะ ticket/rate limit จะหายเมื่อ restart และไม่ทำงานข้าม instance บน Vercel)');
    }
})();

// ---------------------------------------------------------------------------
// 🔒 Security Headers
// ---------------------------------------------------------------------------
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-XSS-Protection', '0');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    res.setHeader('Cache-Control', 'no-store');
    next();
});

// CORS: ปิดไว้เป็นค่าเริ่มต้น (same-origin เท่านั้น)
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
 * เลขลำดับ Feedback ประจำปี (รีเซ็ตเมื่อขึ้นปีใหม่)
 * ใช้ Redis INCR เพื่อให้เลขไม่ซ้ำ/ไม่รีเซ็ต แม้ระบบ restart หรือรันหลาย instance
 */
async function getNextTicketNumber() {
    const year = getBangkokYear();

    if (redisEnabled()) {
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

/**
 * Fixed-window rate limiter
 */
async function consumeRateLimit(key, limit, windowSec) {
    if (redisEnabled()) {
        try {
            const rkey = `feedback:rl:${key}`;
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

async function feedbackRateLimit(req, res, next) {
    try {
        const ip = req.ip || 'unknown';

        const perIp = await consumeRateLimit(`ip:${ip}`, CONFIG.rateLimitPerIp, CONFIG.rateLimitWindowSec);
        if (perIp.limited) {
            res.setHeader('Retry-After', String(perIp.retryAfterSec));
            const waitMin = Math.max(1, Math.ceil(perIp.retryAfterSec / 60));
            return res.status(429).json({ error: `ส่งข้อความบ่อยเกินไป กรุณารออีกประมาณ ${waitMin} นาทีแล้วลองใหม่` });
        }

        const global = await consumeRateLimit('global', CONFIG.rateLimitGlobalPerHour, 3600);
        if (global.limited) {
            res.setHeader('Retry-After', String(global.retryAfterSec));
            return res.status(429).json({ error: 'ระบบมีผู้ใช้งานจำนวนมาก กรุณาลองใหม่ภายหลัง' });
        }

        next();
    } catch (err) {
        console.error('❌ Rate limit middleware error:', err.message);
        next();
    }
}

// ---------------------------------------------------------------------------
// 🧹 Input Sanitizing & Validation
// ---------------------------------------------------------------------------
const codePointLength = (str) => [...str].length;

function cleanTextInput(input) {
    if (typeof input !== 'string') return '';
    return input
        .normalize('NFC')
        .replace(/\r\n?/g, '\n')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '')
        .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

async function verifyTurnstile(token, ip) {
    const secret = env('TURNSTILE_SECRET_KEY');
    if (!secret) return true;
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
                            displayText: `ทำการแก้ไข Feedback #${ticketSeqNumber} เรียบร้อยแล้ว`
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

async function sendLinePushAlert(payloadData) {
    const channelToken = env('LINE_CHANNEL_ACCESS_TOKEN');
    const targetId = env('LINE_TARGET_ID');

    if (!channelToken || !targetId) {
        console.error('❌ Missing LINE API Token or Target ID in environment variables');
        return false;
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

            if (response.ok || response.status === 409) return true;

            const errBody = (await response.text()).slice(0, 500);
            console.error(`❌ LINE API Rejected Push (HTTP ${response.status}):`, errBody);

            if (response.status < 500 && response.status !== 429) return false;
        } catch (err) {
            console.error('❌ Network Error while sending LINE Push Alert:', err.message);
        }

        if (attempt < 2) await sleep(500);
    }
    return false;
}

async function sendLineReply(replyToken, text) {
    const channelToken = env('LINE_CHANNEL_ACCESS_TOKEN');
    if (!channelToken || !replyToken) return;

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
        }
    } catch (err) {
        console.error('❌ Network Error while sending LINE reply:', err.message);
    }
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

            if (typeof body.website === 'string' && body.website.trim() !== '') {
                return res.json({ success: true, line_sent: true });
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

            const humanOk = await verifyTurnstile(body.turnstileToken, req.ip);
            if (!humanOk) {
                return res.status(403).json({ error: 'การตรวจสอบความปลอดภัยไม่ผ่าน กรุณาลองใหม่' });
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

            const lineSuccess = await sendLinePushAlert({
                customerText: cleanText,
                name: cleanName,
                phone: cleanPhone,
                formattedDate,
                ticketSeqNumber,
                ticketId
            });

            if (!lineSuccess) {
                return res.status(502).json({
                    success: false,
                    line_sent: false,
                    error: 'ไม่สามารถส่งข้อความได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง'
                });
            }

            return res.json({ success: true, line_sent: true });
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
    if (targetId && sourceId !== targetId) {
        console.warn('⚠️ Ignored postback from non-target source');
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

    const isFirstResolve = await markTicketResolved(ticketId);

    // ดึงเวลาปัจจุบันในรูปแบบ ไทย (HH:mm น.)
    const now = new Date();
    const resolveTime = now.toLocaleTimeString('th-TH', {
        timeZone: 'Asia/Bangkok',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }) + ' น.';

    if (!isFirstResolve) {
        console.log(`⚠️ Ticket ID: ${ticketId} ถูกแก้ไขไปแล้ว (ข้ามการประมวลผล)`);
        if (event.replyToken) {
            await sendLineReply(
                event.replyToken,
                `⚠️ [แจ้งเตือน]\nFeedback นี้ได้รับการตรวจสอบ/แก้ไขไปแล้วก่อนหน้านี้ครับ`
            );
        }
        return;
    }

    console.log(`✅ บันทึกการแก้ไข Ticket ID: ${ticketId} (#${seq || '?'}) สำเร็จ`);
    if (event.replyToken) {
        await sendLineReply(
            event.replyToken,
            `✅ [อัปเดตสถานะ]\nFeedback #${seq || '?'}\nได้รับการตรวจสอบ/แก้ไขเรียบร้อยแล้ว เมื่อเวลา ${resolveTime}`
        );
    }
}

async function handleTextMessage(event) {
    const groupId = event.source?.groupId;
    const text = event.message?.text;

    if (!groupId || !event.replyToken || typeof text !== 'string') return;
    if (text.toLowerCase().trim() !== 'id') return;

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

        for (const event of events) {
            try {
                if (event.type === 'postback') {
                    await handlePostback(event);
                } else if (event.type === 'message' && event.message?.type === 'text') {
                    await handleTextMessage(event);
                }
            } catch (err) {
                console.error('❌ Webhook event error:', err.message);
            }
        }

        return res.status(200).send('OK');
    }
);

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