import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

/**
 * 1. ฟังก์ชัน Guardrail ขั้นสูงสุด (Version 6.4)
 */
function applyGuardrail(analysis, text) {
    const textLower = text.toLowerCase();

    // รายการคำชมเชยชัดเจน
    const positiveKeywords = ['ดีมาก', 'ดีเยี่ยม', 'ประทับใจ', 'ชมเชย', 'หล่อ', 'สวย', 'สุดยอด', 'น่ารัก', 'ยิ้มแย้ม', 'พูดจาดี', 'สะอาดมาก', 'หอม', 'อร่อย', 'บริการดี'];
    
    // รายการคำติ / เชิงลบทุกประเภท
    const negativeKeywords = [
        'ไม่ค่อยดี', 'ไม่ดี', 'ไม่โอเค', 'ไม่น่ารัก', 'ไม่ยิ้ม', 'ไม่ประทับใจ', 'ไม่สุภาพ', 'ไม่แนะนำ', 'พนักงานน้อย', 
        'ตะคอก', 'ตะโกน', 'ด่า', 'ขึ้นเสียง', 'หน้าบึ้ง', 'ชักสีหน้า', 'พูดจาแย่', 'พูดจาหยาบคาย', 'พนักงานไม่พอ', 
        'มารยาทแย่', 'มารยาทไม่ดี', 'บริการแย่', 'บริการห่วย', 'ช้า', 'คิดเงินผิด', 'แถวยาว', 'ลืม', 'ลืมปิด',
        'แย่', 'ห่วย', 'พัง', 'เสีย', 'เหม็น', 'เหม็นอับ', 'อับ', 'สกปรก', 'หนาว', 'ร้อน', 'อบอ้าว', 'ไม่ปิดไฟ', 'ไม่มีไฟ', 'คูปองใช้ไม่ได้', 'ใช้ไม่ได้', 'ใช้ไม่ได้เลย', 'ทำไมใช้ไม่ได้',
        'ไม่กรอบ', 'เหนียว', 'เค็ม', 'กระตุก', 'ดับ', 'มืด', 'มืดมาก', 'ไม่สว่าง', 'ไม่ฉาย', 'จอดำ', 'ไม่มีเสียง', 'ทำไมถึง', 'สปอตไลท์', 'ไม่มีเลย'
    ];

    const hasPositive = positiveKeywords.some(k => textLower.includes(k));
    const hasNegative = negativeKeywords.some(k => textLower.includes(k));

    const isStaffIssue = ['พนักงาน', 'บริการ', 'แนะนำ', 'ตะคอก', 'ตะโกน', 'ด่า', 'ขึ้นเสียง', 'หน้าบึ้ง', 'ชักสีหน้า', 'ไม่ยิ้ม', 'พูดจา', 'มารยาท', 'เคาน์เตอร์', 'ลืม'].some(k => textLower.includes(k));

    // กฎที่ 1: พนักงานลืมปิดไฟ / ลืมบริการ
    if (isStaffIssue && (['ลืม', 'ไม่ปิด', 'ลืมปิด', 'สปอตไลท์'].some(k => textLower.includes(k)))) {
        analysis.sentiment = 'Negative';
        analysis.urgency = 'High';
        analysis.category = 'พนักงานและการบริการ';
        analysis.action_recommendation = 'แจ้งผู้จัดการสาขาเน้นย้ำและกำชับพนักงานตรวจสอบการปิดไฟ/สปอตไลท์ในโรงภาพยนตร์ก่อนเริ่มฉายทุกครั้ง';
        return analysis;
    }

    // กฎที่ 2: พนักงานทำบริการไม่ดี
    if (isStaffIssue && (hasNegative || textLower.includes('ไม่'))) {
        if (!hasPositive || textLower.includes('ไม่ค่อยดี') || textLower.includes('ไม่ดี') || textLower.includes('ไม่ค่อย')) {
            analysis.sentiment = 'Negative';
            analysis.urgency = 'High';
            analysis.category = 'พนักงานและการบริการ';
            analysis.action_recommendation = 'ประสานงานผู้จัดการสาขาตรวจสอบ อบรม และปรับปรุงทักษะการให้บริการ/แนะนำลูกค้าของพนักงานด่วน';
            return analysis;
        }
    }

    // กฎที่ 3: ความสะอาด สถานที่ กลิ่นอับ และแสงสว่าง
    if (['เหม็น', 'เหม็นอับ', 'อับ', 'สกปรก', 'ขยะ', 'ห้องน้ำ', 'ไฟ', 'มืด', 'สว่าง', 'ไม่มีไฟ'].some(k => textLower.includes(k)) && !textLower.includes('จอดำ') && !textLower.includes('หนัง')) {
        analysis.category = 'ความสะอาดและสถานที่';
        if (hasNegative || ['เหม็น', 'เหม็นอับ', 'อับ', 'มืด', 'ไม่มีไฟ', 'สกปรก'].some(k => textLower.includes(k))) {
            analysis.sentiment = 'Negative';
            analysis.urgency = 'High';
            
            if (['เหม็น', 'เหม็นอับ', 'อับ', 'สกปรก', 'ขยะ'].some(k => textLower.includes(k))) {
                analysis.action_recommendation = 'แจ้งแม่บ้านและทีมทำความสะอาดเข้าตรวจสอบ อบสเปรย์ปรับอากาศ และทำความสะอาดพื้นที่ทันที';
            } else {
                analysis.action_recommendation = 'แจ้งทีมช่างอาคาร/เจ้าหน้าที่สถานที่เข้าตรวจสอบและแก้ไขระบบแสงสว่างในโรงภาพยนตร์ด่วน';
            }
            return analysis;
        }
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

    // กฎที่ 5: หนังไม่ฉาย / จอดำ / ไม่มีเสียง
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

    // กฎที่ 7: คำชมชัดเจน
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

    if (hasNegative && analysis.sentiment === 'Neutral') {
        analysis.sentiment = 'Negative';
        analysis.urgency = 'High';
        if (!analysis.action_recommendation || analysis.action_recommendation.includes('ขอบคุณสำหรับข้อเสนอแนะ')) {
            analysis.action_recommendation = 'แจ้งทีมงานผู้ดูแลส่วนงานที่เกี่ยวข้องเข้าตรวจสอบและดำเนินการแก้ไขปัญหาด่วน';
        }
    }

    return analysis;
}

/**
 * 2. ระบบจำแนกสำรอง (Fallback Algorithm)
 */
function getDefaultAnalysis(text) {
    const textLower = text.toLowerCase();

    const isPositive = ['ดีมาก', 'ดีเยี่ยม', 'ประทับใจ', 'ชมเชย', 'สุดยอด', 'สะอาด', 'หอม', 'กรอบ', 'พูดจาดี', 'ยิ้มแย้ม', 'น่ารัก'].some(k => textLower.includes(k));
    const isNegative = ['ไม่ค่อยดี', 'ไม่ดี', 'ไม่โอเค', 'ตะคอก', 'ตะโกน', 'ด่า', 'ขึ้นเสียง', 'หน้าบึ้ง', 'ชักสีหน้า', 'ไม่ยิ้ม', 'แย่', 'ห่วย', 'ช้า', 'พัง', 'เสีย', 'เหม็น', 'เหม็นอับ', 'อับ', 'สกปรก', 'หนาว', 'ร้อน', 'อบอ้าว', 'ไม่กรอบ', 'กระตุก', 'ดับ', 'ไม่ฉาย', 'มืด', 'ใช้ไม่ได้', 'ทำไม', 'ลืม', 'ไม่ปิด', 'สปอตไลท์', 'ไม่มีไฟ', 'ไม่มีเลย'].some(k => textLower.includes(k));

    let category = 'ทั่วไป / คำชม';
    let action = 'ขอบคุณสำหรับข้อเสนอแนะ และจะนำไปพัฒนาปรับปรุงการให้บริการต่อไป';

    if (['พนักงาน', 'บริการ', 'แนะนำ', 'ตะคอก', 'ด่า', 'ขึ้นเสียง', 'ลืม'].some(k => textLower.includes(k))) {
        category = 'พนักงานและการบริการ';
        action = 'ประสานงานผู้จัดการสาขาตรวจสอบและปรับปรุงการบริการของพนักงาน';
    } else if (['คูปอง', 'สิทธิ์', 'วอชเชอร์', 'ตั๋ว', 'แอป'].some(k => textLower.includes(k))) {
        category = 'ระบบตั๋วและแอปพลิเคชัน';
        action = 'ประสานงานทีมไอทีตรวจสอบเงื่อนไขและระบบตั๋ว/คูปอง';
    } else if (['ห้องน้ำ', 'เหม็น', 'เหม็นอับ', 'อับ', 'สกปรก', 'ขยะ', 'ไฟ', 'มืด', 'สว่าง', 'สปอตไลท์', 'ไม่มีไฟ'].some(k => textLower.includes(k))) {
        category = 'ความสะอาดและสถานที่';
        action = 'แจ้งทีมสถานที่และแม่บ้านเข้าตรวจสอบแก้ไขปัญหาความสะอาดและระบบไฟแสงสว่างด่วน';
    } else if (['แอร์', 'หนาว', 'ร้อน', 'อบอ้าว'].some(k => textLower.includes(k))) {
        category = 'ระบบปรับอากาศ (แอร์)';
        action = 'ประสานงานช่างอาคารตรวจสอบและปรับอุณหภูมิแอร์ด่วน';
    } else if (['ป๊อปคอร์น', 'ป็อบคอร์น', 'น้ำอัดลม', 'ขนม', 'อาหาร'].some(k => textLower.includes(k))) {
        category = 'อาหารและเครื่องดื่ม';
    } else if (['หนัง', 'เสียง', 'ภาพ', 'จอ', 'ซับ', 'ลำโพง', 'ฉาย'].some(k => textLower.includes(k))) {
        category = 'ระบบฉายและเสียง';
        action = 'แจ้งช่างเทคนิคเข้าตรวจสอบห้องควบคุมการฉายด่วน';
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
1. คำว่า "เหม็นอับ", "ไม่มีไฟ", "ไฟไม่มีเลย", "ลืมปิดไฟ", "ไม่ปิดไฟ", "ใช้ไม่ได้", "พนักงาน..." ถือเป็นข้อผิดพลาด/คำร้องเรียน บังคับ sentiment: "Negative" และ urgency: "High" เสมอ!
2. ห้ามตอบ "Neutral" หรือ urgency "Low" สำหรับข้อความที่เป็นการร้องเรียน ปัญหา หรือความบกพร่องเด็ดขาด!

[การจำแนกหมวดหมู่ (category)]:
- "ความสะอาดและสถานที่": เรื่องกลิ่นเหม็น, เหม็นอับ, ไฟแสงสว่างในโรง, ไม่มีไฟ, ไฟมืด, ห้องน้ำ, ความสะอาด, เบาะ/เก้าอี้
- "พนักงานและการบริการ": เรื่องพนักงาน, พนักงานลืม..., การบริการ, การแนะนำ, คำชมพนักงาน, ตะคอก, ขึ้นเสียง
- "ระบบฉายและเสียง": เรื่องหนังไม่ฉาย, จอดำ, ภาพเบลอ, เสียงเบา/ดัง, ลลำโพง, ซับไตเติล
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
  "action_recommendation": "คำแนะนำทีมงานแบบเจาะจงการแก้ไขปัญหา"
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

function getUrgencyBadge(urgency) {
    switch (urgency) {
        case 'Critical': return { text: '🚨 CRITICAL', color: '#dc3545', headerBg: '#dc3545' };
        case 'High': return { text: '🔴 HIGH', color: '#dc3545', headerBg: '#d9534f' };
        case 'Medium': return { text: '🟠 MEDIUM', color: '#f0ad4e', headerBg: '#f0ad4e' };
        case 'Low': return { text: '🟢 LOW', color: '#28a745', headerBg: '#1DB446' };
        default: return { text: '⚪ NORMAL', color: '#6c757d', headerBg: '#6c757d' };
    }
}

/**
 * 4. ฟังก์ชันส่ง LINE Push Alert ด้วย Flex Message
 */
async function sendLinePushAlert(customerText, name, phone, formattedDate, analysis) {
    const channelToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const targetId = process.env.LINE_TARGET_ID;

    if (!channelToken || !targetId) return;

    const urgencyInfo = getUrgencyBadge(analysis.urgency);
    const customerInfo = `${name || 'ไม่ระบุชื่อ'} (${phone || 'ไม่ระบุเบอร์โทร'})`;
    const ticketId = Date.now().toString().slice(-6); // สุ่ม Ticket ID ย่อย

    // สร้าง โครงสร้าง LINE Flex Message
    const flexPayload = {
        type: "flex",
        altText: `📬 Feedback ใหม่: ${analysis.summary}`,
        contents: {
            type: "bubble",
            header: {
                type: "box",
                layout: "vertical",
                contents: [
                    {
                        type: "text",
                        text: `📢 แจ้งเตือน Feedback ใหม่ (v6.4)`,
                        weight: "bold",
                        color: "#ffffff",
                        size: "sm"
                    },
                    {
                        type: "text",
                        text: "Cinema • สาขากาฬสินธุ์",
                        color: "#ffffffcc",
                        size: "xs",
                        margin: "xs"
                    }
                ],
                backgroundColor: urgencyInfo.headerBg,
                paddingAll: "md"
            },
            body: {
                type: "box",
                layout: "vertical",
                contents: [
                    {
                        type: "box",
                        layout: "horizontal",
                        contents: [
                            { type: "text", text: "👤 ผู้ส่ง:", size: "xs", color: "#8c8c8c", flex: 2 },
                            { type: "text", text: customerInfo, size: "xs", color: "#111111", weight: "bold", flex: 5, wrap: true }
                        ]
                    },
                    {
                        type: "box",
                        layout: "horizontal",
                        contents: [
                            { type: "text", text: "📅 เวลา:", size: "xs", color: "#8c8c8c", flex: 2 },
                            { type: "text", text: formattedDate, size: "xs", color: "#111111", flex: 5 }
                        ],
                        margin: "xs"
                    },
                    { type: "separator", margin: "md" },
                    {
                        type: "box",
                        layout: "vertical",
                        contents: [
                            { type: "text", text: "💬 ข้อความที่ได้รับ:", size: "xs", color: "#8c8c8c" },
                            { type: "text", text: `"${customerText}"`, size: "sm", color: "#111111", weight: "bold", wrap: true, margin: "xs" }
                        ],
                        margin: "md",
                        backgroundColor: "#f8f9fa",
                        paddingAll: "md",
                        cornerRadius: "md"
                    },
                    {
                        type: "box",
                        layout: "vertical",
                        contents: [
                            { type: "text", text: "🤖 ผลการวิเคราะห์โดย AI", size: "xs", color: "#111111", weight: "bold" },
                            {
                                type: "box",
                                layout: "horizontal",
                                contents: [
                                    { type: "text", text: `Sentiment: ${analysis.sentiment}`, size: "xs", color: "#555555" },
                                    { type: "text", text: urgencyInfo.text, size: "xs", color: urgencyInfo.color, align: "end", weight: "bold" }
                                ],
                                margin: "xs"
                            },
                            { type: "text", text: `🏷️ หมวดหมู่: ${analysis.category}`, size: "xs", color: "#555555", margin: "xs" },
                            { type: "text", text: `💡 คำแนะนำ: ${analysis.action_recommendation}`, size: "xs", color: "#555555", wrap: true, margin: "xs" }
                        ],
                        margin: "md"
                    }
                ]
            },
            footer: {
                type: "box",
                layout: "vertical",
                contents: [
                    {
                        type: "button",
                        action: {
                            type: "postback",
                            label: "☑️️ ทำการแก้ไขแล้ว",
                            data: `action=resolve&ticket_id=${ticketId}&category=${encodeURIComponent(analysis.category)}`,
                            displayText: `รับทราบ/ทำการแก้ไข Feedback (#${ticketId}) เรียบร้อยแล้ว`
                        },
                        style: "primary",
                        color: "#007bff",
                        height: "sm"
                    }
                ]
            }
        }
    };

    try {
        await fetch('https://api.line.me/v2/bot/message/push', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${channelToken.trim()}`
            },
            body: JSON.stringify({
                to: targetId.trim(),
                messages: [flexPayload]
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

// Endpoint สำหรับ Webhook LINE (รับทั้ง ข้อความ และ ปุ่มกด Postback)
app.post('/api/webhook', async (req, res) => {
    try {
        const events = req.body.events || [];
        for (const event of events) {
            
            // 1. กรณีแอดมินกดปุ่ม "☑️ ทำการแก้ไขแล้ว" (Postback Event)
            if (event.type === 'postback') {
                const replyToken = event.replyToken;
                const postbackData = new URLSearchParams(event.postback.data);
                const ticketId = postbackData.get('ticket_id') || '';
                const category = postbackData.get('category') || '';

                if (replyToken) {
                    const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' });
                    
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
                                text: `✅ [อัปเดตสถานะ]\nFeedback ID: #${ticketId} (${decodeURIComponent(category)})\nได้รับการตรวจสอบ/แก้ไขเรียบร้อยแล้ว เมื่อเวลา ${now} น.`
                            }]
                        })
                    });
                }
            }

            // 2. กรณีพิมพ์ดึง Group ID
            if (event.type === 'message' && event.message.type === 'text') {
                const groupId = event.source.groupId;
                const replyToken = event.replyToken;
                if (groupId && replyToken && event.message.text.includes('id')) {
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