import express from 'express';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();

const app = express();
app.use(express.json());

// ค่าเริ่มต้นกรณี AI ล้มเหลว
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

// ฟังก์ชันเรียก AI วิเคราะห์
async function analyzeFeedbackWithAI(customerText) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return getDefaultAnalysis(customerText);

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
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({ contents: [{ parts: [{ text: promptText }] }] })
        });

        clearTimeout(timeoutId);
        if (!response.ok) return getDefaultAnalysis(customerText);

        const data = await response.json();
        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawText) return getDefaultAnalysis(customerText);

        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        return jsonMatch ? JSON.parse(jsonMatch[0]) : getDefaultAnalysis(customerText);

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
 * ฟังก์ชันส่งแจ้งเตือนผ่าน LINE Messaging API (Push Message)
 */
async function sendLinePushAlert(customerText, name, phone, formattedDate, analysis) {
    const channelToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const targetId = process.env.LINE_TARGET_ID; // สามารถเป็น User ID หรือ Group ID ได้

    if (!channelToken || !targetId) {
        console.warn('⚠️ ไม่พบ LINE_CHANNEL_ACCESS_TOKEN หรือ LINE_TARGET_ID ในระบบ');
        return;
    }

    const urgencyTag = getUrgencyText(analysis.urgency);
    const customerInfo = `${name || 'ไม่ระบุชื่อ'} (${phone || 'ไม่ระบุเบอร์โทร'})`;

    const messageText = `📥 แจ้งเตือน Feedback ใหม่!

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
        const response = await fetch('https://api.line.me/v2/bot/message/push', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${channelToken}`
            },
            body: JSON.stringify({
                to: targetId,
                messages: [
                    {
                        type: 'text',
                        text: messageText
                    }
                ]
            })
        });

        const data = await response.json();
        if (response.ok) {
            console.log('✅ ส่งแจ้งเตือนผ่าน LINE Messaging API สำเร็จ!');
        } else {
            console.error('❌ LINE API Error:', data);
        }
    } catch (err) {
        console.error('❌ LINE Network Error:', err);
    }
}

// Endpoint รับข้อมูล Feedback
app.post('/api/feedback', async (req, res) => {
    try {
        const { text, name, phone } = req.body;

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

        // 2. ส่งแจ้งเตือนผ่าน LINE Messaging API
        sendLinePushAlert(text, name, phone, formattedDate, analysis).catch(err => 
            console.error('❌ LINE Async Error:', err)
        );

        // 3. ตอบกลับหน้าเว็บทันที
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