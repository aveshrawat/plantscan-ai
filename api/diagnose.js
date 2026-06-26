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
function fallbackDiagnosis(reason = "AI provider timeout", imageStats = {}) {
  const stressRatio = clampNumber(imageStats.stressRatio, 0, 1, 0);
  const brownYellowRatio = clampNumber(imageStats.brownYellowRatio, 0, 1, 0);
  const greenRatio = clampNumber(imageStats.greenRatio, 0, 1, 0);
  const weakImageStats = !Number.isFinite(Number(imageStats.stressRatio));
  const criticalStress = !weakImageStats && (stressRatio >= 0.45 || brownYellowRatio >= 0.28 || greenRatio < 0.18);
  const moderateStress = !weakImageStats && !criticalStress && (stressRatio >= 0.25 || brownYellowRatio >= 0.14 || greenRatio < 0.28);

  if (criticalStress) {
    return {
      is_plant_image: true,
      reject_reason: "",
      plant_identified: "Indoor foliage plant / Manual variety confirmation required",
      plant_identification_confidence: 0.58,
      requires_manual_confirmation: true,
      identification_basis: "Health assessment prioritised over exact variety because visible leaf condition requires action.",
      possible_matches: [
        { name: "Indoor foliage plant", confidence: 0.58 },
        { name: "Peace lily / broad-leaf indoor plant", confidence: 0.44 }
      ],
      photo_quality: "Acceptable - plant health symptoms visible",
      plant_identified_hi: "इनडोर पत्तेदार पौधा / किस्म की पुष्टि आवश्यक",
      condition_score: 2.8,
      score_breakdown: {
        leaf_condition: 2.2,
        density_fullness: 3.0,
        pest_disease_visibility: 5.5,
        water_stress: 2.0,
        presentation: 2.5
      },
      issue_detected: "Severe wilting with brown/yellow drying leaves; plant is in poor condition and needs urgent recovery or replacement decision.",
      issue_detected_hi: "पत्ते गंभीर रूप से झुके हुए और भूरे/पीले होकर सूख रहे हैं; पौधे को तुरंत रिकवरी या रिप्लेसमेंट निर्णय की जरूरत है।",
      root_cause: "Most likely prolonged water stress, missed watering cycle, heat/glare exposure, or root-zone decline.",
      root_cause_hi: "संभावित कारण लंबे समय तक पानी की कमी, मिस्ड वॉटरिंग, तेज गर्मी/ग्लेयर या जड़ों की समस्या है।",
      severity: "CRITICAL",
      symptoms_observed: ["Drooping/wilted leaves", "Brown and yellow dry foliage", "Poor presentation value", "Possible irreversible decline"],
      symptoms_observed_hi: ["पत्ते झुके/मुरझाए हुए", "भूरे और पीले सूखे पत्ते", "प्रेजेंटेशन बहुत कमजोर", "संभवतः रिकवरी कठिन"],
      immediate_action: "Move plant out of harsh light, check root-zone moisture immediately, prune dead foliage, and escalate for replacement if recovery is unlikely.",
      immediate_action_hi: "पौधे को तेज रोशनी से हटाएं, जड़ों के पास नमी तुरंत जांचें, सूखे पत्ते काटें और रिकवरी मुश्किल हो तो रिप्लेसमेंट के लिए एस्केलेट करें।",
      treatment_plan: ["Check soil/root-zone moisture immediately", "Remove dead and fully dried leaves", "Shift away from direct glare or AC draft", "Deep water only if soil is dry; avoid waterlogging", "Mark for supervisor review/replacement within 24 hours"],
      treatment_plan_hi: ["मिट्टी/जड़ों की नमी तुरंत जांचें", "पूरी तरह सूखे पत्ते हटाएं", "सीधी धूप/ग्लेयर या AC ड्राफ्ट से दूर रखें", "मिट्टी सूखी हो तभी गहरा पानी दें; पानी भराव न करें", "24 घंटे में सुपरवाइजर रिव्यू/रिप्लेसमेंट के लिए मार्क करें"],
      prevent_recurrence: "Add watering-cycle verification and weekly stress audit for plants near windows, glare, or AC airflow.",
      prevent_recurrence_hi: "खिड़की, ग्लेयर या AC airflow के पास रखे पौधों के लिए watering-cycle verification और weekly stress audit जोड़ें।",
      follow_up_days: 1,
      auto_ticket_category: "water_stress",
      work_action_required: "escalate",
      service_log_suggestion: {
        wateringDone: false,
        issueFound: true,
        issueCategory: "water_stress"
      },
      aiFallbackUsed: true,
      aiFallbackReason: reason
    };
  }

  if (moderateStress) {
    return {
      is_plant_image: true,
      reject_reason: "",
      plant_identified: "Indoor foliage plant / Manual variety confirmation required",
      plant_identification_confidence: 0.6,
      requires_manual_confirmation: true,
      identification_basis: "Health assessment prioritised over exact variety because stress indicators are visible.",
      possible_matches: [{ name: "Indoor foliage plant", confidence: 0.6 }],
      photo_quality: "Acceptable - plant health symptoms visible",
      plant_identified_hi: "इनडोर पत्तेदार पौधा / पुष्टि आवश्यक",
      condition_score: 5.4,
      score_breakdown: { leaf_condition: 5, density_fullness: 5.5, pest_disease_visibility: 7, water_stress: 5, presentation: 5 },
      issue_detected: "Visible leaf stress and presentation decline; corrective maintenance required.",
      issue_detected_hi: "पत्तों में stress और presentation decline दिख रहा है; corrective maintenance required है।",
      root_cause: "Likely watering inconsistency, low/high light exposure, or delayed pruning.",
      root_cause_hi: "संभावित कारण पानी की अनियमितता, light exposure issue या pruning delay है।",
      severity: "MEDIUM",
      symptoms_observed: ["Yellowing/drying leaves", "Reduced presentation quality", "Watering or placement stress likely"],
      symptoms_observed_hi: ["पीले/सूखे पत्ते", "प्रेजेंटेशन कमजोर", "पानी या placement stress संभावित"],
      immediate_action: "Prune stressed leaves, check moisture, adjust placement, and review in 48 hours.",
      immediate_action_hi: "stress वाले पत्ते prune करें, moisture check करें, placement adjust करें और 48 घंटे में review करें।",
      treatment_plan: ["Remove dry/yellowing leaves", "Check soil moisture before watering", "Inspect for AC draft or harsh light", "Review again in 2 days"],
      treatment_plan_hi: ["सूखे/पीले पत्ते हटाएं", "पानी देने से पहले मिट्टी की नमी जांचें", "AC draft या harsh light inspect करें", "2 दिन बाद review करें"],
      prevent_recurrence: "Track watering and placement stress weekly.",
      prevent_recurrence_hi: "watering और placement stress weekly track करें।",
      follow_up_days: 2,
      auto_ticket_category: "water_stress",
      work_action_required: "prune",
      service_log_suggestion: { wateringDone: false, issueFound: true, issueCategory: "water_stress" },
      aiFallbackUsed: true,
      aiFallbackReason: reason
    };
  }

  return {
    is_plant_image: true,
    reject_reason: "",
    plant_identified: "Maintained indoor plant / Manual variety confirmation required",
    plant_identification_confidence: 0.62,
    requires_manual_confirmation: true,
    identification_basis: "Plant proof captured; exact variety requires clearer leaf close-up.",
    possible_matches: [{ name: "General indoor foliage plant", confidence: 0.62 }],
    photo_quality: "Acceptable - plant proof captured",
    plant_identified_hi: "इनडोर पौधा / पुष्टि आवश्यक",
    condition_score: 7.0,
    score_breakdown: { leaf_condition: 7, density_fullness: 7, pest_disease_visibility: 8, water_stress: 7, presentation: 7 },
    issue_detected: "Plant proof captured; routine monitoring recommended.",
    issue_detected_hi: "पौधे की फोटो कैप्चर हुई है; नियमित निगरानी रखें।",
    root_cause: "Routine indoor maintenance observation.",
    root_cause_hi: "सामान्य इनडोर रखरखाव observation।",
    severity: "LOW",
    symptoms_observed: ["Routine foliage check required"],
    symptoms_observed_hi: ["सामान्य पत्तों की जांच आवश्यक"],
    immediate_action: "Continue standard maintenance and review during next service visit.",
    immediate_action_hi: "standard maintenance जारी रखें और next service visit में review करें।",
    treatment_plan: ["Wipe leaves if dusty", "Check soil moisture", "Continue watering schedule", "Review again in 5 days"],
    treatment_plan_hi: ["dust हो तो पत्ते साफ करें", "soil moisture check करें", "watering schedule जारी रखें", "5 दिन बाद review करें"],
    prevent_recurrence: "Maintain fixed watering frequency and weekly visual inspection.",
    prevent_recurrence_hi: "नियमित पानी देने की आवृत्ति और weekly inspection बनाए रखें।",
    follow_up_days: 5,
    auto_ticket_category: "other",
    work_action_required: "monitor",
    service_log_suggestion: { wateringDone: true, issueFound: false, issueCategory: "other" },
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

  const { imageBase64, note = "", site = "", location = "", plantType = "", expectedPlantType = "", imageStats = null } = req.body || {};
  if (!imageBase64) return res.status(400).json({ error: "No image provided" });

  const demoFallbackEnabled = process.env.AI_DEMO_FALLBACK !== "false";
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    if (demoFallbackEnabled) return res.status(200).json(normalizeResult(fallbackDiagnosis("ANTHROPIC_API_KEY missing", imageStats)));
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
Critical grading rule: if the plant has drooping, wilted, brown, yellow, crispy, or dried leaves, do NOT mark it healthy. Score 1-4 for severe wilting/drying, 5-6 for moderate stress, 7+ only for genuinely presentable healthy plants. Prioritise health condition over exact species identification.
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
      if (demoFallbackEnabled) return res.status(200).json(normalizeResult(fallbackDiagnosis(message, imageStats)));
      return res.status(response.status || 500).json({ error: message });
    }

    const text = data.content?.map(block => block.text || "").join("") || "";
    const result = normalizeResult(extractJson(text));
    return res.status(200).json(result);
  } catch (error) {
    const message = error?.name === "AbortError" ? "AI diagnosis timed out after 22 seconds" : (error?.message || "Diagnosis failed");
    console.error("Diagnosis exception:", message);
    if (demoFallbackEnabled) return res.status(200).json(normalizeResult(fallbackDiagnosis(message, imageStats)));
    return res.status(500).json({ error: "Diagnosis failed. Please retry with a clear plant image." });
  }
}
