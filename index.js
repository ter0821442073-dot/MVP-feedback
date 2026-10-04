import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

/**
 * 1. ฟังก์ชัน Guardrail ขั้นสูงสุด (Post-Processing Guardrail v5.1)
 * ตรวจสอบกริยาเชิงลบของพนักงาน เช่น ตะคอก, ด่า, ตะโกน, ชักสีหน้า
 */
function applyGuardrail(analysis, text) {
    const textLower = text.toLowerCase();

    // รายการคำชมเชยชัดเจน
    const positiveKeywords = ['ดีมาก', 'ดีเยี่ยม', 'ประทับใจ', 'ชมเชย', 'สุดยอด', 'น่ารัก', 'ยิ้มแย้ม', 'พูดจาดี', 'สะอาดมาก', 'หอม', 'อร่อย', 'บริการดี'];
    
    // รายการคำร้องเรียน / กริยาเชิงลบ (รวม "ตะคอก", "ด่า", "ตะโกน", "ขึ้นเสียง")
    const negativeKeywords = [
        'ตะคอก', 'ตะโกน', 'ด่า', 'ขึ้นเสียง', 'หน้าบึ้ง', 'ชักสีหน้า', 'ไม่ยิ้ม', 'พูดจาแย่', 'พูดจาหยาบคาย', 
        'มารยาทแย่', 'มารยาทไม่ดี', 'บริการแย่', 'บริการห่วย', 'ไม่ดี', 'แย่', 'ห่วย', 'ช้า', 'พัง', 'เสีย', 
        'เหม็น', 'สกปรก', 'หนาว', 'ร้อน', 'อบอ้าว', 'ไม่กรอบ', 'เหนียว', 'เค็ม', 'กระตุก', 'ดับ', 'ไม่ฉาย'
    ];

    const hasPositive = positiveKeywords.some(k => textLower.includes(k));
    const hasNegative = negativeKeywords.some(k => textLower.includes(k));

    // กฎที่ 1: ตรวจพบกริยาเชิงลบของพนักงาน (เช่น ตะคอก, ด่า, ชักสีหน้า) -> บังคับ Negative + High + ตักเตือน
    const isStaffIssue = ['พนักงาน', 'บริการ', 'ตะคอก', 'ตะโกน', 'ด่า', 'ขึ้นเสียง', 'หน้าบึ้ง', 'ชักสีหน้า', 'ไม่ยิ้ม', 'พูดจาหยาบคาย', 'มารยาท'].some(k => textLower.includes(k));
    if (isStaffIssue && hasNegative) {
        analysis.sentiment = 'Negative';
        analysis.urgency = 'High';
        analysis.category = 'พนักงานและการบริการ';
        analysis.action_recommendation = 'ประสานงานผู้จัดการสาขาตรวจสอบและดำเนินการตักเตือน/ปรับปรุงพฤติกรรมการให้บริการของพนักงานด่วน';
        return analysis;
    }

    // กฎที่ 2: มีแต่คำชมเชย -> บังคับ Positive + Low
    if (hasPositive && !hasNegative) {
        analysis.sentiment = 'Positive';
        analysis.urgency = 'Low';

        if (isStaffIssue) {
            analysis.category = 'พนักงานและการบริการ';
            analysis.action_recommendation = 'ส่งคำชมเชยไปยังพนักงานและผู้จัดการสาขาเพื่อเป็นกำลังใจในการทำงาน';
        } else if (['ป๊อปคอร์น', 'อาหาร', 'อร่อย', 'ขนม'].some(k => textLower.includes(k))) {
            analysis.category = 'อาหารและเครื่องดื่ม';
            analysis.action_recommendation = 'ชื่นชมทีมเคาน์เตอร์อาหารและรักษาคุณภาพสินค้าต่อไป';
        } else {
            analysis.action_recommendation = 'ขอบคุณสำหรับคำชมเชย และจะรักษามาตรฐานการบริการที่ดีต่อไป';
        }
        return analysis;
    }

    // กฎที่ 3: หนังไม่ฉาย / จอดำ / ไฟดับ -> บังคับ Critical + Negative
    if (['หนังไม่ฉาย', 'ไม่ฉาย', 'จอดำ', 'ไม่มีเสียง', 'ไฟดับ'].some(k => textLower.includes(k))) {
        analysis.sentiment = 'Negative';
        analysis.urgency = 'Critical';
        analysis.category = 'ระบบฉายและเสียง';
        analysis.action_recommendation = '🚨 แจ้งช่างเทคนิคและผู้จัดการโรงภาพยนตร์เข้าตรวจสอบห้องควบคุมการฉาย (Projection Room) ทันที!';
        return analysis;
    }

    // กฎที่ 4: แอร์หนาว / ร้อน -> บังคับ ระบบปรับอากาศ
    if (['แอร์', 'หนาว', 'ร้อน', 'อบอ้าว'].some(k => textLower.includes(k)) && !textLower.includes('เสียง')) {
        analysis.category = 'ระบบปรับอากาศ (แอร์)';
        if (hasNegative || ['หนาว', 'ร้อน', 'อบอ้าว'].some(k => textLower.includes(k))) {
            analysis.sentiment = 'Negative';
            analysis.urgency = 'Critical';
            analysis.action_recommendation = 'ประสานงานช่างอาคารเข้าตรวจสอบและปรับอุณหภูมิเครื่องปรับอากาศด่วน';
        }
        return analysis;
    }

    // กฎที่ 5: ห้องน้ำ / ความสะอาด -> บังคับ ความสะอาดและสถานที่
    if (['ห้องน้ำ', 'เหม็น', 'สกปรก', 'ขยะ'].some(k => textLower.includes(k))) {
        analysis.category = 'ความสะอาดและสถานที่';
        if (hasNegative || ['เหม็น', 'สกปรก'].some(k => textLower.includes(k))) {
            analysis.sentiment = 'Negative';
            analysis.urgency = 'High';
            analysis.action_recommendation = 'แจ้งแม่บ้าน/ทีมทำความสะอาดเข้าตรวจสอบและจัดการความสะอาดทันที';
        }
        return analysis;
    }

    return analysis;
}

/**
 * 2. ระบบจำแนกสำรอง (Fallback Algorithm)
 */
function getDefaultAnalysis(text) {
    const textLower = text.toLowerCase();

    const isPositive = ['ดีมาก', 'ดีเยี่ยม', 'ประทับใจ', 'ชมเชย', 'สุดยอด', 'สะอาด', 'หอม', 'กรอบ', 'พูดจาดี', 'ยิ้มแย้ม', 'น่ารัก'].some(k => textLower.includes(k));
    const isNegative = ['ตะคอก', 'ตะโกน', 'ด่า', 'ขึ้นเสียง', 'หน้าบึ้ง', 'ชักสีหน้า', 'ไม่ยิ้ม', 'ไม่ดี', 'แย่', 'ห่วย', 'ช้า', 'พัง', 'เสีย', 'เหม็น', 'สกปรก', 'หนาว', 'ร้อน', 'อบอ้าว', 'ไม่กรอบ', 'เหนียว', 'เค็ม', 'กระตุก', 'ดับ', 'ไม่ฉาย'].some(k => textLower.includes(k));

    let category = 'ทั่วไป / คำชม';
    let action = 'ขอบคุณสำหรับข้อเสนอแนะ และจะนำไปพัฒนาปรับปรุงการให้บริการต่อไป';

    if (['พนักงาน', 'บริการ', 'ตะคอก', 'ด่า', 'ขึ้นเสียง'].some(k => textLower.includes(k))) {
        category = 'พนักงานและการบริการ';
    } else if (['ห้องน้ำ', 'เหม็น', 'สกปรก', 'ขยะ'].some(k => textLower.includes(k))) {
        category = 'ความสะอาดและสถานที่';
    } else if (['แอร์', 'หนาว', 'ร้อน', 'อบอ้าว'].some(k => textLower.includes(k))) {
        category = 'ระบบปรับอากาศ (แอร์)';
    } else if (['ป๊อปคอร์น', 'ป็อบคอร์น', 'น้ำอัดลม', 'ขนม', 'อาหาร'].some(k => textLower.includes(k))) {
        category = 'อาหารและเครื่องดื่ม';
    } else if (['หนัง', 'เสียง', 'ภาพ', 'จอ', 'ซับ', 'ลำโพง', 'ฉาย'].some(k => textLower.includes(k))) {
        category = 'ระบบฉายและเสียง';
    }

    let result = {
        sentiment: isPositive && !isNegative ? 'Positive' : isNegative ? 'Negative' : 'Neutral',
        urgency: isNegative ? 'High' : 'Low',
        category: category,
        summary: text,
        action_recommendation: action
    };

    return applyGuardrail(result, text);
}

/**
 * 3. ฟังก์ชันเรียก AI วิเคราะห์ความคิดเห็น
 */
async function analyzeFeedbackWithAI(customerText) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return getDefaultAnalysis(customerText);
    }

    const promptText = `คุณคือ AI วิเคราะห์ความคิดเห็นลูกค้าสำหรับโรงภาพยนตร์
วิเคราะห์ข้อความนี้: "${customerText}"

[กฎเหล็กกริยาพนักงาน]:
- หากมีคำว่า "ตะคอก", "ด่า", "ตะโกน", "ขึ้นเสียงใส่", "ชักสีหน้า", "หน้าบึ้ง", "พูดจาไม่ดี" -> บังคับ sentiment: "Negative", urgency: "High", category: "พนักงานและการบริการ" เท่านั้น!

[หมวดหมู่ (category)]:
- "พนักงานและการบริการ": เรื่องพนักงาน, การบริการ, คำชมพนักงาน, ตะคอก, ขึ้นเสียง, ชักสีหน้า
- "ระบบปรับอากาศ (แอร์)": เรื่องแอร์, หนาว, ร้อน, อบอ้าว
- "ความสะอาดและสถานที่": เรื่องห้องน้ำ, กลิ่นเหม็น, สกปรก, ขยะ
- "อาหารและเครื่องดื่ม": เรื่องป๊อปคอร์น, น้ำ, ขนม, ไม่กรอบ, อร่อย
- "ระบบฉายและเสียง": เรื่องหนังไม่ฉาย, จอดำ, ภาพเบลอ, เสียงเบา/ดัง, ลำโพง
- "ระบบตั๋วและแอปพลิเคชัน": เรื่องจองตั๋ว, แอป, ตู้สแกน
- "ทั่วไป / คำชม": ข้อเสนอแนะทั่วไป

ตอบเป็น JSON ภาษาไทย รูปแบบนี้เท่านั้น:
{
  "sentiment": "Positive" | "Neutral" | "Negative",
  "urgency": "Low" | "Medium" | "High" | "Critical",
  "category": "ระบุหมวดหมู่",
  "summary": "สรุปสั้นๆ",
  "action_recommendation": "คำแนะนำทีมงาน"
}`;

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: promptText }] }] })
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
        return getDefaultAnalysis(customerText);
    }
}

function getUrgencyText(urgency) {
    switch (urgency) {
        case 'Critical': return '🚨🚨 CRITICAL (ด่วนที่สุด)';
        case 'High': return '🔴 HIGH (ด่วนมาก)';
        case 'Medium': return '🟠 MEDIUM (ปานกลาง)';
        case 'Low': return '🟢 LOW (ทั่วไป)';
        default: return '⚪ NORMAL';
    }
}

/**
 * 4. ฟังก์ชันส่ง LINE Alert
 */
async function sendLinePushAlert(customerText, name, phone, formattedDate, analysis) {
    const channelToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const targetId = process.env.LINE_TARGET_ID;

    if (!channelToken || !targetId) return;

    const urgencyTag = getUrgencyText(analysis.urgency);
    const customerInfo = `${name || 'ไม่ระบุชื่อ'} (${phone || 'ไม่ระบุเบอร์โทร'})`;

    const messageText = `📥 แจ้งเตือน Feedback ใหม่! (Cinema v5.1)

👤 ผู้ส่งข้อมูล: ${customerInfo}

📌 ข้อความที่ได้รับ:
"${customerText}"

🤖 ผลการวิเคราะห์โดย AI:
• ความรู้สึก: ${analysis.sentiment}
• ระดับความเร่งด่วน: ${urgencyTag}
• หมวดหมู่: ${analysis.category}
• สรุปประเด็น: ${analysis.summary}
💡 คำแนะนำ: ${analysis.action_recommendation}

📅 วันที่และเวลา: ${formattedDate}
📍 สถานที่: สาขากาฬสินธุ์`;

    try {
        await fetch('https://api.line.me/v2/bot/message/push', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${channelToken.trim()}`
            },
            body: JSON.stringify({
                to: targetId.trim(),
                messages: [{ type: 'text', text: messageText }]
            })
        });
    } catch (err) {
        console.error('❌ LINE Alert Error:', err.message);
    }
}

// Endpoint รับข้อมูล Feedback
app.post('/api/feedback', async (req, res) => {
    try {
        const { text, name, phone } = req.body;
        if (!text) return res.status(400).json({ error: 'กรุณากรอกข้อความ Feedback' });

        const now = new Date();
        const formattedDate = now.toLocaleString('th-TH', {
            timeZone: 'Asia/Bangkok',
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
        }) + ' น.';

        const analysis = await analyzeFeedbackWithAI(text);
        await sendLinePushAlert(text, name, phone, formattedDate, analysis);

        return res.json({ success: true, analysis: analysis });
    } catch (error) {
        return res.status(500).json({ error: `เกิดข้อผิดพลาด: ${error.message}` });
    }
});

// Endpoint สำหรับ Webhook LINE
app.post('/api/webhook', async (req, res) => {
    try {
        const events = req.body.events || [];
        for (const event of events) {
            if (event.type === 'message' && event.message.type === 'text') {
                const groupId = event.source.groupId;
                const replyToken = event.replyToken;
                if (groupId && replyToken) {
                    await fetch('https://api.line.me/v2/bot/message/reply', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
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
        return res.status(200).send('OK');
    }
});

export default app;