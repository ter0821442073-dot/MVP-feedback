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

    const prompt = `คุณคือผู้เชี่ยวชาญด้านการวิเคราะห์ความพึงพอใจของลูกค้าและการบริหารจัดการบริการ (Customer Service AI)

หน้าที่ของคุณคือวิเคราะห์ข้อความ Feedback ต่อไปนี้ แล้วประเมินผลอย่างแม่นยำตามหลักเกณฑ์ที่กำหนด:

ข้อความจากลูกค้า: "${customerText}"

---
เกณฑ์การประเมิน:
1. sentiment:
   - "Negative": คำติ ข้อร้องเรียน ปัญหา ความไม่พอใจ เช่น ร้อน, แอร์ไม่เย็น, รอนาน, อาหารเสีย, พนักงานพูดจาไม่ดี
   - "Positive": คำชม เรื่องดีๆ ประทับใจในการบริการ/สินค้า
   - "Neutral": คำถามทั่วไป ข้อเสนอแนะกลางๆ ที่ไม่มีอารมณ์บวกหรือลบ

2. urgency:
   - "Critical": ปัญหาร้ายแรงฉุกเฉินที่กระทบความสบายหรือประสบการณ์ของลูกค้าอย่างมาก เช่น ร้อนมาก, แอร์เสีย/แอร์ไม่เย็น, สิ่งสกปรก, อาหารมีสิ่งแปลกปลอม, อันตราย
   - "High": ปัญหาส่งผลกระทบต่อความพึงพอใจสูง เช่น รอนานมาก, พนักงานแสดงกิริยาไม่ดี, สินค้าผิดพลาด
   - "Medium": ข้อร้องเรียนเล็กน้อย หรือปัญหาที่ปรับปรุงได้ทั่วไป
   - "Low": คำชมเชย ข้อเสนอแนะทั่วไปที่ไม่รีบด่วน

3. category: ระบุหมวดหมู่ เช่น "สภาพแวดล้อม/สถานที่", "การบริการของพนักงาน", "คุณภาพสินค้า/อาหาร", "ระยะเวลาการรอ", "อื่นๆ"
4. summary: สรุปปัญหา/คำชมสั้นๆ ใน 1 ประโยค
5. action_recommendation: คำแนะนำการดำเนินการแก้ไขหรือรับมือสำหรับผู้จัดการร้าน

---
ตัวอย่างการวิเคราะห์:
- ถ้าลูกค้าบอก: "โรง 1 แอร์ไม่เย็นเลยครับ" หรือ "ในโรงร้อนมาก"
  ตอบ JSON: {"sentiment": "Negative", "urgency": "Critical", "category": "สภาพแวดล้อม/สถานที่", "summary": "ลูกค้าแจ้งปัญหาแอร์ไม่เย็น/อากาศร้อนในโรง 1", "action_recommendation": "ส่งช่างภาพ/เจ้าหน้าที่ตรวจสอบและปรับอุณหภูมิแอร์ในโรง 1 ทันที"}

- ถ้าลูกค้าบอก: "พนักงานบริการดีมากครับ"
  ตอบ JSON: {"sentiment": "Positive", "urgency": "Low", "category": "การบริการของพนักงาน", "summary": "ลูกค้าชื่นชมการบริการของพนักงาน", "action_recommendation": "ส่งต่อคำชมให้พนักงานเพื่อเป็นกำลังใจในการทำงาน"}

---
คำสั่ง: กรุณาตอบกลับเป็นรูปแบบ JSON ภาษาไทยเท่านั้น ไม่ต้องใส่ข้อความเกริ่นหรือ Markdown ใดๆ:
{
  "sentiment": "Positive" | "Neutral" | "Negative",
  "urgency": "Low" | "Medium" | "High" | "Critical",
  "category": "string",
  "summary": "string",
  "action_recommendation": "string"
}`;

    try {
        // เปลี่ยนชื่อโมเดลเป็น gemini-3.8-flash เพื่อความถูกต้องและเสถียร
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

// ค่าเริ่มต้นกรณีเรียก AI ไม่สำเร็จ (ป้องกัน Error 500)
function getDefaultAnalysis(text) {
    // ปรับ fallback ให้วิเคราะห์คำว่า "ร้อน" หรือ "แอร์" เบื้องต้นไว้ก่อนเผื่อ API ล่ม
    const isHotOrAC = text.includes('ร้อน') || text.includes('แอร์');
    return {
        sentiment: isHotOrAC ? 'Negative' : 'Neutral',
        urgency: isHotOrAC ? 'Critical' : 'Medium',
        category: isHotOrAC ? 'สภาพแวดล้อม/สถานที่' : 'ทั่วไป',
        summary: text,
        action_recommendation: isHotOrAC 
            ? 'ตรวจสอบระบบเครื่องปรับอากาศในพื้นที่โดยด่วน' 
            : 'ตรวจสอบข้อความและพิจารณาดำเนินการตามความเหมาะสม'
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

    if (!token || !chatId) {
        console.warn('⚠️ ไม่พบ TELEGRAM_BOT_TOKEN หรือ TELEGRAM_CHAT_ID');
        return;
    }

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

        // 1. วิเคราะห์ด้วย AI (พร้อมระบบป้องกันข้อผิดพลาด)
        const analysis = await analyzeFeedbackWithAI(text);

        // 2. ส่งเข้า Telegram (ไม่ขัดจังหวะการตอบกลับถ้าส่งไม่ผ่าน)
        sendTelegramAlert(text, formattedDate, analysis).catch(err => 
            console.error('Telegram background alert error:', err)
        );

        // 3. ส่งข้อมูลกลับไปยังหน้าเว็บ Frontend
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