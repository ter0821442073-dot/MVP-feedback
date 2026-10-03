import express from 'express';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();

const app = express();
app.use(express.json());

// ฟังก์ชันส่งแจ้งเตือนเข้า Telegram
async function sendTelegramAlert(customerText, formattedDate) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    const message = `🚨 *แจ้งเตือน Feedback ใหม่จากลูกค้า!*

📌 *ข้อความที่ได้รับ:* 
"${customerText}"

📅 *วันที่และเวลา:* ${formattedDate}
💡 *สถานที่:* สาขากาฬสินธุ์`;

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
    // เพิ่ม timeZone: 'Asia/Bangkok' เพื่อบังคับใช้เวลาประเทศไทย (GMT+7)
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

    await sendTelegramAlert(text, formattedDate);

    res.json({ 
      success: true, 
      analysis: {
        sentiment: 'รับเรื่องแล้ว',
        urgency: 'Normal',
        category: 'ข้อเสนอแนะทั่วไป',
        summary: `${text} (บันทึกเมื่อ: ${formattedDate})`,
        
      } 
    });

  } catch (error) {
    console.error('API Error Details:', error);
    res.status(500).json({ error: `เกิดข้อผิดพลาด: ${error.message}` });
  }
});

export default app;