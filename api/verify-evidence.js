export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { imageBase64 } = req.body || {};
  if (!imageBase64) return res.status(400).json({ error: "No image provided" });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY is missing in Vercel environment variables." });

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
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
        max_tokens: 600,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageBase64 } },
            { type: "text", text: prompt }
          ]
        }]
      })
    });
    const data = await response.json();
    if (!response.ok || data.error) return res.status(response.status || 500).json({ error: data.error?.message || "Evidence verification failed" });
    const text = data.content?.map(block => block.text || "").join("") || "";
    const jsonText = text.replace(/```json|```/g, "").trim();
    const result = JSON.parse(jsonText);
    const accepted = Boolean(result.accepted && result.plant_visible && result.health_ok);
    return res.status(200).json({
      accepted,
      plant_visible: Boolean(result.plant_visible),
      health_ok: Boolean(result.health_ok),
      reason: result.reason || (accepted ? "Closure photo accepted." : "Closure photo not accepted.")
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Evidence verification failed. Please retry with a clear after-service plant photo." });
  }
}
