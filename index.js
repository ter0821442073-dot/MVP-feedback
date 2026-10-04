import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

/**
 * ค่าเริ่มต้นกรณี AI ล้มเหลว หรือประมวลผลผิดพลาด (Version 3.9)
 * แยกแยะ Sentiment (คำติ) และหมวดหมู่อย่างเด็ดขาด
 */
function getDefaultAnalysis(text) {
    const textLower = text.toLowerCase();
    
    // คำที่แสดงถึงปัญหา / ข้อติ
    const isNegative = ['หนาว', 'ร้อน', 'แอร์', 'อบอ้าว', 'เหม็น', 'ไม่กรอบ', 'เหนียว', 'เค็ม', 'ช้า', 'ห่วย', 'พัง', 'เสีย', 'เบา', 'ดัง', 'กระตุก'].some(k => textLower.includes(k));
    
    // ตรวจจับหมวดหมู่อุณหภูมิและแอร์
    const isTemp = ['หนาว', 'ร้อน', 'แอร์', 'อบอ้าว', 'อุณหภูมิ'].some(k => textLower.includes(k));
    // ตรวจจับหมวดหมู่อาหาร
    const isFood = ['ป๊อปคอร์น', 'ป็อบคอร์น', 'น้ำ', 'ขนม', 'ไม่กรอบ', 'เค็ม', 'เหนียว'].some(k => textLower.includes(k));
    // ตรวจจับหมวดหมู่สถานที่/ความสะอาด
    const isClean = ['ห้องน้ำ', 'เหม็น', 'สกปรก', 'ขยะ', 'พื้นเหนียว', 'เบาะ'].some(k => textLower.includes(k));
    // ตรวจจับหมวดหมู่ระบบฉายและเสียง
    const isAV = ['เสียง', 'ภาพ', 'จอ', 'ซับ', 'ดับ', 'กระตุก', 'ภาพเบลอ'].some(k => textLower.includes(k));

    let category = 'ทั่วไป / คำชม';
    if (isTemp) {
        category = 'สภาพแวดล้อมและสถานที่ (อุณหภูมิ/แอร์)';
    } else if (isFood) {
        category = 'อาหารและเครื่องดื่ม';
    } else if (isClean) {
        category = 'ความสะอาดและสถานที่';
    } else if (isAV) {
        category = 'ระบบฉายและเสียง';
    }

    return {
        sentiment: isNegative ? 'Negative' : 'Neutral',
        urgency: (isTemp || isAV) ? 'Critical' : (isFood || isClean) ? 'Medium' : 'Low',
        category: category,
        summary: text,
        action_recommendation: isTemp
            ? 'ปรับอุณหภูมิเครื่องปรับอากาศในโรงภาพยนตร์ให้อยู่ในระดับที่เหมาะสมทันที'
            : isFood
                ? 'ตรวจสอบคุณภาพอาหาร/ป๊อปคอร์น และเปลี่ยนสินค้าใหม่ให้ลูกค้า'
                : isClean
                    ? 'ส่งแม่บ้าน/พนักงานทำความสะอาดเข้าจัดการพื้นที่ทันที'
                    : 'ตรวจสอบข้อความและพิจารณาดำเนินการตามความเหมาะสม'
    };
}

/**
 * ฟังก์ชันเรียก AI วิเคราะห์ความคิดเห็น (Version 3.9)
 */
async function analyzeFeedbackWithAI(customerText) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.warn('⚠️ ไม่พบ GEMINI_API_KEY ใช้ค่า Default Analysis');
        return getDefaultAnalysis(customerText);
    }

    const promptText = `คุณคือ AI วิเคราะห์ความคิดเห็นลูกค้าสำหรับธุรกิจโรงภาพยนตร์ (Cinema Version 3.9)
วิเคราะห์ข้อความนี้: "${customerText}"

[กฎเหล็กเรื่อง Sentiment (ความรู้สึก)]:
- หากเป็นคำบ่น ข้อติ ปัญหา หรือสิ่งที่ไม่พอใจ เช่น "หนาวมาก", "ป๊อปคอร์นไม่กรอบ", "ห้องน้ำเหม็น", "แอร์ร้อน" -> บังคับ sentiment: "Negative" เท่านั้น (ห้ามใส่ Positive หรือ Neutral เด็ดขาด!)
- หากเป็นคำชมเชย ประทับใจ -> sentiment: "Positive"

[กฎการจำแนกหมวดหมู่ (category) - ห้ามสับสนเด็ดขาด]:
1. "สภาพแวดล้อมและสถานที่ (อุณหภูมิ/แอร์)" -> เรื่องเกี่ยวกับ แอร์, หนาว, หนาวมาก, ร้อน, อบอ้าว, อุณหภูมิ (***ห้ามจัดหมวดนี้เข้าเรื่องระบบเสียงเด็ดขาด!***)
2. "ความสะอาดและสถานที่" -> ห้องน้ำเหม็น, เบาะสกปรก, พื้นเหนียว, ขยะ
3. "อาหารและเครื่องดื่ม" -> ป๊อปคอร์นไม่กรอบ, ป๊อปคอร์นเหนียว/เค็ม/เย็น, น้ำอัดลมไม่มีงวด, รอนาน, อาหารเสีย
4. "ระบบฉายและเสียง" -> เฉพาะเรื่อง จอภาพ, ภาพเบลอ, สีเพี้ยน, เสียงเบา/ดังไป, ลำโพงแตก, หนังกระตุก, ซับไตเติลหาย
5. "พนักงานและการบริการ" -> พูดจาไม่ดี, ชักสีหน้า, คิดเงินผิด, แถวยาว
6. "ระบบตั๋วและแอปพลิเคชัน" -> จองตั๋วไม่ได้, ตู้ตั๋วเสีย, ตัดเงินไม่ได้ตั๋ว
7. "พฤติกรรมลูกค้าท่านอื่น" -> คุยเสียงดัง, เล่นโทรศัพท์, เอาเท้าพาด
8. "ทั่วไป / คำชม" -> คำชมเชยบริการ หรือ ข้อเสนอแนะทั่วไป

[ระดับความเร่งด่วน (urgency)]:
- Critical: แอร์หนาวมาก/ร้อน/ดับ, หนังดับ/กระตุก/ภาพเสียงเสีย (กระทบการดูหนังทันที)
- High: ตัดเงินไม่ได้ตั๋ว, พนักงานพูดจาหยาบคาย, กลิ่นเหม็นรุนแรง, สิ่งแปลกปลอมในอาหาร
- Medium: ป๊อปคอร์นไม่กรอบ/เหนียว/ไม่อร่อย, แถวยาว, คนข้างๆ เสียงดัง
- Low: คำชมเชย, ข้อเสนอแนะทั่วไป

ตอบกลับเป็น JSON ภาษาไทย รูปแบบนี้เท่านั้น:
{
  "sentiment": "Positive" | "Neutral" | "Negative",
  "urgency": "Low" | "Medium" | "High" | "Critical",
  "category": "ชื่อหมวดหมู่ตามกฎด้านบน",
  "summary": "สรุป 1 ประโยคสั้นๆ",
  "action_recommendation": "คำแนะนำสั้นๆ ในการแก้ไขปัญหา"
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
 * ฟังก์ชันส่งแจ้งเตือนผ่าน LINE Messaging API
 */
async function sendLinePushAlert(customerText, name, phone, formattedDate, analysis) {
    const channelToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const targetId = process.env.LINE_TARGET_ID;

    if (!channelToken || !targetId) {
        console.error('❌ LINE Alert Error: ไม่พบ LINE_CHANNEL_ACCESS_TOKEN หรือ LINE_TARGET_ID');
        return;
    }

    const urgencyTag = getUrgencyText(analysis.urgency);
    const customerInfo = `${name || 'ไม่ระบุชื่อ'} (${phone || 'ไม่ระบุเบอร์โทร'})`;

    const messageText = `📥 แจ้งเตือน Feedback ใหม่! (Cinema v3.9)

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

        // 2. ส่ง LINE Alert และรอให้ทำงานเสร็จก่อนจบ Request
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

// Endpoint สำหรับ Webhook LINE Group ID
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