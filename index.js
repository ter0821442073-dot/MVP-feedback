// ฟังก์ชันเรียก AI วิเคราะห์ (เวอร์ชันปรับปรุงสำหรับโรงภาพยนตร์)
async function analyzeFeedbackWithAI(customerText) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return getDefaultAnalysis(customerText);

    const promptText = `คุณคือ AI วิเคราะห์ความคิดเห็นลูกค้าสำหรับ "ธุรกิจโรงภาพยนตร์" (Cinema) 
หน้าที่ของคุณคืออ่านข้อความติชมจากลูกค้า และสกัดข้อมูลออกมาตามโครงสร้าง JSON ที่กำหนด

### หมวดหมู่ที่ใช้ตอบ (category):
1. "ระบบฉายและเสียง" (จอภาพ, ภาพเบลอ, สีเพี้ยน, เสียงเบา/ดังไป, ซับไตเติลหาย, แอร์ไม่เย็น)
2. "ความสะอาดและสถานที่" (เบาะสกปรก, พื้นเหนียว, กลิ่นเหม็น, ห้องน้ำ, ขยะ)
3. "อาหารและเครื่องดื่ม" (ป๊อปคอร์นเหนียว/เค็ม/เย็น, น้ำอัดลมไม่มีงวด, รอนาน, อาหารเสีย)
4. "พนักงานและการบริการ" (พูดจาไม่ดี, ชักสีหน้า, คิดเงินผิด, แนะนำไม่ดี, แถวยาว)
5. "ระบบตั๋วและแอปพลิเคชัน" (จองตั๋วไม่ได้, ตู้ตั๋วเสีย, ตัดเงินแต่ไม่ได้ตั๋ว, สแกนไม่ผ่าน)
6. "พฤติกรรมลูกค้าท่านอื่น" (คุยเสียงดัง, เล่นโทรศัพท์, เอาเท้าพาด, เด็กร้องไห้)
7. "ทั่วไป / คำชม" (ชมเชย, เสนอแนะทั่วไป)

### กฎการวิเคราะห์ระดับความเร่งด่วน (urgency) และ ความรู้สึก (sentiment):
- **Critical**: เหตุการณ์ที่กระทบต่อการรับชมทันที หรือความปลอดภัย เช่น แอร์ดับ/ร้อนมาก, หนังกระตุก/ดับกลางคราว, ภาพ/เสียงเสีย, เพลิงไหม้/อันตราย, อาหารเสียเน่าเสีย
- **High**: เหตุการณ์ที่ทำให้ลูกค้าเสียอารมณ์อย่างมาก หรือมีปัญหาระบบเงิน เช่น คิดเงินผิด/ตัดเงินไม่ได้ตั๋ว, พนักงานแสดงกิริยาหยาบคายมาก, ห้องน้ำส่งกลิ่นเหม็นรุนแรง, ป๊อปคอร์นมีสิ่งแปลกปลอม
- **Medium**: ข้อติชมทั่วไปเกี่ยวกับการบริการ, ความสะอาดเล็กน้อย, แถวยาว, ป๊อปคอร์นไม่อร่อย, ลูกค้าคนอื่นส่งเสียงดัง
- **Low**: คำชมเชย, ข้อเสนอแนะทั่วไปที่ไม่กระทบการบริการปัจจุบัน

### เงื่อนไขการตอบกลับ:
- ตอบกลับเป็น JSON ภาษาไทย รูปแบบนี้เท่านั้น ห้ามใส่ข้อความอื่นนอกเหนือจาก JSON
{
  "sentiment": "Positive" | "Neutral" | "Negative",
  "urgency": "Low" | "Medium" | "High" | "Critical",
  "category": "ระบุ 1 หมวดหมู่จากด้านบน",
  "summary": "สรุปใจความสำคัญใน 1 ประโยคสั้นๆ",
  "action_recommendation": "คำแนะนำสั้นๆ สำหรับผู้จัดการโรงหนังในการแก้ไขปัญหา"
}

ข้อความของลูกค้า: "${customerText}"`;

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000); // ขยายเวลาเป็น 6 วิเพื่อความเสถียร

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
                contents: [{ parts: [{ text: promptText }] }],
                // ปรับ Temperature ต่ำลงเพื่อให้ AI ตอบแม่นยำตามสั่ง ไม่มโน
                generationConfig: {
                    temperature: 0.1,
                    responseMimeType: "application/json" // บังคับคืนค่าเป็น JSON
                }
            })
        });

        clearTimeout(timeoutId);
        if (!response.ok) return getDefaultAnalysis(customerText);

        const data = await response.json();
        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawText) return getDefaultAnalysis(customerText);

        return JSON.parse(rawText);

    } catch (err) {
        console.error('AI Analysis Error:', err);
        return getDefaultAnalysis(customerText);
    }
}