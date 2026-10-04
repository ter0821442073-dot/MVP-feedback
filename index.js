import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

/**
 * ค่าเริ่มต้นกรณี AI ล้มเหลว หรือไม่ได้ใส่ API Key
 * [แก้ไขใน v3.8]: แยกหมวดหมู่อุณหภูมิ/สถานที่ ออกจากระบบฉายภาพและเสียงอย่างเด็ดขาด
 */
function getDefaultAnalysis(text) {
    const textLower = text.toLowerCase();
    
    // ตรวจจับหมวดหมู่อุณหภูมิและแอร์
    const isTemperature = ['หนาว', 'ร้อน', 'แอร์', 'อบอ้าว', 'เยือกเย็น', 'ปรับแอร์'].some(k => textLower.includes(k));
    // ตรวจจับหมวดหมู่ระบบฉายและเสียง
    const isAV = ['เสียง', 'ภาพ', 'จอ', 'ดัง', 'เบา', 'ซับ', 'ดับ', 'กระตุก', 'ไมค์'].some(k => textLower.includes(k));
    // ตรวจจับความเร่งด่วน
    const isCritical = isTemperature || isAV || ['พัง', 'เสีย', 'เหม็น', 'ช้ามาก', 'ห่วย'].some(k => textLower.includes(k));

    let category = 'ทั่วไป / คำชม';
    if (isTemperature) {
        category = 'สภาพแวดล้อมและสถานที่ (อุณหภูมิ/แอร์)';
    } else if (isAV) {
        category = 'ระบบฉายและเสียง';
    }

    return {
        sentiment: isCritical ? 'Negative' : 'Neutral',
        urgency: isCritical ? 'Critical' : 'Medium',
        category: category,
        summary: text,
        action_recommendation: isTemperature
            ? 'ประสานงานเจ้าหน้าที่ควบคุมระบบปรับอากาศ (HVAC) ตรวจสอบอุณหภูมิภายในโรงภาพยนตร์ด่วนที่สุด'
            : isAV 
                ? 'แจ้งทีมช่างเทคนิคประจำโรงภาพยนตร์เข้าตรวจสอบระบบภาพและเสียงด่วนที่สุด'
                : 'ตรวจสอบข้อความและพิจารณาดำเนินการตามความเหมาะสม'
    };
}

/**
 * ฟังก์ชันเรียก AI วิเคราะห์ความคิดเห็น (Cinema Context)
 * [แก้ไขใน v3.8]: นิยามหมวดหมู่แบบแยกขาดระหว่าง แอร์/สถานที่ กับ ระบบภาพ/เสียง
 */
async function analyzeFeedbackWithAI(customerText) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.warn('⚠️ ไม่พบ GEMINI_API_KEY ใช้ค่า Default Analysis');
        return getDefaultAnalysis(customerText);
    }

    const promptText = `คุณคือ AI วิเคราะห์ความคิดเห็นลูกค้าสำหรับธุรกิจโรงภาพยนตร์ (Cinema Version 3.8)
จำแนกหมวดหมู่และระดับความเร่งด่วนจากข้อความลูกค้า: "${customerText}"

กฎการจำแนกหมวดหมู่ (category) ห้ามปะปนกันเด็ดขาด:
1. "สภาพแวดล้อมและสถานที่ (อุณหภูมิ/แอร์)" -> ทุกอย่างที่เกี่ยวกับ แอร์, ร้อน, หนาวมาก, อบอ้าว, ความสะอาด, กลิ่นเหม็น, เบาะ, ห้องน้ำ, ขยะ
2. "ระบบฉายและเสียง" -> เฉพาะเรื่อง จอภาพ, ภาพเบลอ, สีเพี้ยน, เสียงดังไป/เบาไป, ลำโพงแตก, หนังกระตุก, ซับไตเติล
3. "อาหารและเครื่องดื่ม" -> ป๊อปคอร์น, น้ำอัดลม, รอนาน, อาหารเสีย
4. "พนักงานและการบริการ" -> พนักงานพูดจาไม่ดี, ชักสีหน้า, คิดเงินผิด, แถวยาว
5. "ระบบตั๋วและแอปพลิเคชัน" -> จองตั๋วไม่ได้, ตู้ตั๋วเสีย, ตัดเงินไม่ได้ตั๋ว
6. "พฤติกรรมลูกค้าท่านอื่น" -> คุยเสียงดัง, เล่นโทรศัพท์, เอาเท้าพาด
7. "ทั่วไป / คำชม" -> คำชมเชย, ข้อเสนอแนะทั่วไป

ระดับความเร่งด่วน (urgency):
- Critical: แอร์หนาวมาก/ร้อนมาก/ดับ, หนังดับ/กระตุก/ภาพเสียงเสีย, เพลิงไหม้, อาหารเสีย (กระทบการรับชมในโรงทันที)
- High: ตัดเงินไม่ได้ตั๋ว, พนักงานพูดจาหยาบคาย, กลิ่นเหม็นรุนแรง
- Medium: ป๊อปคอร์นเหนียว/ไม่อร่อย, แถวยาว, คนข้างๆ เสียงดัง
- Low: คำชมเชย, ข้อเสนอแนะทั่วไป

ตอบเป็น JSON ภาษาไทย รูปแบบนี้เท่านั้น:
{
  "sentiment": "Positive" | "Neutral" | "Negative",
  "urgency": "Low" | "Medium" | "High" | "Critical",
  "category": "ระบุชื่อหมวดหมู่ให้ตรงตามกฎด้านบน",
  "summary": "สรุปใจความสำคัญใน 1 ประโยคสั้นๆ",
  "action_recommendation": "คำแนะนำสั้นๆ สำหรับผู้จัดการโรงหนังในการแก้ไขปัญหา"
}`;

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

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
 * [แก้ไขใน v3.8]: เพิ่ม Log รายละเอียดการส่ง และการจัดการ Response เพื่อแก้ปัญหาการส่งล้มเหลว
 */
async function sendLinePushAlert(customerText, name, phone, formattedDate, analysis) {
    const channelToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const targetId = process.env.LINE_TARGET_ID;

    if (!channelToken || !targetId) {
        console.error('❌ LINE Alert Error: ไม่พบ LINE_CHANNEL_ACCESS_TOKEN หรือ LINE_TARGET_ID ใน Environment Variables');
        return;
    }

    const urgencyTag = getUrgencyText(analysis.urgency);
    const customerInfo = `${name || 'ไม่ระบุชื่อ'} (${phone || 'ไม่ระบุเบอร์โทร'})`;

    const messageText = `📥 แจ้งเตือน Feedback ใหม่! (Cinema v3.8)

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
                'Authorization': `Bearer ${channelToken.trim()}`
            },
            body: JSON.stringify({
                to: targetId.trim(),
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
            console.log('✅ ส่งแจ้งเตือนผ่าน LINE สำเร็จ:', data);
        } else {
            console.error('❌ LINE API ตอบกลับข้อผิดพลาด:', response.status, data);
        }
    } catch (err) {
        console.error('❌ LINE Network Error:', err.message);
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

        // 2. [แก้ไข v3.8]: ใส่ await เพื่อให้ Vercel รอให้การส่ง LINE เสร็จสิ้นก่อนปิด Process
        await sendLinePushAlert(text, name, phone, formattedDate, analysis);

        // 3. ตอบกลับหน้าเว็บ
        return res.json({
            success: true,
            analysis: analysis
        });

    } catch (error) {
        console.error('❌ Server Error:', error);
        return res.status(500).json({ error: `เกิดข้อผิดพลาด: ${error.message}` });
    }
});

// Endpoint สำหรับดึง Group ID ผ่าน Webhook
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