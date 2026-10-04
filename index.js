import express from 'express';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const app = express();
app.use(express.json());

// เริ่มต้น Gemini Client
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// ฟังก์ชันวิเคราะห์ Feedback ด้วย Gemini AI
async function analyzeFeedback(customerText) {
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-3.8-flash',
            contents: `วิเคราะห์ข้อความ Feedback จากลูกค้าดังต่อไปนี้: "${customerText}"`,
            config: {
                systemInstruction: `คุณคือ AI วิเคราะห์ Feedback ลูกค้าของร้านค้า ให้ประเมินระดับ Sentiment (เชิงบวก/เชิงลบ/ปานกลาง), ความเร่งด่วน (Low/Normal/High/Urgent), หมวดหมู่เรื่องร้องเรียน/เสนอแนะ, สรุปใจความสำคัญ และคำแนะนำในการดำเนินการต่อ`,
                responseMimeType: 'application/json',
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        sentiment: { 
                            type: Type.STRING, 
                            description: 'เช่น เชิงบวก (Positive), เชิงลบ (Negative), หรือ ปานกลาง (Neutral)' 
                        },
                        urgency: { 
                            type: Type.STRING, 
                            description: 'Low, Normal, High, หรือ Urgent' 
                        },
                        category: { 
                            type: Type.STRING, 
                            description: 'เช่น การบริการ, คุณภาพสินค้า, ความสะอาด, ราคา, หรือ ข้อเสนอแนะทั่วไป' 
                        },
                        summary: { 
                            type: Type.STRING, 
                            description: 'สรุปประเด็นหลักสั้นๆ ไม่เกิน 1-2 ประโยค' 
                        },
                        action_recommendation: { 
                            type: Type.STRING, 
                            description: 'คำแนะนำเบื้องต้นสำหรับผู้จัดการร้านในการรับมือหรือแก้ไขปัญหา' 
                        }
                    },
                    required: ['sentiment', 'urgency', 'category', 'summary', 'action_recommendation']
                }
            }
        });

        return JSON.parse(response.text);
    } catch (error) {
        console.error('❌ AI Analysis Error:', error);
        return {
            sentiment: 'ปานกลาง (Neutral)',
            urgency: 'Normal',
            category: 'ข้อเสนอแนะทั่วไป',
            summary: customerText,
            action_recommendation: 'ตรวจสอบข้อความโดยตรง'
        };
    }
}

// ฟังก์ชันช่วยกำหนดสีและ Emoji ตามสถานะ Sentiment
function getSentimentMetadata(sentimentStr) {
    const text = (sentimentStr || '').toLowerCase();
    
    if (text.includes('บวก') || text.includes('positive')) {
        return {
            emoji: '🟢',
            color: '#16a34a',      // สีข้อความเข้ม (อ่านง่ายบนพื้นขาว)
            bg_color: '#dcfce7',   // สีพื้นหลังกล่อง (เขียวอ่อน)
            border_color: '#bbf7d0'
        };
    } else if (text.includes('ลบ') || text.includes('negative')) {
        return {
            emoji: '🔴',
            color: '#dc2626',      // สีแดงเข้ม (อ่านง่ายบนพื้นขาว)
            bg_color: '#fee2e2',   // สีพื้นหลังกล่อง (แดงอ่อน)
            border_color: '#fecaca'
        };
    } else {
        return {
            emoji: '🟡',
            color: '#d97706',      // สีส้ม/น้ำตาลทอง (อ่านง่ายบนพื้นขาว)
            bg_color: '#fef3c7',   // สีพื้นหลังกล่อง (ส้มอ่อน)
            border_color: '#fde68a'
        };
    }
}

// ฟังก์ชันส่งแจ้งเตือนเข้า Telegram
async function sendTelegramAlert(customerText, formattedDate, aiAnalysis, sentimentMeta) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    // เลือก Emoji กำหนดความเร่งด่วน
    const urgencyEmoji = aiAnalysis.urgency === 'Urgent' || aiAnalysis.urgency === 'High' ? '🔴' : '🟢';

    const message = `🚨 *แจ้งเตือน Feedback ใหม่จากลูกค้า!*

📌 *ข้อความที่ได้รับ:*
"${customerText}"

🤖 *ผลการวิเคราะห์โดย AI:*
• *Sentiment:* ${sentimentMeta.emoji} ${aiAnalysis.sentiment}
• *ระดับความเร่งด่วน:* ${urgencyEmoji} ${aiAnalysis.urgency}
• *หมวดหมู่:* ${aiAnalysis.category}
• *สรุปประเด็น:* ${aiAnalysis.summary}
💡 *คำแนะนำการดำเนินการ:* ${aiAnalysis.action_recommendation}

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
        console.error('❌ Fetch Error:', err);
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

        // 1. วิเคราะห์ข้อมูลด้วย AI
        const aiAnalysis = await analyzeFeedback(text);

        // 2. คำนวณสีและ Emoji สำหรับ Sentiment
        const sentimentMeta = getSentimentMetadata(aiAnalysis.sentiment);

        // 3. ส่งแจ้งเตือนเข้า Telegram
        await sendTelegramAlert(text, formattedDate, aiAnalysis, sentimentMeta);

        // 4. ตอบกลับ API ด้วยข้อมูลจริงพร้อมรหัสสีสำหรับ Frontend
        res.json({
            success: true,
            analysis: {
                ...aiAnalysis,
                sentiment_style: sentimentMeta // ส่งสี (color, bg_color, border_color) ไปให้หน้าบ้านใช้เปลี่ยนสีได้ทันที
            }
        });

    } catch (error) {
        console.error('API Error Details:', error);
        res.status(500).json({ error: `เกิดข้อผิดพลาด: ${error.message}` });
    }
});

// กำหนด Port และสั่งเริ่มรัน Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});

export default app;