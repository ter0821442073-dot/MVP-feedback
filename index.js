import express from 'express';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();

const app = express();
app.use(express.json());

/**
 * ฟังก์ชันเรียก AI วิเคราะห์และประเมินสถานการณ์จาก Feedback
 */
async function analyzeFeedbackWithAI(customerText) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.warn('⚠️ GEMINI_API_KEY ไม่ได้ถูกตั้งค่า ใช้ผลวิเคราะห์เริ่มต้นแทน');
        return getDefaultAnalysis(customerText);
    }

    const prompt = `คุณคือระบบ AI วิเคราะห์ความพึงพอใจลูกค้า ให้วิเคราะห์ข้อความด้านล่างแล้วตอบกลับเป็น JSON ภาษาไทยเท่านั้น:

ข้อความลูกค้า: "${customerText}"

กฎการวิเคราะห์:
- ถ้าบ่นเรื่อง ความร้อน, แอร์ไม่เย็น, กลิ่นเหม็น, อาหารเสีย, สิ่งสกปรก ให้ sentiment = "Negative" และ urgency = "Critical"
- ถ้าชมพนักงาน หรือบริการ ให้ sentiment = "Positive" และ urgency = "Low"

รูปแบบ JSON ที่ต้องการ:
{
  "sentiment": "Positive" | "Neutral" | "Negative",
  "urgency": "Low" | "Medium" | "High" | "Critical",
  "category": "หมวดหมู่ปัญหา",
  "summary": "สรุปประเด็นสั้นๆ 1 ประโยค",
  "action_recommendation": "คำแนะนำสำหรับผู้จัดการร้าน"
}`;

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    responseMimeType: 'application/json'
                }
            })
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('❌ Gemini API Error Status:', response.status, data);
            return getDefaultAnalysis(customerText);
        }

        const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (aiText) {
            const cleanJsonText = aiText.replace(/```json/g, '').replace(/```/g, '').trim();
            return JSON.parse(cleanJsonText);
        } else {
            console.error('❌ Gemini Empty Response:', data);
            return getDefaultAnalysis(customerText);
        }
    } catch (err) {
        console.error('❌ AI Analysis Exception:', err.message);
        return getDefaultAnalysis(customerText);
    }
}

// ค่าเริ่มต้นกรณีเรียก AI ไม่สำเร็จ
function getDefaultAnalysis(text) {
    const textLower = text.toLowerCase();
    const isCritical = ['ร้อน', 'แอร์', 'อบอ้าว', 'พัง', 'เสีย', 'เหม็น', 'ช้ามาก', 'ห่วย'].some(k => textLower.includes(k));

    if (isCritical) {
        return {
            sentiment: 'Negative',
            urgency: 'Critical',
            category: 'สภาพแวดล้อม/สถานที่',
            summary: text,
            action_recommendation: 'ส่งทีมช่าง/เจ้าหน้าที่เข้าตรวจสอบสภาพแวดล้อมและระบบเครื่องปรับอากาศด่วนที่สุด'
        };
    }

    return {
        sentiment: 'Neutral',
        urgency: 'Medium',
        category: 'ข้อเสนอแนะทั่วไป',
        summary: text,
        action_recommendation: 'ตรวจสอบข้อความและพิจารณาดำเนินการตามความเหมาะสม'
    };
}

// แปลงระดับความเร่งด่วน
function getUrgencyText(urgency) {
    switch (urgency) {
        case 'Critical': return '🚨🚨 CRITICAL (ด่วนที่สุด)';
        case 'High': return '🔴 HIGH (ด่วนมาก)';
        case 'Medium': return '🟠 MEDIUM (ปานกลาง)';
        case 'Low': return '🟢 LOW (ทั่วไป)';
        default: return '⚪ NORMAL';
    }
}

// ฟังก์ชันส่งแจ้งเตือนเข้า Telegram (แบบ Plain Text 100% ป้องกัน Parse Error)
async function sendTelegramAlert(customerText, formattedDate, analysis) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!token || !chatId) {
        console.error('❌ [Telegram Config Error] ไม่พบ TELEGRAM_BOT_TOKEN หรือ TELEGRAM_CHAT_ID ใน process.env');
        return;
    }

    const urgencyTag = getUrgencyText(analysis.urgency);

    // ใช้ Plain Text ป้องกันตัวอักษรพิเศษทำลาย Markdown/HTML syntax
    const message = `📥 แจ้งเตือน Feedback ใหม่จากลูกค้า!

📌 ข้อความที่ได้รับ:
"${customerText}"

🤖 ผลการวิเคราะห์โดย AI:
• ความรู้สึก: ${analysis.sentiment}
• ระดับความเร่งด่วน: ${urgencyTag}
• หมวดหมู่: ${analysis.category}
• สรุปประเด็น: ${analysis.summary}
💡 คำแนะนำการดำเนินการ: ${analysis.action_recommendation}

📅 วันที่และเวลา: ${formattedDate}
📍 สถานที่: สาขากาฬสินธุ์`;

    try {
        const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: message
                // ตัด parse_mode ออกชั่วคราวเพื่อให้มั่นใจว่าส่งผ่านแน่นอน 100%
            })
        });

        const data = await response.json();
        
        if (!data.ok) {
            console.error('❌ [Telegram API Rejected]:', data);
        } else {
            console.log('✅ [Telegram Sent Success]: ข้อความถูกส่งสำเร็จ!');
        }
    } catch (err) {
        console.error('❌ [Telegram Fetch Network Error]:', err);
    }
}

// Endpoint รับข้อความหน้าร้าน
app.post('/api/feedback', async (req, res) => {
    try {
        const { text } = req.body;

        if (!text) {
            return res.status(400).json({ error: 'กรุณากรอกข้อความ Feedback' });
        }

        const now = new Date();
        const formattedDate = now.toLocaleString('th-TH', {
            timeZone: 'Asia/Bangkok',
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        }) + ' น.';

        // 1. วิเคราะห์ด้วย AI
        const analysis = await analyzeFeedbackWithAI(text);

        // 2. ส่ง Telegram (ใช้ await เพื่อบังคับให้รอส่งจบก่อนตอบกลับ client)
        await sendTelegramAlert(text, formattedDate, analysis);

        // 3. ตอบกลับหน้าเว็บ
        return res.json({
            success: true,
            analysis: analysis
        });

    } catch (error) {
        console.error('❌ Server API Error:', error);
        return res.status(500).json({ error: `เกิดข้อผิดพลาด: ${error.message}` });
    }
});

export default app;