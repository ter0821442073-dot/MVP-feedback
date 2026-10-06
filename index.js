import express from 'express';
import dotenv from 'dotenv';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

dotenv.config();

const app = express();

// --- 🔒 เพิ่ม Security Headers เพื่อป้องกัน XSS และ Vulnerabilities ---
app.use((req, res, next) => {
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});

// หมายเหตุ: LINE Webhook จำเป็นต้องใช้ raw body ในการตรวจสอบ HMAC Signature
app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf;
    }
}));

// In-Memory State สำหรับจดจำสถานะ Ticket (ป้องกันการกดซ้ำ)
const resolvedTickets = new Set();

/**
 * ฟังก์ชันดึงปี ค.ศ. ตามเวลาประเทศไทย (Asia/Bangkok)
 */
function getBangkokYear() {
    const bangkokDateStr = new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' });
    return new Date(bangkokDateStr).getFullYear();
}

// -------------------------------------------------------------
// 📁 ระบบบันทึกเลขลำดับลงไฟล์ JSON (Persistent Counter)
// -------------------------------------------------------------
const COUNTER_FILE_PATH = path.join(process.cwd(), 'ticket_counter.json');

/**
 * ฟังก์ชันอ่านข้อมูลตัวนับล่าสุดจากไฟล์
 */
function loadCounterData() {
    try {
        if (fs.existsSync(COUNTER_FILE_PATH)) {
            const data = fs.readFileSync(COUNTER_FILE_PATH, 'utf8');
            return JSON.parse(data);
        }
    } catch (err) {
        console.error('⚠️ ไม่สามารถอ่านไฟล์ counter ได้:', err.message);
    }
    return { year: getBangkokYear(), count: 0 };
}

/**
 * ฟังก์ชันดึงเลขลำดับประจำปี (รีเซ็ตเป็น 1 เมื่อเปลี่ยนปีใหม่ และบันทึกลงไฟล์)
 */
function getNextTicketNumber() {
    const nowYear = getBangkokYear();
    let counterData = loadCounterData();

    // เช็กว่าเข้าสู่ปีใหม่แล้วหรือยัง
    if (counterData.year !== nowYear) {
        counterData.year = nowYear;
        counterData.count = 0; // รีเซ็ตเมื่อเริ่มปีใหม่
    }

    counterData.count += 1; // เพิ่มทีละ 1

    // บันทึกค่าล่าสุดกลับลงไฟล์ JSON
    try {
        fs.writeFileSync(COUNTER_FILE_PATH, JSON.stringify(counterData, null, 2), 'utf8');
    } catch (err) {
        console.error('❌ ไม่สามารถบันทึกไฟล์ counter ได้:', err.message);
    }

    return counterData.count;
}
// -------------------------------------------------------------

/**
 * ฟังก์ชันกรองข้อความ (Sanitize) ป้องกัน XSS สคริปต์แบบพื้นฐาน
 */
function sanitizeInput(input) {
    if (typeof input !== 'string') return '';
    return input
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;')
        .trim();
}

/**
 * Middleware ตรวจสอบ Signature จาก LINE เพื่อความปลอดภัย
 */
function verifyLineSignature(req, res, next) {
    const channelSecret = process.env.LINE_CHANNEL_SECRET?.trim();
    const signature = req.headers['x-line-signature'];

    if (!channelSecret) {
        console.warn('⚠️ Warning: LINE_CHANNEL_SECRET is not set. Skipping signature verification.');
        return next();
    }

    if (!signature || !req.rawBody) {
        return res.status(401).send('Unauthorized: Missing signature or body');
    }

    const hash = crypto
        .createHmac('SHA256', channelSecret)
        .update(req.rawBody)
        .digest('base64');

    if (hash !== signature) {
        console.error('❌ Invalid LINE Webhook Signature');
        return res.status(403).send('Forbidden: Invalid signature');
    }

    next();
}

/**
 * ฟังก์ชันส่ง LINE Push Alert ด้วย Flex Message
 */
async function sendLinePushAlert(customerText, name, phone, formattedDate, timeOnly) {
    const channelToken = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
    const targetId = process.env.LINE_TARGET_ID?.trim();

    if (!channelToken || !targetId) {
        console.error('❌ Missing LINE API Token or Target ID in environment variables');
        return false;
    }

    const customerInfo = `${name || 'ไม่ระบุชื่อ'} (${phone || 'ไม่ระบุเบอร์โทร'})`;
    
    // ดึงลำดับเลขประจำปี (รันเพิ่มทีละ 1 ถาวร และรีเซ็ตอัตโนมัติเมื่อเข้าปีใหม่)
    const ticketSeqNumber = getNextTicketNumber();
    
    // สุ่มสร้าง Ticket ID สำหรับ Postback
    const ticketId = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 10)}`;

    // ตัดความยาวข้อความสำหรับ altText (LINE จำกัดที่ 400 ตัวอักษร)
    const shortAltText = customerText.length > 50 ? customerText.substring(0, 50) + '...' : customerText;

    const flexPayload = {
        type: "flex",
        altText: `📬 Feedback ใหม่ (#${ticketSeqNumber}): ${shortAltText}`,
        contents: {
            type: "bubble",
            header: {
                type: "box",
                layout: "vertical",
                contents: [
                    {
                        type: "box",
                        layout: "horizontal",
                        contents: [
                            {
                                type: "text",
                                text: `📢 แจ้งเตือน Feedback`,
                                weight: "bold",
                                color: "#ffffff",
                                size: "md",
                                flex: 4
                            },
                            {
                                type: "text",
                                text: `#${ticketSeqNumber}`,
                                weight: "bold",
                                color: "#ffffff",
                                size: "md",
                                align: "end",
                                flex: 1
                            }
                        ]
                    },
                    {
                        type: "text",
                        text: "Cinema • สาขากาฬสินธุ์",
                        color: "#ffffffcc",
                        size: "xs",
                        margin: "xs"
                    }
                ],
                backgroundColor: "#03C755",
                paddingAll: "md"
            },
            body: {
                type: "box",
                layout: "vertical",
                contents: [
                    {
                        type: "box",
                        layout: "horizontal",
                        contents: [
                            { type: "text", text: "👤 ผู้ส่ง:", size: "xs", color: "#8c8c8c", flex: 2 },
                            { type: "text", text: customerInfo, size: "xs", color: "#111111", weight: "bold", flex: 5, wrap: true }
                        ]
                    },
                    {
                        type: "box",
                        layout: "horizontal",
                        contents: [
                            { type: "text", text: "📅 เวลา:", size: "xs", color: "#8c8c8c", flex: 2 },
                            { type: "text", text: formattedDate, size: "xs", color: "#111111", flex: 5 }
                        ],
                        margin: "xs"
                    },
                    { type: "separator", margin: "md" },
                    {
                        type: "box",
                        layout: "vertical",
                        contents: [
                            { type: "text", text: "💬 ข้อความที่ได้รับ:", size: "xs", color: "#8c8c8c" },
                            { type: "text", text: `"${customerText}"`, size: "lg", color: "#111111", weight: "bold", wrap: true, margin: "xs" }
                        ],
                        margin: "md",
                        backgroundColor: "#f8f9fa",
                        paddingAll: "md",
                        cornerRadius: "md"
                    }
                ]
            },
            footer: {
                type: "box",
                layout: "vertical",
                contents: [
                    {
                        type: "button",
                        action: {
                            type: "postback",
                            label: "☑ ทำการแก้ไขแล้ว",
                            data: `action=resolve&ticket_id=${ticketId}`,
                            displayText: `ทำการแก้ไข Feedback #${ticketSeqNumber} เรียบร้อยแล้ว`
                        },
                        style: "primary",
                        color: "#007bff",
                        height: "sm"
                    }
                ]
            }
        }
    };

    try {
        const response = await fetch('https://api.line.me/v2/bot/message/push', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${channelToken}`
            },
            body: JSON.stringify({
                to: targetId,
                messages: [flexPayload]
            })
        });

        if (!response.ok) {
            const errBody = await response.text();
            console.error('❌ LINE API Rejected Push:', errBody);
            return false;
        }

        return true;
    } catch (err) {
        console.error('❌ Network Error while sending LINE Push Alert:', err.message);
        return false;
    }
}

// Endpoint รับข้อมูล Feedback
app.post('/api/feedback', async (req, res) => {
    try {
        const { text, name, phone } = req.body;
        
        if (!text || typeof text !== 'string' || !text.trim()) {
            return res.status(400).json({ error: 'กรุณากรอกข้อความ Feedback ให้ถูกต้อง' });
        }

        // 🔒 ทำการ Sanitize ข้อมูลเพื่อป้องกัน XSS
        const sanitizedText = sanitizeInput(text);
        const sanitizedName = sanitizeInput(name);
        const sanitizedPhone = sanitizeInput(phone);

        const now = new Date();
        const formattedDate = now.toLocaleString('th-TH', {
            timeZone: 'Asia/Bangkok',
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
        }) + ' น.';

        const timeOnly = now.toLocaleString('th-TH', {
            timeZone: 'Asia/Bangkok',
            hour: '2-digit', minute: '2-digit', hour12: false
        });

        const lineSuccess = await sendLinePushAlert(sanitizedText, sanitizedName, sanitizedPhone, formattedDate, timeOnly);

        return res.json({ 
            success: true, 
            line_sent: lineSuccess 
        });
    } catch (error) {
        console.error('❌ Error inside /api/feedback:', error.message);
        return res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ' });
    }
});

// Endpoint สำหรับ Webhook LINE
app.post('/api/webhook', verifyLineSignature, async (req, res) => {
    try {
        const channelToken = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
        const events = req.body.events || [];

        for (const event of events) {
            // เมื่อมีการกดปุ่ม Postback
            if (event.type === 'postback') {
                let ticketId = null;

                try {
                    const postbackData = new URLSearchParams(event.postback.data);
                    ticketId = postbackData.get('ticket_id');
                } catch (e) {
                    console.error('❌ Error parsing postback data:', e.message);
                }

                if (ticketId) {
                    // 🔒 ตรวจสอบว่า Ticket นี้ถูกบันทึกไปแล้วหรือยัง (ป้องกันการล็อกประมวลผลซ้ำ)
                    if (resolvedTickets.has(ticketId)) {
                        console.log(`⚠️ Ticket ID: ${ticketId} ถูกแก้ไขไปแล้ว (ข้ามการประมวลผล)`);
                        continue;
                    }

                    if (resolvedTickets.size > 3000) resolvedTickets.clear();
                    resolvedTickets.add(ticketId);

                    console.log(`✅ บันทึกการแก้ไข Ticket ID: ${ticketId} สำเร็จ`);
                }
            }

            // คำสั่งพิมพ์ 'id' เพื่อเช็ก Group ID
            if (event.type === 'message' && event.message.type === 'text') {
                const groupId = event.source.groupId;
                const replyToken = event.replyToken;
                
                if (groupId && replyToken && event.message.text.toLowerCase().trim() === 'id' && channelToken) {
                    await fetch('https://api.line.me/v2/bot/message/reply', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${channelToken}`
                        },
                        body: JSON.stringify({
                            replyToken: replyToken,
                            messages: [{ type: 'text', text: `📌 Group ID ของกลุ่มนี้คือ:\n${groupId}` }]
                        })
                    });
                }
            }
        }
        return res.status(200).send('OK');
    } catch (err) {
        console.error('❌ Webhook Error:', err.message);
        return res.status(200).send('OK');
    }
});

export default app;