import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

/**
 * ฟังก์ชันจำแนกหมวดหมู่และวิเคราะห์สำรอง (Version 4.1 - Accurate Sentiment)
 * แก้ปัญหาคำชม (บริการดี/พนักงานดี) โดนมองเป็น Negative
 */
function getDefaultAnalysis(text) {
    const textLower = text.toLowerCase();

    // 1. ตรวจจับคำชม (Positive Indicators)
    const isPositive = ['ดีมาก', 'ดีเยี่ยม', 'ประทับใจ', 'ชมเชย', 'สุดยอด', 'สะอาด', 'หอม', 'กรอบ', 'พูดจาดี', 'ยิ้มแย้ม', 'น่ารัก'].some(k => textLower.includes(k));

    // 2. ตรวจจับคำติ / ปัญหา (Negative Indicators)
    const isNegative = ['ไม่ดี', 'แย่', 'ห่วย', 'ช้า', 'พัง', 'เสีย', 'เหม็น', 'สกปรก', 'หนาว', 'ร้อน', 'อบอ้าว', 'ไม่กรอบ', 'เหนียว', 'เค็ม', 'ด่า', 'กระตุก', 'ดับ'].some(k => textLower.includes(k));

    // หมวดหมู่ความสะอาดและสถานที่
    const isSanitation = ['ห้องน้ำ', 'เหม็น', 'สกปรก', 'ขยะ', 'พื้นเหนียว', 'เบาะเปรอะ', 'กลิ่น'].some(k => textLower.includes(k));
    // หมวดหมู่ระบบปรับอากาศ
    const isHVAC = ['แอร์', 'หนาว', 'ร้อน', 'อบอ้าว', 'อุณหภูมิ', 'เย็นเกิน', 'ร้อนมาก'].some(k => textLower.includes(k));
    // หมวดหมู่อาหารและเครื่องดื่ม
    const isFood = ['ป๊อปคอร์น', 'ป็อบคอร์น', 'น้ำอัดลม', 'ขนม', 'ไม่กรอบ', 'เหนียว', 'เค็ม', 'อาหาร'].some(k => textLower.includes(k));
    // หมวดหมูระบบฉายและเสียง
    const isAV = ['เสียง', 'ภาพ', 'จอ', 'ซับ', 'ดับ', 'กระตุก', 'ภาพเบลอ', 'ลำโพง'].some(k => textLower.includes(k));
    // หมวดหมู่พนักงานและการบริการ
    const isStaff = ['พนักงาน', 'บริการ', 'ชักสีหน้า', 'พูดจา', 'แถวยาว', 'คิดเงินผิด'].some(k => textLower.includes(k));
    // หมวดหมู่ระบบตั๋วและแอป
    const isTicket = ['ตั๋ว', 'แอป', 'ตู้', 'จอง', 'ตัดเงิน'].some(k => textLower.includes(k));

    // กำหนด Sentiment
    let sentiment = 'Neutral';
    if (isPositive && !isNegative) {
        sentiment = 'Positive';
    } else if (isNegative) {
        sentiment = 'Negative';
    }

    let category = 'ทั่วไป / คำชม';
    let action = 'ขอบคุณสำหรับข้อเสนอแนะ และจะนำไปพัฒนาปรับปรุงการให้บริการต่อไป';
    let urgency = 'Low';

    if (isSanitation) {
        category = 'ความสะอาดและสถานที่';
        action = sentiment === 'Negative' 
            ? 'แจ้งแม่บ้าน/ทีมทำความสะอาดเข้าตรวจสอบและจัดการความสะอาดทันที' 
            : 'ชื่นชมทีมงานแม่บ้านและรักษามาตรฐานความสะอาดต่อไป';
        urgency = sentiment === 'Negative' ? 'High' : 'Low';
    } else if (isHVAC) {
        category = 'ระบบปรับอากาศ (แอร์)';
        action = sentiment === 'Negative' 
            ? 'ประสานงานช่างอาคารเข้าตรวจสอบและปรับอุณหภูมิเครื่องปรับอากาศด่วน' 
            : 'รักษามาตรฐานอุณหภูมิที่เหมาะสมภายในโรงภาพยนตร์';
        urgency = sentiment === 'Negative' ? 'Critical' : 'Low';
    } else if (isFood) {
        category = 'อาหารและเครื่องดื่ม';
        action = sentiment === 'Negative' 
            ? 'ตรวจสอบคุณภาพอาหาร/เครื่องดื่มในเคาน์เตอร์ และเปลี่ยนสินค้าใหม่ให้ลูกค้า' 
            : 'ชื่นชมทีมเคาน์เตอร์อาหารและรักษาคุณภาพสินค้าต่อไป';
        urgency = sentiment === 'Negative' ? 'Medium' : 'Low';
    } else if (isAV) {
        category = 'ระบบฉายและเสียง';
        action = sentiment === 'Negative' 
            ? 'แจ้งช่างเทคนิคประจำโรงภาพยนตร์เข้าตรวจสอบระบบภาพและเสียงทันที' 
            : 'รักษามาตรฐานการฉายภาพและเสียงต่อไป';
        urgency = sentiment === 'Negative' ? 'Critical' : 'Low';
    } else if (isStaff) {
        category = 'พนักงานและการบริการ';
        action = sentiment === 'Negative' 
            ? 'ประสานงานผู้จัดการสาขาตักเตือนและปรับปรุงการให้บริการของพนักงาน' 
            : 'ส่งคำชมเชยไปยังพนักงานและผู้จัดการสาขาเพื่อเป็นกำลังใจในการทำงาน';
        urgency = sentiment === 'Negative' ? 'Medium' : 'Low';
    } else if (isTicket) {
        category = 'ระบบตั๋วและแอปพลิเคชัน';
        action = sentiment === 'Negative' 
            ? 'ตรวจสอบระบบการชำระเงิน/ตู้จำหน่ายตั๋วเพื่อแก้ไขปัญหาให้ลูกค้า' 
            : 'รักษามาตรฐานระบบตั๋วและแอปพลิเคชัน';
        urgency = sentiment === 'Negative' ? 'High' : 'Low';
    }

    return {
        sentiment: sentiment,
        urgency: urgency,
        category: category,
        summary: text,
        action_recommendation: action
    };
}

/**
 * ฟังก์ชันเรียก AI วิเคราะห์ความคิดเห็น (Cinema Version 4.1)
 */
async function analyzeFeedbackWithAI(customerText) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.warn('⚠️ ไม่พบ GEMINI_API_KEY ใช้ค่า Default Analysis');
        return getDefaultAnalysis(customerText);
    }

    const promptText = `คุณคือ AI วิเคราะห์ความคิดเห็นลูกค้าสำหรับธุรกิจโรงภาพยนตร์ (Cinema Version 4.1)
วิเคราะห์ข้อความลูกค้า: "${customerText}"

[กฎเหล็กเรื่อง Sentiment (ความรู้สึก)]:
- หากเป็นคำชมเชย ประทับใจ บริการดี ชื่นชม เช่น "พนักงานบริการดีมาก", "ป๊อปคอร์นอร่อย", "สะอาดมาก" -> บังคับ sentiment: "Positive" เท่านั้น!
- หากเป็นคำบ่น ติ ปัญหา เช่น "พนักงานพูดจาหยาบคาย", "ห้องน้ำเหม็น", "หนาวมาก", "ป๊อปคอร์นไม่กรอบ" -> บังคับ sentiment: "Negative" เท่านั้น!
- หากเป็นข้อเสนอแนะกลางๆ หรือถามข้อมูล -> sentiment: "Neutral"

[ตารางจำแนกหมวดหมู่ (category)]:
1. "พนักงานและการบริการ" -> พนักงานพูดจาดี/ไม่ดี, บริการดี/ไม่ดี, ยิ้มแย้ม, ชักสีหน้า, แถวยาว, คิดเงินผิด
2. "ความสะอาดและสถานที่" -> ห้องน้ำเหม็น, ห้องน้ำสกปรก, กลิ่นเหม็น, พื้นเหนียว, เบาะเปรอะ, ขยะ
3. "ระบบปรับอากาศ (แอร์)" -> แอร์หนาว, แอร์ร้อน, หนาวมาก, อบอ้าว, อุณหภูมิ
4. "อาหารและเครื่องดื่ม" -> ป๊อปคอร์นไม่กรอบ, เหนียว, เค็ม, อร่อย, น้ำอัดลมไม่มีงวด, อาหารเสีย
5. "ระบบฉายและเสียง" -> จอภาพเบลอ, ภาพดับ, เสียงเบา/ดังไป, ลำโพงแตก, ซับไตเติลหาย
6. "ระบบตั๋วและแอปพลิเคชัน" -> จองตั๋วไม่ได้, ตัดเงินไม่ได้ตั๋ว, ตู้สแกนเสีย
7. "พฤติกรรมลูกค้าท่านอื่น" -> คุยเสียงดัง, เล่นโทรศัพท์, เอาเท้าพาด
8. "ทั่วไป / คำชม" -> คำชมเชยทั่วไปที่ไม่ระบุตัวบุคคล หรือ ข้อเสนอแนะอื่นๆ

[การกำหนด action_recommendation]:
- กรณีคำชม (Positive): คำแนะนำต้องเป็นการส่งคำชมเชยไปยังพนักงาน/ทีมงานเพื่อเป็นกำลังใจ (ห้ามสั่งตักเตือนเด็ดขาด!)
- กรณีคำติ (Negative): คำแนะนำให้เป็นการแก้ไขปัญหาตามหมวดหมู่นั้นๆ

ตอบเป็น JSON ภาษาไทย รูปแบบนี้เท่านั้น:
{
  "sentiment": "Positive" | "Neutral" | "Negative",
  "urgency": "Low" | "Medium" | "High" | "Critical",
  "category": "ระบุชื่อหมวดหมู่ที่ตรงที่สุด",
  "summary": "สรุปใจความใน 1 ประโยค",
  "action_recommendation": "คำแนะนำสั้นๆ ที่เหมาะสมกับ Sentiment"
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
        console.error('❌ LINE Alert Error: ไม่พบ LINE_CHANNEL_ACCESS_TOKEN หรือ LINE_TARGET_ID ใน Environment Variables');
        return;
    }

    const urgencyTag = getUrgencyText(analysis.urgency);
    const customerInfo = `${name || 'ไม่ระบุชื่อ'} (${phone || 'ไม่ระบุเบอร์โทร'})`;

    const messageText = `📥 แจ้งเตือน Feedback ใหม่! (Cinema v4.1)

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