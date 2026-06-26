function parseImageDataUrl(imageBase64) {
  const raw = String(imageBase64 || "").trim();
  const match = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
  if (match) {
    const mime = match[1] === "image/jpg" ? "image/jpeg" : match[1];
    return `data:${mime};base64,${match[2]}`;
  }
  return `data:image/jpeg;base64,${raw}`;
}
function fetchWithTimeout(url, options = {}, timeoutMs = 35000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}
function extractJson(text) {
  const raw = String(text || "").replace(/```json|```/g, "").trim();
  try { return JSON.parse(raw); } catch {}
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
  throw new Error("AI response was not valid JSON");
}
function dedupeModels(models) {
  return [...new Set(models.filter(Boolean).map(String))];
}
async function callOpenAIChat({ apiKey, models, messages, maxTokens = 500 }) {
  let lastError = "OpenAI verification failed";
  for (const model of dedupeModels(models)) {
    const response = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, temperature: 0, max_completion_tokens: maxTokens })
    });
    const raw = await response.text();
    let data = {};
    try { data = JSON.parse(raw); } catch { data = { raw }; }
    if (response.ok && !data.error) return data.choices?.[0]?.message?.content || data.output_text || "";
    lastError = data.error?.message || raw?.slice?.(0, 400) || `OpenAI failed for ${model}`;
    const lower = String(lastError).toLowerCase();
    if (!lower.includes("model") && !lower.includes("not found") && !lower.includes("unsupported") && !lower.includes("access") && !lower.includes("permission")) break;
  }
  throw new Error(lastError);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { imageBase64 } = req.body || {};
  if (!imageBase64) return res.status(400).json({ error: "No image provided" });
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "OPENAI_API_KEY is missing in Vercel environment variables." });

  const prompt = `You are verifying closure evidence for an enterprise plant maintenance ticket.
The user must upload a clear after-service photo showing a plant, planter, green wall, or landscape zone.
Assess whether the uploaded image is credible closure evidence and whether the visible plant/greenery condition is acceptable after service.
Use an internal health quality threshold equivalent to better than 6/10, but DO NOT return any score.
Reject images that are not plants/greenery, are too blurry, show unrelated objects, or show visibly unhealthy/dead plants.
Return ONLY valid JSON. No markdown. No commentary.
{
  "accepted": true,
  "plant_visible": true,
  "health_ok": true,
  "reason": "Short reason visible to operations team"
}`;

  try {
    const text = await callOpenAIChat({
      apiKey: process.env.OPENAI_API_KEY,
      models: [process.env.OPENAI_VISION_MODEL, process.env.OPENAI_MODEL, "gpt-5.5", "gpt-5.4", "gpt-5.4-mini"],
      messages: [
        { role: "system", content: "You verify plant maintenance closure proof. Return only valid JSON." },
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: parseImageDataUrl(imageBase64), detail: "high" } }
          ]
        }
      ]
    });
    const result = extractJson(text);
    const accepted = Boolean(result.accepted && result.plant_visible && result.health_ok);
    return res.status(200).json({
      accepted,
      plant_visible: Boolean(result.plant_visible),
      health_ok: Boolean(result.health_ok),
      reason: result.reason || (accepted ? "Closure photo accepted." : "Closure photo not accepted.")
    });
  } catch (error) {
    console.error("OpenAI evidence verification failed:", error?.message || error);
    return res.status(500).json({ error: "Evidence verification failed. Please retry with a clear after-service plant photo." });
  }
}
