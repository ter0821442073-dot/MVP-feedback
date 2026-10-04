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

    const systemInstruction = `คุณคือระบบ AI ประเมินวิเคราะห์ Feedback ของลูกค้าสำหรับโรงภาพยนตร์/สถานที่บริการ 
กฎเหล็กในการวิเคราะห์:
1. หากลูกค้าบ่นเรื่อง "ความร้อน", "แอร์ไม่เย็น", "กลิ่นเหม็น", "สิ่งสกปรก", "อาหารเสีย", "อุปกรณ์พัง/เสีย" ต้องประเมินเป็น:
   - sentiment: "Negative"
   - urgency: "Critical"
2. หากลูกค้าชมเรื่องบริการ พนักงาน หรือสิ่งอำนวยความสะดวก:
   - sentiment: "Positive"
   - urgency: "Low"
3. ต้องตอบกลับเฉพาะรูปแบบ JSON ภาษาไทยตรงตามโครงสร้างที่กำหนดเท่านั้น ห้ามมีข้อความอื่น`;

    const prompt = `วิเคราะห์ข้อความนี้: "${customerText}"

ส่งคืนค่าในรูปแบบ JSON ดังนี้:
{
  "sentiment": "Positive" | "Neutral" | "Negative",
  "urgency": "Low" | "Medium" | "High" | "Critical",
  "category": "หมวดหมู่ปัญหาหรือคำชม",
  "summary": "สรุปประเด็นสั้นๆ ใน 1 ประโยค",
  "action_recommendation": "ข้อเสนอแนะการดำเนินการแก้ไขสำหรับผู้จัดการ"
}`;

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                systemInstruction: {
                    parts: [{ text: systemInstruction }]
                },
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    responseMimeType: 'application/json'
                }
            })
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('❌ Gemini API Response Error:', data);
            return getDefaultAnalysis(customerText);
        }

        const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (aiText) {
            const cleanJsonText = aiText.replace(/```json/g, '').replace(/```/g, '').trim();
            return JSON.parse(cleanJsonText);
        } else {
            console.error('❌ AI Response Format Error:', JSON.stringify(data));
            return getDefaultAnalysis(customerText);
        }
    } catch (err) {
        console.error('❌ AI Analysis Error:', err);
        return getDefaultAnalysis(customerText);
    }
}

// ค่าเริ่มต้นกรณีเรียก AI ไม่สำเร็จ
function getDefaultAnalysis(text) {
    const textLower = text.toLowerCase();
    const isCriticalIssue = ['ร้อน', 'แอร์', 'อบอ้าว', 'พัง', 'เสีย', 'เหม็น', 'ช้ามาก', 'ห่วย'].some(keyword => textLower.includes(keyword));

    if (isCriticalIssue) {
        return {
            sentiment: 'Negative',
            urgency: 'Critical',
            category: 'สภาพแวดล้อม/สถานที่',
            summary: text,
            action_recommendation: 'ส่งทีมช่าง/เจ้าหน้าที่เข้าตรวจสอบสภาพแวดล้อมและระบบเครื่องปรับอากาศในพื้นที่ทันที'
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

// ฟังก์ชันแปลงระดับความเร่งด่วนเป็น Emoji
function getUrgencyEmoji(urgency) {
    switch (urgency) {
        case 'Critical': return '🚨🚨 CRITICAL (ด่วนที่สุด)';
        case 'High': return '🔴 HIGH (ด่วนมาก)';
        case 'Medium': return '🟠 MEDIUM (ปานกลาง)';
        case 'Low': return '🟢 LOW (ทั่วไป)';
        default: return '⚪ NORMAL';
    }
}

// ฟังก์ชันส่งแจ้งเตือนเข้า Telegram (ปรับให้รองรับ Plain Text หรือ HTML ป้องกัน Syntax Error)
async function sendTelegramAlert(customerText, formattedDate, analysis) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!token || !chatId) {
        console.warn('⚠️ ไม่พบ TELEGRAM_BOT_TOKEN หรือ TELEGRAM_CHAT_ID ในระบบ');
        return;
    }

    const urgencyTag = getUrgencyEmoji(analysis.urgency);

    const message = `📥 <b>แจ้งเตือน Feedback ใหม่จากลูกค้า!</b>

📌 <b>ข้อความที่ได้รับ:</b> 
"${customerText}"

🤖 <b>ผลการวิเคราะห์โดย AI:</b>
• <b>ความรู้สึก:</b> ${analysis.sentiment}
• <b>ระดับความเร่งด่วน:</b> ${urgencyTag}
• <b>หมวดหมู่:</b> ${analysis.category}
• <b>สรุปประเด็น:</b> ${analysis.summary}
💡 <b>คำแนะนำการดำเนินการ:</b> ${analysis.action_recommendation}

📅 <b>วันที่และเวลา:</b> ${formattedDate}
📍 <b>สถานที่:</b> สาขากาฬสินธุ์`;

    try {
        const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: message,
                parse_mode: 'HTML' // เปลี่ยนเป็น HTML ป้องกัน Markdown parse error
            })
        });

        const data = await response.json();
        if (!data.ok) {
            console.error('❌ Telegram API Error:', data);
        } else {
            console.log('✅ ส่งแจ้งเตือนไปยัง Telegram เรียบร้อยแล้ว');
        }
    } catch (err) {
        console.error('❌ Fetch Error Telegram:', err);
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

        // 2. เรียกส่ง Telegram แบบ Asynchronous (ไม่ต้อง await เพื่อไม่ให้ตัวเว็บรอนาน)
        sendTelegramAlert(text, formattedDate, analysis).catch(err => 
            console.error('❌ Telegram Async Error:', err)
        );

        // 3. ส่งข้อมูลตอบกลับไปยัง Frontend ทันที
        return res.json({
            success: true,
            analysis: analysis
        });

    } catch (error) {
        console.error('API Error Details:', error);
        return res.status(500).json({ error: `เกิดข้อผิดพลาด: ${error.message}` });
    }
});

export default app;