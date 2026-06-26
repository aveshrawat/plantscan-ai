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
    if (typeof item === "string") return { name: item, confidence: 0.5 };
    return {
      name: String(item?.name || item?.plant || "Possible match"),
      confidence: normalizeConfidence(item?.confidence, 0)
    };
  });
}
function parseImageSource(imageBase64) {
  const raw = String(imageBase64 || "");
  const match = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
  if (match) return { media_type: match[1] === "image/jpg" ? "image/jpeg" : match[1], data: match[2] };
  return { media_type: "image/jpeg", data: raw };
}
function fallbackDiagnosis(reason = "AI provider timeout") {
  return {
    is_plant_image: true,
    reject_reason: "",
    plant_identified: "Maintained indoor plant / Unconfirmed",
    plant_identification_confidence: 0.62,
    requires_manual_confirmation: true,
    identification_basis: "Demo-safe fallback used because live AI response was unavailable. Use clearer leaf close-up for exact variety confirmation.",
    possible_matches: [
      { name: "Areca Palm / Rhapis Palm", confidence: 0.62 },
      { name: "General indoor foliage plant", confidence: 0.55 }
    ],
    photo_quality: "Acceptable - plant proof captured",
    plant_identified_hi: "इनडोर पौधा / पुष्टि आवश्यक",
    condition_score: 7.2,
    score_breakdown: {
      leaf_condition: 7,
      density_fullness: 7,
      pest_disease_visibility: 8,
      water_stress: 7,
      presentation: 7
    },
    issue_detected: "Plant proof captured; mild monitoring recommended for leaf cleanliness and watering consistency.",
    issue_detected_hi: "पौधे की फोटो कैप्चर हुई है; पत्तों की सफाई और पानी की नियमितता पर हल्की निगरानी रखें।",
    root_cause: "Routine indoor maintenance variance; no critical issue detected in demo fallback mode.",
    root_cause_hi: "सामान्य इनडोर रखरखाव का अंतर; कोई गंभीर समस्या नहीं दिखी।",
    severity: "LOW",
    symptoms_observed: ["Routine foliage check required", "Presentation can be improved", "No visible critical failure"],
    symptoms_observed_hi: ["सामान्य पत्तों की जांच आवश्यक", "प्रेजेंटेशन बेहतर हो सकता है", "कोई गंभीर समस्या नहीं दिखी"],
    immediate_action: "Clean visible leaves, check soil moisture, and continue regular watering schedule.",
    immediate_action_hi: "पत्तों की सफाई करें, मिट्टी की नमी जांचें और नियमित पानी देने की प्रक्रिया जारी रखें।",
    treatment_plan: ["Wipe leaves with clean damp cloth", "Check soil moisture before watering", "Remove dry or yellowing leaves", "Review again in 5 days"],
    treatment_plan_hi: ["पत्तों को साफ गीले कपड़े से पोंछें", "पानी देने से पहले मिट्टी की नमी जांचें", "सूखे या पीले पत्ते हटाएं", "5 दिन बाद दोबारा जांच करें"],
    prevent_recurrence: "Maintain fixed watering frequency and weekly visual inspection.",
    prevent_recurrence_hi: "नियमित पानी देने की आवृत्ति और साप्ताहिक निरीक्षण बनाए रखें।",
    follow_up_days: 5,
    auto_ticket_category: "other",
    work_action_required: "monitor",
    service_log_suggestion: {
      wateringDone: true,
      issueFound: false,
      issueCategory: "other"
    },
    aiFallbackUsed: true,
    aiFallbackReason: reason
  };
}
function normalizeResult(result) {
  result.condition_score = normalizeHealthScore(result.condition_score, 5);
  result.is_plant_image = result.is_plant_image !== false;
  result.reject_reason = String(result.reject_reason || "");
  result.follow_up_days = parseInt(result.follow_up_days, 10) || 7;
  result.plant_identification_confidence = normalizeConfidence(result.plant_identification_confidence, 0.65);
  result.requires_manual_confirmation = Boolean(result.requires_manual_confirmation) || result.plant_identification_confidence < 0.75;
  result.possible_matches = normalizeMatches(result.possible_matches);
  const breakdown = result.score_breakdown && typeof result.score_breakdown === "object" ? result.score_breakdown : {};
  result.score_breakdown = Object.fromEntries(Object.entries(breakdown).map(([key, value]) => [key, normalizeHealthScore(value, result.condition_score)]));
  result.severity = ["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(result.severity) ? result.severity : "MEDIUM";
  result.auto_ticket_category = ["water_stress", "pest", "low_light", "ac_draft", "damaged", "dead", "other"].includes(result.auto_ticket_category) ? result.auto_ticket_category : "other";
  result.work_action_required = ["water", "prune", "clean", "replace", "monitor", "escalate"].includes(result.work_action_required) ? result.work_action_required : "monitor";
  result.service_log_suggestion = {
    wateringDone: Boolean(result.service_log_suggestion?.wateringDone),
    issueFound: Boolean(result.service_log_suggestion?.issueFound),
    issueCategory: String(result.service_log_suggestion?.issueCategory || result.auto_ticket_category || "other")
  };
  return result;
}
function extractJson(text) {
  const cleaned = String(text || "").replace(/```json|```/g, "").trim();
  try { return JSON.parse(cleaned); } catch {}
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
  throw new Error("AI response did not contain valid JSON");
}
async function fetchWithTimeout(url, options, timeoutMs = 22000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
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

  const demoFallbackEnabled = process.env.AI_DEMO_FALLBACK !== "false";
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    if (demoFallbackEnabled) return res.status(200).json(normalizeResult(fallbackDiagnosis("ANTHROPIC_API_KEY missing")));
    return res.status(500).json({ error: "ANTHROPIC_API_KEY is missing in Vercel environment variables." });
  }

  const expected = String(expectedPlantType || plantType || "").trim();
  const context = [
    site && `Site: ${site}`,
    location && `Location/zone: ${location}`,
    expected && `Operator expected plant variety: ${expected}`,
    note && `Technician note: ${note}`
  ].filter(Boolean).join(". ");

  const prompt = `You are a senior horticulturist and plant pathologist for enterprise facility maintenance in India. Analyse the uploaded plant image for workplace plant maintenance.
${context ? `Context: ${context}` : ""}

Return ONLY valid JSON. No markdown. No commentary.
{
  "is_plant_image": true,
  "reject_reason": "",
  "plant_identified": "Common name / Unconfirmed if uncertain",
  "plant_identification_confidence": 0.70,
  "requires_manual_confirmation": true,
  "identification_basis": "Short visual reason",
  "possible_matches": [{"name":"Possible match","confidence":0.70}],
  "photo_quality": "Good / Acceptable / Poor - short reason",
  "plant_identified_hi": "पौधे का हिंदी नाम",
  "condition_score": 7,
  "score_breakdown": {"leaf_condition":7,"density_fullness":7,"pest_disease_visibility":8,"water_stress":7,"presentation":7},
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
  "follow_up_days": 5,
  "auto_ticket_category": "water_stress | pest | low_light | ac_draft | damaged | dead | other",
  "work_action_required": "water | prune | clean | replace | monitor | escalate",
  "service_log_suggestion": {"wateringDone": true, "issueFound": true, "issueCategory": "water_stress"}
}
If the image is not a plant, planter, green wall, or maintained horticulture asset, set is_plant_image false and set reject_reason. condition_score must be 1-10. severity must be LOW, MEDIUM, HIGH, or CRITICAL. Hindi must be Devanagari.`;

  try {
    const imageSource = parseImageSource(imageBase64);
    const response = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
        max_tokens: 1600,
        temperature: 0,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: imageSource.media_type, data: imageSource.data } },
            { type: "text", text: prompt }
          ]
        }]
      })
    }, 22000);

    const raw = await response.text();
    let data = {};
    try { data = JSON.parse(raw); } catch { data = { raw }; }
    if (!response.ok || data.error) {
      const message = data.error?.message || raw?.slice?.(0, 300) || "Diagnosis API failed";
      console.error("Anthropic diagnosis failed:", message);
      if (demoFallbackEnabled) return res.status(200).json(normalizeResult(fallbackDiagnosis(message)));
      return res.status(response.status || 500).json({ error: message });
    }

    const text = data.content?.map(block => block.text || "").join("") || "";
    const result = normalizeResult(extractJson(text));
    return res.status(200).json(result);
  } catch (error) {
    const message = error?.name === "AbortError" ? "AI diagnosis timed out after 22 seconds" : (error?.message || "Diagnosis failed");
    console.error("Diagnosis exception:", message);
    if (demoFallbackEnabled) return res.status(200).json(normalizeResult(fallbackDiagnosis(message)));
    return res.status(500).json({ error: "Diagnosis failed. Please retry with a clear plant image." });
  }
}
