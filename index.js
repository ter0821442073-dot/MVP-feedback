import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

/**
 * 1. ฟังก์ชัน Guardrail ขั้นสูงสุด (Version 6.3 - Fixed Light/Staff Forget Issue)
 */
function applyGuardrail(analysis, text) {
    const textLower = text.toLowerCase();

    // รายการคำชมเชยชัดเจน
    const positiveKeywords = ['ดีมาก', 'ดีเยี่ยม', 'ประทับใจ', 'ชมเชย', 'หล่อ', 'สวย', 'สุดยอด', 'น่ารัก', 'ยิ้มแย้ม', 'พูดจาดี', 'สะอาดมาก', 'หอม', 'อร่อย', 'บริการดี'];
    
    // รายการคำติ / เชิงลบทุกประเภท
    const negativeKeywords = [
        // คำติเชิงพนักงานและการบริการ
        'ไม่ค่อยดี', 'ไม่ดี', 'ไม่โอเค', 'ไม่น่ารัก', 'ไม่ยิ้ม', 'ไม่ประทับใจ', 'ไม่สุภาพ', 'ไม่แนะนำ', 'พนักงานน้อย', 
        'ตะคอก', 'ตะโกน', 'ด่า', 'ขึ้นเสียง', 'หน้าบึ้ง', 'ชักสีหน้า', 'พูดจาแย่', 'พูดจาหยาบคาย', 'พนักงานไม่พอ', 
        'มารยาทแย่', 'มารยาทไม่ดี', 'บริการแย่', 'บริการห่วย', 'ช้า', 'คิดเงินผิด', 'แถวยาว', 'ลืม', 'ลืมปิด',
        // คำติทั่วไป / สถานที่ / อุปกรณ์ / ระบบไฟ / คูปอง
        'แย่', 'ห่วย', 'พัง', 'เสีย', 'เหม็น', 'สกปรก', 'หนาว', 'ร้อน', 'อบอ้าว', 'ไม่ปิดไฟ', 'คูปองใช้ไม่ได้', 'ใช้ไม่ได้', 'ใช้ไม่ได้เลย', 'ทำไมใช้ไม่ได้',
        'ไม่กรอบ', 'เหนียว', 'เค็ม', 'กระตุก', 'ดับ', 'มืด', 'มืดมาก', 'ไม่สว่าง', 'ไม่ฉาย', 'จอดำ', 'อับ', 'ไม่มีเสียง', 'ทำไมถึง', 'สปอตไลท์', 'เปิดไฟทิ้งไว้'
    ];

    const hasPositive = positiveKeywords.some(k => textLower.includes(k));
    const hasNegative = negativeKeywords.some(k => textLower.includes(k));

    // ตรวจสอบว่าเป็นเรื่องพนักงานและการบริการหรือไม่
    const isStaffIssue = ['พนักงาน', 'บริการ', 'แนะนำ', 'ตะคอก', 'ตะโกน', 'ด่า', 'ขึ้นเสียง', 'หน้าบึ้ง', 'ชักสีหน้า', 'ไม่ยิ้ม', 'พูดจา', 'มารยาท', 'เคาน์เตอร์', 'ลืม'].some(k => textLower.includes(k));

    // กฎที่ 1: พนักงานลืมปิดไฟ / ลืมปิดสปอตไลท์ / ลืมเปิด / ลืมบริการ -> บังคับ Negative + High Urgency + พนักงานและการบริการ
    if (isStaffIssue && (['ลืม', 'ไม่ปิด', 'ลืมปิด', 'สปอตไลท์'].some(k => textLower.includes(k)))) {
        analysis.sentiment = 'Negative';
        analysis.urgency = 'High';
        analysis.category = 'พนักงานและการบริการ';
        analysis.action_recommendation = 'แจ้งผู้จัดการสาขาเน้นย้ำและกำชับพนักงานตรวจสอบการปิดไฟ/สปอตไลท์ในโรงภาพยนตร์ก่อนเริ่มฉายทุกครั้ง';
        return analysis;
    }

    // กฎที่ 2: เรื่องพนักงานแล้วพบคำติ/ปฏิเสธ
    if (isStaffIssue && (hasNegative || textLower.includes('ไม่'))) {
        if (!hasPositive || textLower.includes('ไม่ค่อยดี') || textLower.includes('ไม่ดี') || textLower.includes('ไม่ค่อย')) {
            analysis.sentiment = 'Negative';
            analysis.urgency = 'High';
            analysis.category = 'พนักงานและการบริการ';
            analysis.action_recommendation = 'ประสานงานผู้จัดการสาขาตรวจสอบ อบรม และปรับปรุงทักษะการให้บริการ/แนะนำลูกค้าของพนักงานด่วน';
            return analysis;
        }
    }

    // กฎที่ 3: เรื่องไฟในโรงภาพยนตร์ (ลืมปิดไฟ, ไม่ปิดไฟ, สปอตไลท์)
    if (['ไฟ', 'สปอตไลท์', 'มืด', 'สว่าง'].some(k => textLower.includes(k)) && (hasNegative || textLower.includes('ไม่ปิด') || textLower.includes('ลืม'))) {
        analysis.sentiment = 'Negative';
        analysis.urgency = 'High';
        analysis.category = 'ความสะอาดและสถานที่';
        analysis.action_recommendation = 'ประสานงานเจ้าหน้าที่ประจำโรงภาพยนตร์เข้าปิดไฟ/สปอตไลท์ในโรงด่วน';
        return analysis;
    }

    // กฎที่ 4: เรื่องคูปอง / ตั๋ว / โปรโมชัน / แอป
    if (['คูปอง', 'สิทธิ์', 'วอชเชอร์', 'voucher', 'ตั๋ว', 'แอป', 'ตู้สแกน', 'สแกน', 'โปรโมชัน'].some(k => textLower.includes(k))) {
        analysis.category = 'ระบบตั๋วและแอปพลิเคชัน';
        if (hasNegative || textLower.includes('ใช้ไม่ได้') || textLower.includes('ไม่') || textLower.includes('ทำไม')) {
            analysis.sentiment = 'Negative';
            analysis.urgency = 'High';
            analysis.action_recommendation = 'ประสานงานทีมไอที/หน้าเคาน์เตอร์ตรวจสอบเงื่อนไขคูปองและระบบออกตั๋วด่วน';
            return analysis;
        }
    }

    // กฎที่ 5: หนังไม่ฉาย / จอดำ / ไม่มีเสียง / ระบบการฉายจริง
    if (['หนังไม่ฉาย', 'ไม่ฉาย', 'จอดำ', 'ไม่มีเสียง', 'เสียงเบา', 'ภาพเบลอ', 'ลำโพง', 'ซับ'].some(k => textLower.includes(k))) {
        analysis.category = 'ระบบฉายและเสียง';
        analysis.sentiment = 'Negative';
        analysis.urgency = ['จอดำ', 'ไม่ฉาย'].some(k => textLower.includes(k)) ? 'Critical' : 'High';
        analysis.action_recommendation = '🚨 แจ้งช่างเทคนิคและผู้จัดการโรงภาพยนตร์เข้าตรวจสอบห้องควบคุมการฉาย (Projection Room) ทันที!';
        return analysis;
    }

    // กฎที่ 6: แอร์หนาว / ร้อน
    if (['แอร์', 'หนาว', 'ร้อน', 'อบอ้าว'].some(k => textLower.includes(k)) && !textLower.includes('เสียง')) {
        analysis.category = 'ระบบปรับอากาศ (แอร์)';
        if (hasNegative || ['หนาว', 'ร้อน', 'อบอ้าว'].some(k => textLower.includes(k))) {
            analysis.sentiment = 'Negative';
            analysis.urgency = 'High';
            analysis.action_recommendation = 'ประสานงานช่างอาคารเข้าตรวจสอบและปรับอุณหภูมิเครื่องปรับอากาศด่วน';
        }
        return analysis;
    }

    // กฎที่ 7: คำชมชัดเจน และไม่มีคำติ
    if (hasPositive && !hasNegative) {
        analysis.sentiment = 'Positive';
        analysis.urgency = 'Low';

        if (isStaffIssue) {
            analysis.category = 'พนักงานและการบริการ';
            analysis.action_recommendation = 'ส่งคำชมเชยไปยังพนักงานและผู้จัดการสาขาเพื่อเป็นกำลังใจในการทำงาน';
        } else if (['ป๊อปคอร์น', 'อาหาร', 'อร่อย', 'ขนม'].some(k => textLower.includes(k))) {
            analysis.category = 'อาหารและเครื่องดื่ม';
            analysis.action_recommendation = 'ชื่นชมทีมเคาน์เตอร์อาหารและรักษาคุณภาพสินค้าต่อไป';
        } else {
            analysis.action_recommendation = 'ขอบคุณสำหรับคำชมเชย และจะรักษามาตรฐานการบริการที่ดีต่อไป';
        }
        return analysis;
    }

    // บังคับเปลี่ยน Neutral เป็น Negative ทันทีหากตรวจพบคำที่เป็นข้อผิดพลาด/คำร้องเรียน
    if ((hasNegative || textLower.includes('ไม่ปิด') || textLower.includes('ลืม')) && analysis.sentiment === 'Neutral') {
        analysis.sentiment = 'Negative';
        analysis.urgency = 'High';
    }

    return analysis;
}

/**
 * 2. ระบบจำแนกสำรอง (Fallback Algorithm)
 */
function getDefaultAnalysis(text) {
    const textLower = text.toLowerCase();

    const isPositive = ['ดีมาก', 'ดีเยี่ยม', 'ประทับใจ', 'ชมเชย', 'สุดยอด', 'สะอาด', 'หอม', 'กรอบ', 'พูดจาดี', 'ยิ้มแย้ม', 'น่ารัก'].some(k => textLower.includes(k));
    const isNegative = ['ไม่ค่อยดี', 'ไม่ดี', 'ไม่โอเค', 'ตะคอก', 'ตะโกน', 'ด่า', 'ขึ้นเสียง', 'หน้าบึ้ง', 'ชักสีหน้า', 'ไม่ยิ้ม', 'แย่', 'ห่วย', 'ช้า', 'พัง', 'เสีย', 'เหม็น', 'สกปรก', 'หนาว', 'ร้อน', 'อบอ้าว', 'ไม่กรอบ', 'กระตุก', 'ดับ', 'ไม่ฉาย', 'มืด', 'ใช้ไม่ได้', 'ทำไม', 'ลืม', 'ไม่ปิด', 'สปอตไลท์'].some(k => textLower.includes(k));

    let category = 'ทั่วไป / คำชม';
    let action = 'ขอบคุณสำหรับข้อเสนอแนะ และจะนำไปพัฒนาปรับปรุงการให้บริการต่อไป';

    if (['พนักงาน', 'บริการ', 'แนะนำ', 'ตะคอก', 'ด่า', 'ขึ้นเสียง', 'ลืม'].some(k => textLower.includes(k))) {
        category = 'พนักงานและการบริการ';
    } else if (['คูปอง', 'สิทธิ์', 'วอชเชอร์', 'ตั๋ว', 'แอป'].some(k => textLower.includes(k))) {
        category = 'ระบบตั๋วและแอปพลิเคชัน';
    } else if (['ห้องน้ำ', 'เหม็น', 'สกปรก', 'ขยะ', 'ไฟ', 'มืด', 'สว่าง', 'สปอตไลท์'].some(k => textLower.includes(k))) {
        category = 'ความสะอาดและสถานที่';
    } else if (['แอร์', 'หนาว', 'ร้อน', 'อบอ้าว'].some(k => textLower.includes(k))) {
        category = 'ระบบปรับอากาศ (แอร์)';
    } else if (['ป๊อปคอร์น', 'ป็อบคอร์น', 'น้ำอัดลม', 'ขนม', 'อาหาร'].some(k => textLower.includes(k))) {
        category = 'อาหารและเครื่องดื่ม';
    } else if (['หนัง', 'เสียง', 'ภาพ', 'จอ', 'ซับ', 'ลำโพง', 'ฉาย'].some(k => textLower.includes(k))) {
        category = 'ระบบฉายและเสียง';
    }

    let result = {
        sentiment: isPositive && !isNegative ? 'Positive' : isNegative ? 'Negative' : 'Neutral',
        urgency: isNegative ? 'High' : 'Low',
        category: category,
        summary: text,
        action_recommendation: action
    };

    return applyGuardrail(result, text);
}

/**
 * 3. ฟังก์ชันเรียก AI วิเคราะห์ความคิดเห็น
 */
async function analyzeFeedbackWithAI(customerText) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return getDefaultAnalysis(customerText);
    }

    const promptText = `คุณคือ AI วิเคราะห์ความคิดเห็นลูกค้าสำหรับโรงภาพยนตร์
วิเคราะห์ข้อความนี้: "${customerText}"

[กฎความรู้สึก (Sentiment & Urgency Rules)]:
1. คำว่า "ลืมปิดไฟ", "ไม่ปิดไฟ", "ลืมปิดสปอตไลท์", "พนักงานลืม..." ถือเป็นข้อผิดพลาด ถือเป็น sentiment: "Negative" และ urgency: "High" เสมอ!
2. ห้ามตอบ "Neutral" หรือ urgency "Low" สำหรับข้อความที่เป็นการร้องเรียน ปัญหา หรือความบกพร่องของพนักงานเด็ดขาด!

[การจำแนกหมวดหมู่ (category)]:
- "พนักงานและการบริการ": เรื่องพนักงาน, พนักงานลืม..., การบริการ, การแนะนำ, คำชมพนักงาน, ตะคอก, ขึ้นเสียง
- "ความสะอาดและสถานที่": เรื่องไฟแสงสว่างในโรง, กลิ่นเหม็น, ห้องน้ำ, ความสะอาด, เบาะ/เก้าอี้
- "ระบบฉายและเสียง": เรื่องหนังไม่ฉาย, จอดำ, ภาพเบลอ, เสียงเบา/ดัง, ลำโพง, ซับไตเติล
- "ระบบปรับอากาศ (แอร์)": เรื่องแอร์, หนาว, ร้อน, อบอ้าว
- "อาหารและเครื่องดื่ม": เรื่องป๊อปคอร์น, น้ำ, ขนม, ไม่กรอบ, อร่อย
- "ระบบตั๋วและแอปพลิเคชัน": เรื่องจองตั๋ว, คูปอง, สิทธิ์, แอป, ตู้สแกน
- "ทั่วไป / คำชม": ข้อเสนอแนะทั่วไป

ตอบเป็น JSON ภาษาไทย รูปแบบนี้เท่านั้น:
{
  "sentiment": "Positive" | "Neutral" | "Negative",
  "urgency": "Low" | "Medium" | "High" | "Critical",
  "category": "ระบุหมวดหมู่",
  "summary": "สรุปสั้นๆ",
  "action_recommendation": "คำแนะนำทีมงาน"
}`;

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: promptText }] }] })
        });

        if (!response.ok) return getDefaultAnalysis(customerText);

        const data = await response.json();
        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawText) return getDefaultAnalysis(customerText);

        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return getDefaultAnalysis(customerText);

        let parsed = JSON.parse(jsonMatch[0]);
        return applyGuardrail(parsed, customerText);

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
 * 4. ฟังก์ชันส่ง LINE Alert
 */
async function sendLinePushAlert(customerText, name, phone, formattedDate, analysis) {
    const channelToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const targetId = process.env.LINE_TARGET_ID;

    if (!channelToken || !targetId) return;

    const urgencyTag = getUrgencyText(analysis.urgency);
    const customerInfo = `${name || 'ไม่ระบุชื่อ'} (${phone || 'ไม่ระบุเบอร์โทร'})`;

    const messageText = `📥 แจ้งเตือน Feedback ใหม่! (Cinema v6.3)

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
        await fetch('https://api.line.me/v2/bot/message/push', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${channelToken.trim()}`
            },
            body: JSON.stringify({
                to: targetId.trim(),
                messages: [{ type: 'text', text: messageText }]
            })
        });
    } catch (err) {
        console.error('❌ LINE Alert Error:', err.message);
    }
}

// Endpoint รับข้อมูล Feedback
app.post('/api/feedback', async (req, res) => {
    try {
        const { text, name, phone } = req.body;
        if (!text) return res.status(400).json({ error: 'กรุณากรอกข้อความ Feedback' });

        const now = new Date();
        const formattedDate = now.toLocaleString('th-TH', {
            timeZone: 'Asia/Bangkok',
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
        }) + ' น.';

        const analysis = await analyzeFeedbackWithAI(text);
        await sendLinePushAlert(text, name, phone, formattedDate, analysis);

        return res.json({ success: true, analysis: analysis });
    } catch (error) {
        return res.status(500).json({ error: `เกิดข้อผิดพลาด: ${error.message}` });
    }
});

// Endpoint สำหรับ Webhook LINE
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
                            messages: [{ type: 'text', text: `📌 Group ID ของกลุ่มนี้คือ:\n${groupId}` }]
                        })
                    });
                }
            }
        }
        return res.status(200).send('OK');
    } catch (err) {
        return res.status(200).send('OK');
    }
});

export default app;