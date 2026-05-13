function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
function normalizeHealthScore(value, fallback = 5) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const score = n > 10 && n <= 100 ? n / 10 : n;
  return clampNumber(Number(score.toFixed(1)), 1, 10, fallback);
}
function normalizeConfidence(value, fallback = 0.65) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return clampNumber(n > 1 ? n / 100 : n, 0, 1, fallback);
}

function normalizeMatches(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 5).map(item => {
    if (typeof item === "string") return item;
    return {
      name: String(item?.name || item?.plant || "Possible match"),
      confidence: normalizeConfidence(item?.confidence, 0)
    };
  });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { imageBase64, note = "", site = "", location = "", plantType = "", expectedPlantType = "" } = req.body || {};
  if (!imageBase64) return res.status(400).json({ error: "No image provided" });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY is missing in Vercel environment variables." });

  const expected = String(expectedPlantType || plantType || "").trim();
  const context = [
    site && `Site: ${site}`,
    location && `Location/zone: ${location}`,
    expected && `Operator expected plant variety: ${expected}`,
    note && `Technician note: ${note}`
  ].filter(Boolean).join(". ");

  const prompt = `You are a senior horticulturist and plant pathologist for enterprise facility maintenance in India. Analyse the uploaded plant image for workplace plant maintenance.
${context ? `Context: ${context}` : ""}

Critical operating rule: plant variety identification must be useful but must NOT pretend certainty. If the image does not clearly show enough distinguishing features, keep health diagnosis strong but mark plant variety as uncertain.

Common workplace / campus plants in India include: Areca Palm, Rhapis Palm, Phoenix Palm, Chamaedorea Palm, ZZ Plant, Aglaonema, Dracaena Reflexa, Dracaena Marginata, Dracaena Fragrans, Ficus Lyrata, Ficus Benjamina, Money Plant / Pothos, Philodendron, Monstera, Peace Lily, Schefflera, Syngonium, Sansevieria, Croton, Ixora, Bougainvillea, Bird of Paradise, Yucca, Aralia, Fern, Bamboo Palm, Anthurium, Dieffenbachia.

Identification logic:
- Use the operator expected plant variety as a candidate, not as final truth.
- If the expected variety is visually plausible, prefer it and mention that it is visually consistent.
- If expected variety conflicts strongly with the photo, identify the more likely plant and explain briefly.
- If two or more varieties are plausible, return the most likely plant but keep confidence below 0.75 and set requires_manual_confirmation true.
- Never invent a highly specific scientific name unless the visual evidence supports it.

Health scoring logic:
- Score the plant condition independently from plant-variety confidence.
- Use 1-10 condition_score where 10 is excellent, 7+ healthy, 6-6.9 monitor, below 6 critical.
- Consider leaf condition, density/fullness, pest/disease visibility, water stress, and presentation.

Return ONLY valid JSON. No markdown. No commentary.
{
  "plant_identified": "Common name (Scientific name if confident, otherwise Common name / Unconfirmed)",
  "plant_identification_confidence": 0.74,
  "requires_manual_confirmation": true,
  "identification_basis": "Short reason based on visible leaf/shape/growth habit",
  "possible_matches": [
    {"name": "Possible match 1", "confidence": 0.74},
    {"name": "Possible match 2", "confidence": 0.52}
  ],
  "photo_quality": "Good / Acceptable / Poor - short reason",
  "plant_identified_hi": "पौधे का हिंदी नाम",
  "condition_score": 7,
  "score_breakdown": {
    "leaf_condition": 7,
    "density_fullness": 7,
    "pest_disease_visibility": 8,
    "water_stress": 6,
    "presentation": 7
  },
  "issue_detected": "One clear sentence describing the main problem",
  "issue_detected_hi": "मुख्य समस्या हिंदी में",
  "root_cause": "Most likely cause in one sentence",
  "root_cause_hi": "मुख्य कारण हिंदी में",
  "severity": "LOW",
  "symptoms_observed": ["Symptom 1", "Symptom 2", "Symptom 3"],
  "symptoms_observed_hi": ["लक्षण 1", "लक्षण 2", "लक्षण 3"],
  "immediate_action": "What to do in the next 24 hours",
  "immediate_action_hi": "अगले 24 घंटों में क्या करें",
  "treatment_plan": ["Step 1", "Step 2", "Step 3", "Step 4"],
  "treatment_plan_hi": ["चरण 1", "चरण 2", "चरण 3", "चरण 4"],
  "prevent_recurrence": "One key prevention measure",
  "prevent_recurrence_hi": "रोकथाम का उपाय",
  "follow_up_days": 5
}
Rules: condition_score and score_breakdown values must be numbers from 1 to 10. plant_identification_confidence must be 0 to 1. severity must be LOW, MEDIUM, HIGH, or CRITICAL. Hindi must be Devanagari.`;

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
        max_tokens: 2200,
        temperature: 0,
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
    if (!response.ok || data.error) return res.status(response.status || 500).json({ error: data.error?.message || "Diagnosis API failed" });

    const text = data.content?.map(block => block.text || "").join("") || "";
    const jsonText = text.replace(/```json|```/g, "").trim();
    const result = JSON.parse(jsonText);

    result.condition_score = normalizeHealthScore(result.condition_score, 5);
    result.follow_up_days = parseInt(result.follow_up_days, 10) || 7;
    result.plant_identification_confidence = normalizeConfidence(result.plant_identification_confidence, 0.65);
    result.requires_manual_confirmation = Boolean(result.requires_manual_confirmation) || result.plant_identification_confidence < 0.75;
    result.possible_matches = normalizeMatches(result.possible_matches);
    result.score_breakdown = Object.fromEntries(Object.entries(result.score_breakdown || {}).map(([key, value]) => [key, normalizeHealthScore(value, result.condition_score)]));
    result.severity = ["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(result.severity) ? result.severity : "MEDIUM";

    return res.status(200).json(result);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Diagnosis failed. Please retry with a clear plant image." });
  }
}
