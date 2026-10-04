/**
 * ฟังก์ชันเรียก AI วิเคราะห์และประเมินสถานการณ์จาก Feedback (ปรับปรุงเกณฑ์การวิเคราะห์)
 */
async function analyzeFeedbackWithAI(customerText) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.warn('⚠️ GEMINI_API_KEY ไม่ได้ถูกตั้งค่า ใช้ผลวิเคราะห์เริ่มต้นแทน');
        return getDefaultAnalysis(customerText);
    }

    const prompt = `คุณคือผู้เชี่ยวชาญด้านการวิเคราะห์ความพึงพอใจของลูกค้าและการบริหารจัดการบริการ (Customer Service AI)

หน้าที่ของคุณคือวิเคราะห์ข้อความ Feedback ต่อไปนี้ แล้วประเมินผลอย่างแม่นยำตามหลักเกณฑ์ที่กำหนด:

ข้อความจากลูกค้า: "${customerText}"

---
เกณฑ์การประเมิน:
1. sentiment:
   - "Positive": คำชม เรื่องดีๆ ประทับใจในการบริการ/สินค้า
   - "Negative": คำติ ข้อร้องเรียน ปัญหา ความไม่พอใจ ร้อน รอนาน อร่อยน้อยลง พนักงานพูดจาไม่ดี
   - "Neutral": คำถามทั่วไป ข้อเสนอแนะกลางๆ ที่ไม่มีอารมณ์บวกหรือลบ

2. urgency:
   - "Critical": ปัญหาร้ายแรงฉุกเฉินที่กระทบความสบายอย่างมาก เช่น อากาศร้อนมาก แอร์เสีย/ไม่เย็น สิ่งสกปรก อาหารมีสิ่งแปลกปลอม อันตราย
   - "High": ปัญหาส่งผลกระทบต่อความพึงพอใจสูง เช่น รอนานมาก พนักงานแสดงกิริยาไม่ดี สินค้าผิดพลาด
   - "Medium": ข้อร้องเรียนเล็กน้อย หรือปัญหาที่ปรับปรุงได้ทั่วไป
   - "Low": คำชมเชย ข้อเสนอแนะทั่วไปที่ไม่รีบด่วน

3. category: ระบุหมวดหมู่ เช่น "สภาพแวดล้อม/สถานที่", "การบริการของพนักงาน", "คุณภาพสินค้า/อาหาร", "ระยะเวลาการรอ", "อื่นๆ"
4. summary: สรุปปัญหา/คำชมสั้นๆ ใน 1 ประโยค
5. action_recommendation: คำแนะนำการดำเนินการแก้ไขหรือรับมือสำหรับผู้จัดการร้าน

---
ตัวอย่างการวิเคราะห์:
- ถ้าลูกค้าบอก: "ในโรงร้อนมาก"
  ตอบ JSON: {"sentiment": "Negative", "urgency": "Critical", "category": "สภาพแวดล้อม/สถานที่", "summary": "สภาพแวดล้อมภายในโรงร้อนมากกระทบลูกค้า", "action_recommendation": "ตรวจสอบระบบเครื่องปรับอากาศหรือพัดลมระบายอากาศด่วนที่สุด"}

- ถ้าลูกค้าบอก: "พนักงานบริการดีมากครับ"
  ตอบ JSON: {"sentiment": "Positive", "urgency": "Low", "category": "การบริการของพนักงาน", "summary": "ลูกค้าชื่นชมการบริการของพนักงาน", "action_recommendation": "ส่งต่อคำชมให้พนักงานเพื่อเป็นกำลังใจในการทำงาน"}

---
คำสั่ง: กรุณาตอบกลับเป็นรูปแบบ JSON ภาษาไทยเท่านั้น ไม่ต้องใส่ข้อความเกริ่นหรือ Markdown ใดๆ:
{
  "sentiment": "Positive" | "Neutral" | "Negative",
  "urgency": "Low" | "Medium" | "High" | "Critical",
  "category": "string",
  "summary": "string",
  "action_recommendation": "string"
}`;

    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        responseMimeType: 'application/json'
                    }
                })
            }
        );

        const data = await response.json();
        const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (aiText) {
            // ทำความสะอาดข้อความเผื่อ AI ใส่ markdown code block มา
            const cleanJsonText = aiText.replace(/```json/g, '').replace(/```/g, '').trim();
            return JSON.parse(cleanJsonText);
        } else {
            console.error('❌ AI Response Format Error:', JSON.stringify(data));
            return getDefaultAnalysis(customerText);
        }
    } catch (err) {
        console.error('❌ AI Analysis Error:', err);
        return getDefaultAnalysis(customerText);
    }
}