import express from 'express';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const app = express();

app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf;
    }
}));

const resolvedTickets = new Set();

setInterval(() => {
    if (resolvedTickets.size > 5000) {
        resolvedTickets.clear();
    }
}, 3600000);

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
 * Guardrail ฉบับปรับปรุง: เน้นปรับจูนกรณี AI ตีความหลุดวิกฤตจริงๆ เท่านั้น (ไม่ Overrule AI เกินไป)
 */
function applyGuardrail(analysis, text) {
    const textLower = (text || '').toLowerCase();

    // หากพบคำว่า "ทำไม", "ไม่ตรง", "ช้า", "รอ" หรือประโยคตั้งคำถามเชิงปัญหา ให้ปรับอย่างน้อยเป็น Medium/High
    const questionProblemPattern = ['ทำไม', 'ทำไมถึง', 'ไม่ตรง', 'โชว์ไทม์', 'รอนาน', 'ปัญหา'];
    const hasQuestionProblem = questionProblemPattern.some(k => textLower.includes(k));

    if (hasQuestionProblem && analysis.sentiment === 'Positive') {
        analysis.sentiment = 'Negative';
        analysis.urgency = 'High';
    }

    if (analysis.sentiment === 'Negative' && analysis.urgency === 'Low') {
        analysis.urgency = 'Medium';
    }

    return analysis;
}

/**
 * Fallback Algorithm ฉบับปรับปรุงตามบริบทภาษาพูด
 */
function getDefaultAnalysis(text) {
    const textLower = (text || '').toLowerCase();

    const isNegativePattern = ['ทำไม', 'ไม่ตรง', 'ช้า', 'ไม่ดี', 'แย่', 'ห่วย', 'เสีย', 'พัง', 'จอดำ', 'ไม่มี', 'ใช้ไม่ได้', 'รอ'].some(k => textLower.includes(k));
    const isPositivePattern = ['ดี', 'ชอบ', 'ประทับใจ', 'ขอบคุณ', 'อร่อย', 'เยี่ยม', 'น่ารัก'].some(k => textLower.includes(k));

    let category = 'ทั่วไป / คำชม';
    let action = 'ขอบคุณสำหรับข้อเสนอแนะ และจะนำไปพัฒนาปรับปรุงการให้บริการต่อไป';

    if (['รอบ', 'โชว์ไทม์', 'เวลา', 'ตั๋ว', 'แอป', 'จอง'].some(k => textLower.includes(k))) {
        category = 'ระบบตั๋วและแอปพลิเคชัน';
        action = 'แจ้งผู้จัดการสาขาและทีมระบบตรวจสอบตารางฉาย/รอบโชว์ไทม์กับรอบจริงด่วน';
    } else if (['พนักงาน', 'บริการ', 'พูด', 'เคาน์เตอร์'].some(k => textLower.includes(k))) {
        category = 'พนักงานและการบริการ';
        action = 'ประสานงานผู้จัดการสาขา ตรวจสอบและปรับปรุงการบริการของพนักงาน';
    } else if (['หนัง', 'ภาพ', 'เสียง', 'ฉาย', 'จอ'].some(k => textLower.includes(k))) {
        category = 'ระบบฉายและเสียง';
        action = '🚨 แจ้งช่างเทคนิคและผู้จัดการโรงภาพยนตร์เข้าตรวจสอบห้องควบคุมการฉายทันที!';
    } else if (['ป๊อปคอร์น', 'น้ำ', 'โค้ก', 'อาหาร'].some(k => textLower.includes(k))) {
        category = 'อาหารและเครื่องดื่ม';
        action = 'แจ้งทีมเคาน์เตอร์อาหารตรวจสอบสินค้าและการให้บริการ';
    }

    const result = {
        sentiment: isNegativePattern ? 'Negative' : (isPositivePattern ? 'Positive' : 'Neutral'),
        urgency: isNegativePattern ? 'High' : 'Low',
        category: category,
        summary: text,
        action_recommendation: action
    };

    return applyGuardrail(result, text);
}

/**
 * 3. ฟังก์ชัน AI วิเคราะห์ความคิดเห็น (Human-like Contextual Thinking Prompt)
 */
async function analyzeFeedbackWithAI(customerText) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return getDefaultAnalysis(customerText);
    }

    // Prompt ใหม่: เน้นให้ AI คิดวิเคราะห์แบบมนุษย์ เข้าใจความรู้สึก ความสงสัย และคำถามจากลูกค้า
    const promptText = `คุณคือผู้จัดการโรงภาพยนตร์ที่มีความใส่ใจ ประสบการณ์สูง และเข้าใจความรู้สึกของลูกค้าอย่างลึกซึ้ง
วิเคราะห์ข้อความ Feedback จากลูกค้าต่อไปนี้: "${customerText}"

หลักการวิเคราะห์แบบมนุษย์:
1. วิเคราะห์เจตนาและความรู้สึก (Sentiment):
   - หากลูกค้าตั้งคำถามเกี่ยวกับความผิดพลาด ปัญหา ความไม่สะดวกสบาย (เช่น "ทำไม...", "รอบไม่ตรง", "รอนาน", "แอร์ร้อน") หรือแสดงความไม่พึงพอใจ ให้จัดเป็น "Negative" ทันที
   - หากเป็นการชมเชย ชื่นชม ประทับใจ ให้จัดเป็น "Positive"
   - หากเป็นคำถามสอบถามข้อมูลทั่วไปแบบเป็นกลาง ไม่มีอารมณ์สับสนหรือขัดข้องใจ ให้จัดเป็น "Neutral"

2. ระดับความสำคัญ (Urgency):
   - "Critical": ปัญหาหน้างานกระทบคนหมู่มากทันที (เช่น จอดำ, ไม่มีเสียง, หนังไม่ฉาย)
   - "High": ข้อผิดพลาดที่ทำให้ลูกค้าเสียอารมณ์ เสียเวลา หรือข้อมูลไม่ถูกต้อง (เช่น รอบฉายไม่ตรง, คูปองใช้ไม่ได้, พนักงานบริการไม่ดี)
   - "Medium": ข้อเสนอแนะหรือปัญหาเล็กน้อย
   - "Low": คำชมเชย หรือความคิดเห็นทั่วไป

3. จำแนกหมวดหมู่ (Category) ให้ตรงกับบริบทที่สุด:
   - "ระบบตั๋วและแอปพลิเคชัน" (รวมถึงรอบฉาย/โชว์ไทม์)
   - "พนักงานและการบริการ"
   - "อาหารและเครื่องดื่ม"
   - "ระบบฉายและเสียง"
   - "ระบบปรับอากาศ (แอร์)"
   - "ความสะอาดและสถานที่"
   - "ทั่วไป / คำชม"

ตอบกลับเป็น JSON ภาษาไทย รูปแบบนี้เท่านั้น:
{
  "sentiment": "Positive" | "Neutral" | "Negative",
  "urgency": "Low" | "Medium" | "High" | "Critical",
  "category": "ระบุหมวดหมู่",
  "summary": "สรุปประเด็นหลักสั้นๆ",
  "action_recommendation": "แนวทางการแก้ไขปัญหาที่ตรงจุดและรวดเร็วสำหรับทีมงาน"
}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4500); // ขยาย Timeout เล็กน้อยเพื่อให้ AI ประมวลผลบริบทได้สมบูรณ์

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: promptText }] }] }),
            signal: controller.signal
        });

        if (!response.ok) return getDefaultAnalysis(customerText);

        const data = await response.json();
        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawText) return getDefaultAnalysis(customerText);

        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return getDefaultAnalysis(customerText);

        let parsed = JSON.parse(jsonMatch[0]);
        return applyGuardrail(parsed, customerText);

    } catch (err) {
        console.warn('⚠️ Gemini Timeout/Error -> Switched to Fallback Rule');
        return getDefaultAnalysis(customerText);
    } finally {
        clearTimeout(timeoutId);
    }
}

function getUrgencyBadge(urgency) {
    switch (urgency) {
        case 'Critical': return { text: '🚨 CRITICAL', color: '#dc3545', headerBg: '#dc3545' };
        case 'High': return { text: '🔴 HIGH', color: '#dc3545', headerBg: '#d9534f' };
        case 'Medium': return { text: '🟠 MEDIUM', color: '#f0ad4e', headerBg: '#f0ad4e' };
        case 'Low': return { text: '🟢 LOW', color: '#28a745', headerBg: '#1DB446' };
        default: return { text: '⚪ NORMAL', color: '#6c757d', headerBg: '#6c757d' };
    }
}

async function sendLinePushAlert(customerText, name, phone, formattedDate, analysis) {
    const channelToken = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
    const targetId = process.env.LINE_TARGET_ID?.trim();

    if (!channelToken || !targetId) {
        console.error('❌ Missing LINE API Token or Target ID in environment variables');
        return false;
    }

    const urgencyInfo = getUrgencyBadge(analysis.urgency);
    const customerInfo = `${name || 'ไม่ระบุชื่อ'} (${phone || 'ไม่ระบุเบอร์โทร'})`;
    const ticketId = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 10)}`;

    const flexPayload = {
        type: "flex",
        altText: `📬 Feedback ใหม่: ${analysis.summary}`,
        contents: {
            type: "bubble",
            header: {
                type: "box",
                layout: "vertical",
                contents: [
                    {
                        type: "text",
                        text: `📢 แจ้งเตือน Feedback`,
                        weight: "bold",
                        color: "#ffffff",
                        size: "md"
                    },
                    {
                        type: "text",
                        text: "Cinema • สาขากาฬสินธุ์",
                        color: "#ffffffcc",
                        size: "xs",
                        margin: "xs"
                    }
                ],
                backgroundColor: urgencyInfo.headerBg,
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
                    },
                    {
                        type: "box",
                        layout: "vertical",
                        contents: [
                            { type: "text", text: "🤖 ผลการวิเคราะห์โดย AI", size: "xs", color: "#111111", weight: "bold" },
                            {
                                type: "box",
                                layout: "horizontal",
                                contents: [
                                    { type: "text", text: `Sentiment: ${analysis.sentiment}`, size: "xs", color: "#555555" },
                                    { type: "text", text: urgencyInfo.text, size: "xs", color: urgencyInfo.color, align: "end", weight: "bold" }
                                ],
                                margin: "xs"
                            },
                            { type: "text", text: `🏷 หมวดหมู่: ${analysis.category}`, size: "xs", color: "#555555", margin: "xs" },
                            { type: "text", text: `💡 คำแนะนำ: ${analysis.action_recommendation}`, size: "xs", color: "#555555", wrap: true, margin: "xs" }
                        ],
                        margin: "md"
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
                            data: `action=resolve&ticket_id=${ticketId}&feedback_text=${encodeURIComponent(customerText)}`,
                            displayText: `รับทราบ/ทำการแก้ไข Feedback เรียบร้อยแล้ว`
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

app.post('/api/feedback', async (req, res) => {
    try {
        const { text, name, phone } = req.body;
        if (!text || typeof text !== 'string' || !text.trim()) {
            return res.status(400).json({ error: 'กรุณากรอกข้อความ Feedback ให้ถูกต้อง' });
        }

        const now = new Date();
        const formattedDate = now.toLocaleString('th-TH', {
            timeZone: 'Asia/Bangkok',
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
        }) + ' น.';

        const analysis = await analyzeFeedbackWithAI(text);
        const lineSuccess = await sendLinePushAlert(text, name, phone, formattedDate, analysis);

        return res.json({ 
            success: true, 
            line_sent: lineSuccess,
            analysis: analysis 
        });
    } catch (error) {
        console.error('❌ Error inside /api/feedback:', error.message);
        return res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ' });
    }
});

app.post('/api/webhook', verifyLineSignature, async (req, res) => {
    try {
        const channelToken = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
        const events = req.body.events || [];

        for (const event of events) {
            if (event.type === 'postback') {
                const replyToken = event.replyToken;
                
                let ticketId = null;
                let feedbackText = '';

                try {
                    const postbackData = new URLSearchParams(event.postback.data);
                    ticketId = postbackData.get('ticket_id');
                    feedbackText = postbackData.get('feedback_text') || '';
                } catch (e) {
                    console.error('❌ Error parsing postback data:', e.message);
                }

                if (replyToken && channelToken) {
                    let updateMessage = '';

                    if (ticketId && resolvedTickets.has(ticketId)) {
                        updateMessage = `⚠ [แจ้งเตือน]\nFeedback นี้ได้รับการตรวจสอบ/แก้ไขไปแล้วก่อนหน้านี้ครับ`;
                    } else {
                        if (ticketId) {
                            resolvedTickets.add(ticketId);
                        }
                        const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' });
                        
                        let decodedText = feedbackText;
                        try {
                            decodedText = decodeURIComponent(feedbackText);
                        } catch (e) { /* ignore decode error */ }

                        updateMessage = `✅ [อัปเดตสถานะ]\nFeedback: "${decodedText}"\nได้รับการตรวจสอบ/แก้ไขเรียบร้อยแล้ว เมื่อเวลา ${now} น.`;
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