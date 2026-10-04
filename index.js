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

    const prompt = `คุณคือระบบ AI วิเคราะห์ความคิดเห็นลูกค้าสำหรับธุรกิจร้านค้า/บริการ
กรุณาวิเคราะห์ข้อความ Feedback ต่อไปนี้ แล้วตอบกลับในรูปแบบ JSON เท่านั้น (ไม่ต้องใส่ Markdown block หรือโค้ดอื่น):

ข้อความลูกค้า: "${customerText}"

รูปแบบโครงสร้าง JSON ที่ต้องการ:
{
  "sentiment": "Positive" | "Neutral" | "Negative",
  "urgency": "Low" | "Medium" | "High" | "Critical",
  "category": "การบริการ / อาหารหรือสินค้า / ความสะอาด / ราคา / สถานที่ / อื่นๆ",
  "summary": "สรุปประเด็นสำคัญสั้นๆ ใน 1 ประโยค",
  "action_recommendation": "คำแนะนำการดำเนินการแก้ไขหรือตอบสนองสำหรับผู้จัดการร้าน"
}`;

    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        responseMimeType: 'application/json'
                    }
                })
            }
        );

        const data = await response.json();
        const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (aiText) {
            return JSON.parse(aiText);
        } else {
            console.error('❌ AI Response Format Error:', data);
            return getDefaultAnalysis(customerText);
        }
    } catch (err) {
        console.error('❌ AI Analysis Error:', err);
        return getDefaultAnalysis(customerText);
    }
}

// ค่าเริ่มต้นกรณีเรียก AI ไม่สำเร็จ
function getDefaultAnalysis(text) {
    return {
        sentiment: 'Neutral',
        urgency: 'Medium',
        category: 'ทั่วไป',
        summary: text,
        action_recommendation: 'ตรวจสอบข้อความและพิจารณาดำเนินการตามความเหมาะสม'
    };
}

// ฟังก์ชันแปลงระดับความเร่งด่วนเป็น Emoji
function getUrgencyEmoji(urgency) {
    switch (urgency) {
        case 'Critical': return '🚨🚨 *CRITICAL*';
        case 'High': return '🔴 *HIGH*';
        case 'Medium': return '🟠 *MEDIUM*';
        case 'Low': return '🟢 *LOW*';
        default: return '⚪ *NORMAL*';
    }
}

// ฟังก์ชันส่งแจ้งเตือนเข้า Telegram
async function sendTelegramAlert(customerText, formattedDate, analysis) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    const urgencyTag = getUrgencyEmoji(analysis.urgency);

    const message = `📥 *แจ้งเตือน Feedback ใหม่จากลูกค้า!*

📌 *ข้อความที่ได้รับ:* 
"${customerText}"

🤖 *ผลการวิเคราะห์โดย AI:*
• *ความรู้สึก:* ${analysis.sentiment}
• *ระดับความเร่งด่วน:* ${urgencyTag}
• *หมวดหมู่:* ${analysis.category}
• *สรุปประเด็น:* ${analysis.summary}
💡 *คำแนะนำการดำเนินการ:* ${analysis.action_recommendation}

📅 *วันที่และเวลา:* ${formattedDate}
📍 *สถานที่:* สาขากาฬสินธุ์`;

    try {
        const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: message,
                parse_mode: 'Markdown'
            })
        });

        const data = await response.json();
        if (!data.ok) {
            console.error('❌ Telegram Error:', data);
        }
    } catch (err) {
        console.error('❌ Fetch Error:', err);
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

        // 1. ส่งให้ AI วิเคราะห์ปัญหาก่อน
        const analysis = await analyzeFeedbackWithAI(text);

        // 2. ส่งข้อมูลแจ้งเตือน Telegram พร้อมผลวิเคราะห์ AI
        await sendTelegramAlert(text, formattedDate, analysis);

        // 3. ตอบกลับ API Response
        res.json({
            success: true,
            analysis: analysis
        });

    } catch (error) {
        console.error('API Error Details:', error);
        res.status(500).json({ error: `เกิดข้อผิดพลาด: ${error.message}` });
    }
});

export default app;