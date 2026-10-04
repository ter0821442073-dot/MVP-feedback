import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

// ค่าเริ่มต้นกรณี AI ล้มเหลว หรือไม่ได้ใส่ API Key
function getDefaultAnalysis(text) {
    const textLower = text.toLowerCase();
    const isCritical = ['ร้อน', 'แอร์', 'หนาว', 'อบอ้าว', 'พัง', 'เสีย', 'เหม็น', 'ช้ามาก', 'ห่วย', 'กระตุก', 'ดับ'].some(k => textLower.includes(k));

    return {
        sentiment: isCritical ? 'Negative' : 'Neutral',
        urgency: isCritical ? 'Critical' : 'Medium',
        category: isCritical ? 'ระบบฉายและเสียง' : 'ทั่วไป / คำชม',
        summary: text,
        action_recommendation: isCritical 
            ? 'ส่งทีมช่าง/เจ้าหน้าที่เข้าตรวจสอบระบบและพื้นที่ในโรงภาพยนตร์ด่วนที่สุด' 
            : 'ตรวจสอบข้อความและพิจารณาดำเนินการตามความเหมาะสม'
    };
}

// ฟังก์ชันเรียก AI วิเคราะห์ความคิดเห็น (บริบทโรงภาพยนตร์)
async function analyzeFeedbackWithAI(customerText) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.warn('⚠️ ไม่พบ GEMINI_API_KEY ใช้ค่า Default Analysis');
        return getDefaultAnalysis(customerText);
    }

    const promptText = `คุณคือ AI วิเคราะห์ความคิดเห็นลูกค้าสำหรับธุรกิจโรงภาพยนตร์ (Cinema)
หน้าที่ของคุณคืออ่านข้อความติชมจากลูกค้า และสกัดข้อมูลออกมาตามโครงสร้าง JSON ที่กำหนด

หมวดหมู่ที่ใช้ตอบ (category):
1. "ระบบฉายและเสียง" (จอภาพ, ภาพเบลอ, สีเพี้ยน, เสียงเบา/ดังไป, ซับไตเติลหาย, แอร์ไม่เย็น/ร้อน)
2. "ความสะอาดและสถานที่" (เบาะสกปรก, พื้นเหนียว, กลิ่นเหม็น, ห้องน้ำ, ขยะ)
3. "อาหารและเครื่องดื่ม" (ป๊อปคอร์นเหนียว/เค็ม/เย็น, น้ำอัดลมไม่มีงวด, รอนาน, อาหารเสีย)
4. "พนักงานและการบริการ" (พูดจาไม่ดี, ชักสีหน้า, คิดเงินผิด, แนะนำไม่ดี, แถวยาว)
5. "ระบบตั๋วและแอปพลิเคชัน" (จองตั๋วไม่ได้, ตู้ตั๋วเสีย, ตัดเงินแต่ไม่ได้ตั๋ว, สแกนไม่ผ่าน)
6. "พฤติกรรมลูกค้าท่านอื่น" (คุยเสียงดัง, เล่นโทรศัพท์, เอาเท้าพาด, เด็กร้องไห้)
7. "ทั่วไป / คำชม" (ชมเชย, เสนอแนะทั่วไป)

กฎการวิเคราะห์ระดับความเร่งด่วน (urgency):
- Critical: แอร์ดับ/ร้อนมาก, หนังกระตุก/ดับกลางคราว, ภาพ/เสียงเสีย, เพลิงไหม้/อันตราย, อาหารเสีย
- High: ตัดเงินไม่ได้ตั๋ว, พนักงานพูดจาหยาบคายมาก, กลิ่นเหม็นรุนแรง, มีสิ่งแปลกปลอมในอาหาร
- Medium: ป๊อปคอร์นเหนียว/ไม่อร่อย, แถวยาว, ลูกค้าคนอื่นส่งเสียงดัง
- Low: คำชมเชย, ข้อเสนอแนะทั่วไป

ตอบกลับเป็น JSON ภาษาไทย รูปแบบนี้เท่านั้น (ห้ามมีข้อความอื่นนอกวงเล็บปักกิ่ง):
{
  "sentiment": "Positive" | "Neutral" | "Negative",
  "urgency": "Low" | "Medium" | "High" | "Critical",
  "category": "ระบุชื่อหมวดหมู่จาก 7 ข้อด้านบน",
  "summary": "สรุปใจความสำคัญใน 1 ประโยคสั้นๆ",
  "action_recommendation": "คำแนะนำสั้นๆ สำหรับผู้จัดการโรงหนังในการแก้ไขปัญหา"
}

ข้อความของลูกค้า: "${customerText}"`;

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

        // ใช้ Native fetch ของ Node.js v18+ บน Vercel
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: promptText }] }]
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error('❌ Gemini API Error Status:', response.status, errText);
            return getDefaultAnalysis(customerText);
        }

        const data = await response.json();
        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawText) return getDefaultAnalysis(customerText);

        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        return jsonMatch ? JSON.parse(jsonMatch[0]) : getDefaultAnalysis(customerText);

    } catch (err) {
        console.error('❌ AI Exception Error:', err.message);
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
    const targetId = process.env.LINE_TARGET_ID;

    if (!channelToken || !targetId) {
        console.warn('⚠️ ไม่พบ LINE_CHANNEL_ACCESS_TOKEN หรือ LINE_TARGET_ID ในระบบ');
        return;
    }

    const urgencyTag = getUrgencyText(analysis.urgency);
    const customerInfo = `${name || 'ไม่ระบุชื่อ'} (${phone || 'ไม่ระบุเบอร์โทร'})`;

    const messageText = `📥 แจ้งเตือน Feedback ใหม่! (โรงภาพยนตร์)

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

        // 2. ส่งแจ้งเตือนผ่าน LINE Messaging API (ทำงานแบบ Async)
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

// Endpoint สำหรับดึง Group ID โดยตอบกลับในแชทกลุ่มทันที
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
                            messages: [{
                                type: 'text',
                                text: `📌 Group ID ของกลุ่มนี้คือ:\n${groupId}`
                            }]
                        })
                    });
                }
            }
        }
        return res.status(200).send('OK');
    } catch (err) {
        console.error(err);
        return res.status(200).send('OK');
    }
});

export default app;