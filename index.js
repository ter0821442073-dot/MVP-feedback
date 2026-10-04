import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

/**
 * ฟังก์ชันจำแนกหมวดหมู่และวิเคราะห์สำรอง (Version 4.0 - Strict Matching)
 * แก้ปัญหาคีย์เวิร์ดตีกันระหว่าง เหม็น/ห้องน้ำ กับ อาหาร/แอร์
 */
function getDefaultAnalysis(text) {
    const textLower = text.toLowerCase();

    // 1. ตรวจจับเรื่องความสะอาด และสถานที่ (เช่น ห้องน้ำเหม็น, พื้นเหนียว, เบาะสกปรก)
    const isSanitation = ['ห้องน้ำ', 'เหม็น', 'สกปรก', 'ขยะ', 'พื้นเหนียว', 'เบาะเปรอะ', 'กลิ่น'].some(k => textLower.includes(k));
    
    // 2. ตรวจจับเรื่องระบบปรับอากาศ / อุณหภูมิ
    const isHVAC = ['แอร์', 'หนาว', 'ร้อน', 'อบอ้าว', 'อุณหภูมิ', 'เย็นเกิน', 'ร้อนมาก'].some(k => textLower.includes(k));
    
    // 3. ตรวจจับเรื่องอาหารและเครื่องดื่ม
    const isFood = ['ป๊อปคอร์น', 'ป็อบคอร์น', 'น้ำอัดลม', 'น้ำแก้ว', 'ขนม', 'ไม่กรอบ', 'เหนียว', 'เค็ม', 'หวาน', 'อาหาร'].some(k => textLower.includes(k));
    
    // 4. ตรวจจับเรื่องระบบฉายและเสียง
    const isAV = ['เสียง', 'ภาพ', 'จอ', 'ซับ', 'ดับ', 'กระตุก', 'ภาพเบลอ', 'ลำโพง'].some(k => textLower.includes(k));

    // 5. ตรวจจับเรื่องพนักงาน
    const isStaff = ['พนักงาน', 'บริการ', 'ชักสีหน้า', 'พูดจา', 'แถวยาว', 'คิดเงินผิด'].some(k => textLower.includes(k));

    // 6. ตรวจจับเรื่องตั๋วหนัง/แอป
    const isTicket = ['ตั๋ว', 'แอป', 'ตู้', 'จอง', 'ตัดเงิน'].some(k => textLower.includes(k));

    // ประเมิน Sentiment และ Urgency
    const isNegative = isSanitation || isHVAC || isFood || isAV || isStaff || isTicket || ['พัง', 'เสีย', 'ห่วย', 'ช้ามาก'].some(k => textLower.includes(k));

    let category = 'ทั่วไป / คำชม';
    let action = 'ตรวจสอบข้อความและพิจารณาดำเนินการตามความเหมาะสม';
    let urgency = 'Low';

    if (isSanitation) {
        category = 'ความสะอาดและสถานที่';
        action = 'แจ้งแม่บ้าน/ทีมทำความสะอาดเข้าตรวจสอบและจัดการความสะอาด/กลิ่นเหม็นในพื้นที่ทันที';
        urgency = 'High';
    } else if (isHVAC) {
        category = 'ระบบปรับอากาศ (แอร์)';
        action = 'ประสานงานช่างอาคารเข้าตรวจสอบและปรับอุณหภูมิเครื่องปรับอากาศให้เหมาะสมด่วน';
        urgency = 'Critical';
    } else if (isFood) {
        category = 'อาหารและเครื่องดื่ม';
        action = 'ตรวจสอบคุณภาพอาหาร/เครื่องดื่มในเคาน์เตอร์ และเปลี่ยนสินค้าใหม่ให้ลูกค้า';
        urgency = 'Medium';
    } else if (isAV) {
        category = 'ระบบฉายและเสียง';
        action = 'แจ้งช่างเทคนิคประจำโรงภาพยนตร์เข้าตรวจสอบระบบภาพและเสียงทันที';
        urgency = 'Critical';
    } else if (isStaff) {
        category = 'พนักงานและการบริการ';
        action = 'ประสานงานผู้จัดการสาขาตักเตือนและปรับปรุงการให้บริการของพนักงาน';
        urgency = 'Medium';
    } else if (isTicket) {
        category = 'ระบบตั๋วและแอปพลิเคชัน';
        action = 'ตรวจสอบระบบการชำระเงิน/ตู้จำหน่ายตั๋วเพื่อแก้ไขปัญหาให้ลูกค้า';
        urgency = 'High';
    }

    return {
        sentiment: isNegative ? 'Negative' : 'Neutral',
        urgency: isNegative ? urgency : 'Low',
        category: category,
        summary: text,
        action_recommendation: action
    };
}

/**
 * ฟังก์ชันเรียก AI วิเคราะห์ความคิดเห็น (Cinema Version 4.0)
 */
async function analyzeFeedbackWithAI(customerText) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.warn('⚠️ ไม่พบ GEMINI_API_KEY ใช้ค่า Default Analysis');
        return getDefaultAnalysis(customerText);
    }

    const promptText = `คุณคือ AI วิเคราะห์ความคิดเห็นลูกค้าสำหรับธุรกิจโรงภาพยนตร์ (Cinema Version 4.0)
จงจำแนกหมวดหมู่ ข้อความลูกค้า: "${customerText}" 

[ตารางจำแนกหมวดหมู่ (category) บังคับปฏิบัติตามอย่างเคร่งครัด]:
1. "ความสะอาดและสถานที่" -> เรื่อง ห้องน้ำเหม็น, ห้องน้ำสกปรก, กลิ่นเหม็น, พื้นเหนียว, เบาะเปรอะ, ขยะ (***หากเจอเรื่องห้องน้ำเหม็น บังคับตอบหมวดนี้เท่านั้น ห้ามตอบอาหารเด็ดขาด!***)
2. "ระบบปรับอากาศ (แอร์)" -> เรื่อง แอร์หนาว, แอร์ร้อน, หนาวมาก, อบอ้าว, อุณหภูมิ
3. "อาหารและเครื่องดื่ม" -> เรื่อง ป๊อปคอร์นไม่กรอบ, ป๊อปคอร์นเหนียว, เค็ม, น้ำอัดลมไม่มีงวด, อาหารเสีย, รออาหารนาน
4. "ระบบฉายและเสียง" -> เรื่อง จอภาพเบลอ, ภาพดับ, เสียงเบา/ดังไป, ลำโพงแตก, ซับไตเติลหาย, หนังกระตุก
5. "พนักงานและการบริการ" -> เรื่อง พนักงานพูดจาหยาบคาย, ชักสีหน้า, แถวยาว, คิดเงินผิด
6. "ระบบตั๋วและแอปพลิเคชัน" -> เรื่อง จองตั๋วไม่ได้, ตัดเงินไม่ได้ตั๋ว, ตู้สแกนเสีย
7. "พฤติกรรมลูกค้าท่านอื่น" -> เรื่อง คุยเสียงดัง, เล่นโทรศัพท์, เอาเท้าพาด
8. "ทั่วไป / คำชม" -> คำชมเชย หรือ ข้อเสนอแนะทั่วไป

[กฎเหล็ก Sentiment และ Action]:
- หากเป็นคำบ่น ติ ปัญหา เช่น "ห้องน้ำเหม็น", "หนาวมาก", "ป๊อปคอร์นไม่กรอบ" -> sentiment ต้องเป็น "Negative" เท่านั้น!
- คำแนะนำ (action_recommendation) ต้องสอดคล้องกับปัญหา เช่น ปัญหาห้องน้ำเหม็น คำแนะนำต้องเป็นการแจ้งแม่บ้าน/ทำความสะอาด (ห้ามเสนอให้เปลี่ยนอาหารเด็ดขาด)

ตอบเป็น JSON ภาษาไทย รูปแบบนี้เท่านั้น:
{
  "sentiment": "Positive" | "Neutral" | "Negative",
  "urgency": "Low" | "Medium" | "High" | "Critical",
  "category": "ระบุหมวดหมู่ที่ตรงตามกฎข้างบน",
  "summary": "สรุปปัญหาใน 1 ประโยค",
  "action_recommendation": "คำแนะนำสั้นๆ ที่ตรงกับปัญหานั้นๆ"
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
            console.error('❌ Gemini API Error Status:', response.status);
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
        console.error('❌ LINE Alert Error: ไม่พบ LINE_CHANNEL_ACCESS_TOKEN หรือ LINE_TARGET_ID ใน Environment Variables');
        return;
    }

    const urgencyTag = getUrgencyText(analysis.urgency);
    const customerInfo = `${name || 'ไม่ระบุชื่อ'} (${phone || 'ไม่ระบุเบอร์โทร'})`;

    const messageText = `📥 แจ้งเตือน Feedback ใหม่! (Cinema v4.0)

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

        // 2. ส่ง LINE Push Alert
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