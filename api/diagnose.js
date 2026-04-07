export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();
  const { imageBase64, note, site, location } = req.body;
  if (!imageBase64) return res.status(400).json({ error: "No image provided" });
  const context = [site && `Site: ${site}`, location && `Location: ${location}`, note && `Technician note: ${note}`].filter(Boolean).join(". ");
  const PROMPT = `You are an expert horticulturist and plant pathologist for a professional facility maintenance company managing 50+ commercial sites across India.
Analyse the uploaded plant photo and return a structured diagnostic report.${context ? `\nContext: ${context}` : ""}
Respond ONLY in this exact JSON format — no markdown, no extra text:
{"plant_identified":"Common name (Scientific name)","plant_identified_hi":"पौधे का हिंदी नाम","condition_score":7,"issue_detected":"One clear sentence describing the main problem","issue_detected_hi":"मुख्य समस्या हिंदी में","root_cause":"Most likely cause in one sentence","root_cause_hi":"मुख्य कारण हिंदी में","severity":"LOW","symptoms_observed":["Symptom 1","Symptom 2","Symptom 3"],"symptoms_observed_hi":["लक्षण 1","लक्षण 2","लक्षण 3"],"immediate_action":"What to do in the next 24 hours","immediate_action_hi":"अगले 24 घंटों में क्या करें","treatment_plan":["Step 1","Step 2","Step 3","Step 4"],"treatment_plan_hi":["चरण 1","चरण 2","चरण 3","चरण 4"],"prevent_recurrence":"One key prevention measure","prevent_recurrence_hi":"रोकथाम का उपाय","follow_up_days":5}
Rules: condition_score is integer 1-10. severity is LOW/MEDIUM/HIGH/CRITICAL. All Hindi in Devanagari script.`;
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1500, messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageBase64 } }, { type: "text", text: PROMPT }] }] })
    });
    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message });
    const text = data.content?.map(b => b.text || "").join("") || "";
    const result = JSON.parse(text.replace(/```json|```/g, "").trim());
    result.condition_score = parseFloat(result.condition_score) || 5;
    result.follow_up_days = parseInt(result.follow_up_days) || 7;
    res.status(200).json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Diagnosis failed. Please try again." });
  }
}
