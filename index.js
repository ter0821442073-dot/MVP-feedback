import express from 'express';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();

const app = express();
app.use(express.json());

// ค่าเริ่มต้นกรณี AI ล้มเหลว (Fallback)
function getDefaultAnalysis(text) {
    const textLower = text.toLowerCase();
    const isCritical = ['ร้อน', 'แอร์', 'อบอ้าว', 'พัง', 'เสีย', 'เหม็น', 'ช้ามาก', 'ห่วย'].some(k => textLower.includes(k));

    return {
        sentiment: isCritical ? 'Negative' : 'Neutral',
        urgency: isCritical ? 'Critical' : 'Medium',
        category: isCritical ? 'สภาพแวดล้อม/สถานที่' : 'ทั่วไป',
        summary: text,
        action_recommendation: isCritical 
            ? 'ส่งทีมช่าง/เจ้าหน้าที่เข้าตรวจสอบสภาพแวดล้อมและระบบเครื่องปรับอากาศด่วนที่สุด' 
            : 'ตรวจสอบข้อความและพิจารณาดำเนินการตามความเหมาะสม'
    };
}

/**
 * ฟังก์ชันเรียก AI วิเคราะห์แบบ Safe Wrapper (ไม่มีทางทำให้ Server Crash)
 */
async function analyzeFeedbackWithAI(customerText) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.warn('⚠️️ GEMINI_API_KEY ไม่ได้ถูกตั้งค่า');
        return getDefaultAnalysis(customerText);
    }

    const promptText = `คุณคือ AI วิเคราะห์ความคิดเห็นลูกค้า
กรุณาวิเคราะห์ข้อความนี้: "${customerText}"

เงื่อนไข:
- บ่นเรื่อง ร้อน, แอร์ไม่เย็น, กลิ่นเหม็น, อาหารเสีย -> sentiment: "Negative", urgency: "Critical"
- คำชม -> sentiment: "Positive", urgency: "Low"

ตอบเป็น JSON โครงสร้างนี้เท่านั้น:
{
  "sentiment": "Positive" | "Neutral" | "Negative",
  "urgency": "Low" | "Medium" | "High" | "Critical",
  "category": "หมวดหมู่",
  "summary": "สรุป 1 ประโยค",
  "action_recommendation": "คำแนะนำ"
}`;

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`;

        // ตั้ง Timeout ไว้ 5 วินาที ถ้า AI ตอบช้า ให้ตัดไปใช้ Fallback ทันที
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
                contents: [{ parts: [{ text: promptText }] }]
            })
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            console.error('❌ AI Status Error:', response.status);
            return getDefaultAnalysis(customerText);
        }

        const data = await response.json();
        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!rawText) return getDefaultAnalysis(customerText);

        // ดึงเฉพาะส่วนที่เป็น JSON ออกมาจาก Response
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }

        return getDefaultAnalysis(customerText);

    } catch (err) {
        console.error('❌ AI Analysis Failed/Timeout:', err.message);
        return getDefaultAnalysis(customerText);
    }
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

// ฟังก์ชันส่ง Telegram (ใช้ระบบ Plain Text แบบของคุณที่รันผ่านปกติ)
async function sendTelegramAlert(customerText, formattedDate, analysis) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!token || !chatId) {
        console.error('❌ Missing Telegram ENV');
        return;
    }

    const urgencyTag = getUrgencyText(analysis.urgency);

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
            })
        });

        const data = await response.json();
        if (!data.ok) {
            console.error('❌ Telegram Send Failed:', data);
        } else {
            console.log('✅ Telegram Sent Successfully!');
        }
    } catch (err) {
        console.error('❌ Telegram Network Error:', err);
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

        // 1. วิเคราะห์ด้วย AI (มี Timeout 5 วินาที ถ้า AI พัง/ตอบช้า จะดึงค่า Fallback ทันที)
        const analysis = await analyzeFeedbackWithAI(text);

        // 2. ส่ง Telegram ทันที
        await sendTelegramAlert(text, formattedDate, analysis);

        // 3. ส่งข้อมูลกลับหน้าเว็บ
        return res.json({
            success: true,
            analysis: analysis
        });

    } catch (error) {
        console.error('❌ Server Error:', error);
        return res.status(500).json({ error: `เกิดข้อผิดพลาด: ${error.message}` });
    }
});

export default app;