import express from 'express';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const app = express();

// --- 🔒 Security Headers ---
app.use((req, res, next) => {
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});

app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf;
    }
}));

// In-Memory State สำหรับจดจำสถานะ Ticket
const resolvedTickets = new Set();

setInterval(() => {
    if (resolvedTickets.size > 5000) {
        resolvedTickets.clear();
    }
}, 3600000);

/**
 * ฟังก์ชันกรองข้อความ (Sanitize) ป้องกัน XSS สคริปต์
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
 * Middleware ตรวจสอบ Signature จาก LINE
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
async function sendLinePushAlert(customerText, name, phone, formattedDate) {
    const channelToken = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
    const targetId = process.env.LINE_TARGET_ID?.trim();

    if (!channelToken || !targetId) {
        console.error('❌ Missing LINE API Token or Target ID in environment variables');
        return false;
    }

    const customerInfo = `${name || 'ไม่ระบุชื่อ'} (${phone || 'ไม่ระบุเบอร์โทร'})`;
    const ticketId = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 10)}`;

    // ล้างค่าขึ้นบรรทัดใหม่ (\n, \r)
    const cleanText = customerText.replace(/[\r\n]+/g, ' ').trim();

    // ตัดความยาวข้อความสำหรับ Flex Text Body ไม่เกิน 150 ตัวอักษร
    const flexDisplayText = cleanText.length > 150 
        ? cleanText.substring(0, 150) + '...' 
        : cleanText;

    // ตัดความยาวสำหรับ altText ให้สั้นและปลอดภัยที่สุด
    const shortAltText = cleanText.length > 25 
        ? cleanText.substring(0, 25) + '...' 
        : cleanText;

    const flexPayload = {
        type: "flex",
        altText: `📬 Feedback (#${ticketId}): ${shortAltText}`,
        contents: {
            type: "bubble",
            header: {
                type: "box",
                layout: "horizontal",
                contents: [
                    {
                        type: "box",
                        layout: "vertical",
                        contents: [
                            {
                                type: "text",
                                text: "📢 แจ้งเตือน Feedback",
                                weight: "bold",
                                color: "#ffffff",
                                size: "sm"
                            },
                            {
                                type: "text",
                                text: "Cinema • สาขากาฬสินธุ์",
                                color: "#ffffffcc",
                                size: "xs",
                                margin: "xs"
                            }
                        ],
                        flex: 3
                    },
                    {
                        type: "text",
                        text: `#${ticketId}`,
                        color: "#ffffff",
                        size: "xs",
                        weight: "bold",
                        align: "end",
                        gravity: "top",
                        flex: 2
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
                            { type: "text", text: `"${flexDisplayText}"`, size: "sm", color: "#111111", weight: "bold", wrap: true, margin: "xs" }
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
                            displayText: `รับทราบ/ทำการแก้ไข Feedback (#${ticketId}) เรียบร้อยแล้ว`
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
            console.error('❌ LINE API Rejected Push Details:', errBody);
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

        const sanitizedText = sanitizeInput(text);
        const sanitizedName = sanitizeInput(name);
        const sanitizedPhone = sanitizeInput(phone);

        const now = new Date();
        const formattedDate = now.toLocaleString('th-TH', {
            timeZone: 'Asia/Bangkok',
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
        }) + ' น.';

        const lineSuccess = await sendLinePushAlert(sanitizedText, sanitizedName, sanitizedPhone, formattedDate);

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
            if (event.type === 'postback') {
                const replyToken = event.replyToken;
                let ticketId = null;

                try {
                    const postbackData = new URLSearchParams(event.postback.data);
                    ticketId = postbackData.get('ticket_id');
                } catch (e) {
                    console.error('❌ Error parsing postback data:', e.message);
                }

                if (replyToken && channelToken) {
                    let updateMessage = '';

                    if (ticketId && resolvedTickets.has(ticketId)) {
                        updateMessage = `⚠ [แจ้งเตือน]\nFeedback Ticket #${ticketId} นี้ได้รับการตรวจสอบ/แก้ไขไปแล้วก่อนหน้านี้ครับ`;
                    } else {
                        if (ticketId) {
                            resolvedTickets.add(ticketId);
                        }
                        const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' });
                        updateMessage = `✅ [อัปเดตสถานะ]\nFeedback Ticket #${ticketId || 'N/A'}\nได้รับการตรวจสอบ/แก้ไขเรียบร้อยแล้ว เมื่อเวลา ${now} น.`;
                    }

                    await fetch('https://api.line.me/v2/bot/message/reply', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${channelToken}`
                        },
                        body: JSON.stringify({
                            replyToken: replyToken,
                            messages: [{
                                type: 'text',
                                text: updateMessage
                            }]
                        })
                    });
                }
            }

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