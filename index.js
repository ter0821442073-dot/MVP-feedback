// ฟังก์ชันเรียก AI วิเคราะห์ (เวอร์ชันแก้ไข Error และเสถียร 100%)
async function analyzeFeedbackWithAI(customerText) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return getDefaultAnalysis(customerText);

    const promptText = `คุณคือ AI วิเคราะห์ความคิดเห็นลูกค้าสำหรับธุรกิจโรงภาพยนตร์
วิเคราะห์ข้อความนี้: "${customerText}"

หมวดหมู่ (category):
1. ระบบฉายและเสียง (จอภาพ, ภาพเบลอ, เสียง, แอร์ไม่เย็น)
2. ความสะอาดและสถานที่ (เบาะ, กลิ่น, ห้องน้ำ)
3. อาหารและเครื่องดื่ม (ป๊อปคอร์น, น้ำ)
4. พนักงานและการบริการ
5. ระบบตั๋วและแอปพลิเคชัน
6. พฤติกรรมลูกค้าท่านอื่น
7. ทั่วไป / คำชม

ระดับความเร่งด่วน (urgency):
- Critical: แอร์ดับ/ร้อนมาก, หนังสะดุด/กระตุก/ดับ, เพลิงไหม้, อาหารเสีย
- High: ตัดเงินไม่ได้ตั๋ว, พนักงานพูดจาหยาบคาย, กลิ่นเหม็นรุนแรง
- Medium: ป๊อปคอร์นเหนียว, แถวยาว, คนข้างๆ เสียงดัง
- Low: คำชม หรือ ข้อเสนอแนะทั่วไป

ตอบกลับเป็น JSON รูปแบบนี้เท่านั้น (ห้ามมีข้อความอื่นนอกวงเล็บปักกิ่ง):
{
  "sentiment": "Positive" | "Neutral" | "Negative",
  "urgency": "Low" | "Medium" | "High" | "Critical",
  "category": "ชื่อหมวดหมู่",
  "summary": "สรุป 1 ประโยค",
  "action_recommendation": "คำแนะนำสำหรับผู้จัดการ"
}`;

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 7000);

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
                contents: [{ parts: [{ text: promptText }] }]
            })
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            console.error('Gemini API Error Status:', response.status);
            return getDefaultAnalysis(customerText);
        }

        const data = await response.json();
        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawText) return getDefaultAnalysis(customerText);

        // แกะ JSON ออกจาก Markdown codeblock เช่น ```json ... ```
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
        
        return getDefaultAnalysis(customerText);

    } catch (err) {
        console.error('AI Analysis Exception:', err);
        return getDefaultAnalysis(customerText); // ส่งค่า Default แทนการให้ Server พัง
    }
}