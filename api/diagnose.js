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
function parseImageDataUrl(imageBase64) {
  const raw = String(imageBase64 || "").trim();
  const match = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
  if (match) {
    const mime = match[1] === "image/jpg" ? "image/jpeg" : match[1];
    return `data:${mime};base64,${match[2]}`;
  }
  return `data:image/jpeg;base64,${raw}`;
}
function fallbackDiagnosis(reason = "AI provider timeout", imageStats = {}) {
  const stressRatio = clampNumber(imageStats.stressRatio, 0, 1, 0);
  const brownYellowRatio = clampNumber(imageStats.brownYellowRatio, 0, 1, 0);
  const greenRatio = clampNumber(imageStats.greenRatio, 0, 1, 0);
  const weakImageStats = !Number.isFinite(Number(imageStats.stressRatio));
  const criticalStress = !weakImageStats && greenRatio < 0.22 && stressRatio >= 0.62;
  const moderateStress = !weakImageStats && !criticalStress && (
    stressRatio >= 0.24 || brownYellowRatio >= 0.12 || greenRatio < 0.34
  );

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
      service_log_suggestion: { wateringDone: false, issueFound: true, issueCategory: "water_stress" },
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
      condition_score: 5.8,
      score_breakdown: { leaf_condition: 5.6, density_fullness: 6.2, pest_disease_visibility: 7.2, water_stress: 5.4, presentation: 5.6 },
      issue_detected: "Visible leaf yellowing/wilting and presentation decline; corrective maintenance required.",
      issue_detected_hi: "पत्तों में stress और presentation decline दिख रहा है; corrective maintenance required है।",
      root_cause: "Likely watering inconsistency, light exposure stress, AC draft, or natural lower-leaf ageing.",
      root_cause_hi: "संभावित कारण पानी की अनियमितता, light exposure issue या pruning delay है।",
      severity: "MEDIUM",
      symptoms_observed: ["Yellowing/drying leaves", "Reduced presentation quality", "Watering or placement stress likely"],
      symptoms_observed_hi: ["पीले/सूखे पत्ते", "प्रेजेंटेशन कमजोर", "पानी या placement stress संभावित"],
      immediate_action: "Check soil moisture, remove only fully yellow/dry leaves, adjust placement if needed, and review in 48 hours.",
      immediate_action_hi: "stress वाले पत्ते prune करें, moisture check करें, placement adjust करें और 48 घंटे में review करें।",
      treatment_plan: ["Check soil/root-zone moisture", "Remove fully yellow or dry leaves only", "Inspect for AC draft or harsh light", "Review again in 48 hours"],
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
  const out = result && typeof result === "object" ? result : {};
  out.condition_score = normalizeHealthScore(out.condition_score ?? out.score, 5);
  out.plant_identification_confidence = normalizeConfidence(out.plant_identification_confidence ?? out.identification_confidence, 0.65);
  out.possible_matches = normalizeMatches(out.possible_matches);
  out.score_breakdown = out.score_breakdown && typeof out.score_breakdown === "object" ? out.score_breakdown : {};
  for (const key of ["leaf_condition", "density_fullness", "pest_disease_visibility", "water_stress", "presentation"]) {
    out.score_breakdown[key] = normalizeHealthScore(out.score_breakdown[key], out.condition_score);
  }
  out.severity = String(out.severity || (out.condition_score <= 4.5 ? "CRITICAL" : out.condition_score <= 6 ? "HIGH" : out.condition_score <= 7.5 ? "MEDIUM" : "LOW")).toUpperCase();
  if (!Array.isArray(out.symptoms_observed)) out.symptoms_observed = [];
  if (!Array.isArray(out.symptoms_observed_hi)) out.symptoms_observed_hi = [];
  if (!Array.isArray(out.treatment_plan)) out.treatment_plan = out.immediate_action ? [out.immediate_action] : ["Follow maintenance SOP"];
  if (!Array.isArray(out.treatment_plan_hi)) out.treatment_plan_hi = out.immediate_action_hi ? [out.immediate_action_hi] : [];
  out.is_plant_image = out.is_plant_image !== false;
  out.reject_reason ||= "";
  out.plant_identified ||= "Unconfirmed plant";
  out.photo_quality ||= "Acceptable";
  out.issue_detected ||= "Observation captured";
  out.root_cause ||= "Root cause not specified";
  out.immediate_action ||= out.treatment_plan[0] || "Follow maintenance SOP";
  out.follow_up_days = clampNumber(out.follow_up_days, 1, 30, out.condition_score <= 6 ? 2 : 5);
  out.auto_ticket_category ||= "other";
  out.work_action_required ||= out.condition_score <= 6 ? "escalate" : "monitor";
  out.service_log_suggestion ||= { wateringDone: false, issueFound: out.condition_score <= 6, issueCategory: out.auto_ticket_category };
  return out;
}
function extractJson(text) {
  const raw = String(text || "").replace(/```json|```/g, "").trim();
  try { return JSON.parse(raw); } catch {}
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
  throw new Error("AI response was not valid JSON");
}
function fetchWithTimeout(url, options = {}, timeoutMs = 45000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}
function dedupeModels(models) {
  return [...new Set(models.filter(Boolean).map(String))];
}
async function callOpenAIChat({ apiKey, models, messages, maxTokens = 1400 }) {
  let lastError = "OpenAI call failed";
  for (const model of dedupeModels(models)) {
    const response = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0,
        max_completion_tokens: maxTokens
      })
    }, 45000);
    const raw = await response.text();
    let data = {};
    try { data = JSON.parse(raw); } catch { data = { raw }; }
    if (response.ok && !data.error) {
      const text = data.choices?.[0]?.message?.content || data.output_text || "";
      if (!text) throw new Error("OpenAI returned empty diagnosis text");
      return { text, model };
    }
    lastError = data.error?.message || raw?.slice?.(0, 400) || `OpenAI failed for ${model}`;
    const lower = String(lastError).toLowerCase();
    // Only try the next model for model/access/availability-style failures.
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

  const { imageBase64, note = "", site = "", location = "", plantType = "", expectedPlantType = "", imageStats = {} } = req.body || {};
  if (!imageBase64) return res.status(400).json({ error: "No image provided" });

  const apiKey = process.env.OPENAI_API_KEY;
  const demoFallbackEnabled = process.env.AI_DEMO_FALLBACK !== "false";
  if (!apiKey) {
    if (demoFallbackEnabled) return res.status(200).json(normalizeResult(fallbackDiagnosis("OPENAI_API_KEY missing", imageStats)));
    return res.status(500).json({ error: "OPENAI_API_KEY is missing in Vercel environment variables." });
  }

  const expected = expectedPlantType || plantType || "";
  const prompt = `You are GreenOps AI Vision, used for enterprise indoor plant maintenance audits.
Assess the actual plant health from the uploaded image. Prioritise visible plant condition over exact variety identification.
Site: ${site || "Unknown"}
Location / placement bucket: ${location || "Unknown"}
Expected plant type from BOQ: ${expected || "Not provided"}
Maintenance note: ${note || "None"}

Critical grading rules:
- Score 1.0-3.5 only when the plant is mostly collapsed, dead, severely wilted, crispy/brown, or near replacement.
- Score 4.0-6.0 for visible yellowing, drooping, thinning, water stress, pest signs, dry edges, poor presentation, or corrective work needed.
- Score 6.1-7.5 for mostly acceptable plant with minor maintenance needed.
- Score 7.6-10 only for clearly healthy, full, clean, premium presentation.
- Do not mark a visibly yellowing/drooping plant as healthy.
- Do not confuse wooden floors, pots, furniture, shadows, or lighting with brown plant damage.
- If exact variety is uncertain, keep confidence modest and say manual confirmation required. Do not let variety uncertainty affect the health score.
- If condition_score is 6.0 or below, the app will auto-create an SLA ticket. Be operationally strict.

Return ONLY valid JSON. No markdown. No commentary. Required schema:
{
  "is_plant_image": true,
  "reject_reason": "",
  "plant_identified": "Common name or broad category",
  "plant_identification_confidence": 0.0,
  "requires_manual_confirmation": true,
  "identification_basis": "Short reason",
  "possible_matches": [{"name":"Plant name","confidence":0.0}],
  "photo_quality": "Good | Acceptable | Poor - reason",
  "plant_identified_hi": "हिंदी नाम",
  "condition_score": 1.0,
  "score_breakdown": {
    "leaf_condition": 1.0,
    "density_fullness": 1.0,
    "pest_disease_visibility": 1.0,
    "water_stress": 1.0,
    "presentation": 1.0
  },
  "issue_detected": "One clear operational issue sentence",
  "issue_detected_hi": "हिंदी में समस्या",
  "root_cause": "Likely root cause",
  "root_cause_hi": "हिंदी में कारण",
  "severity": "LOW | MEDIUM | HIGH | CRITICAL",
  "symptoms_observed": ["Symptom 1", "Symptom 2"],
  "symptoms_observed_hi": ["लक्षण 1", "लक्षण 2"],
  "immediate_action": "Immediate field action",
  "immediate_action_hi": "तुरंत कार्यवाही हिंदी में",
  "treatment_plan": ["Step 1", "Step 2", "Step 3", "Step 4"],
  "treatment_plan_hi": ["चरण 1", "चरण 2", "चरण 3", "चरण 4"],
  "prevent_recurrence": "One key prevention measure",
  "prevent_recurrence_hi": "रोकथाम का उपाय",
  "follow_up_days": 5,
  "auto_ticket_category": "water_stress | pest | low_light | ac_draft | damaged | dead | other",
  "work_action_required": "water | prune | clean | replace | monitor | escalate",
  "service_log_suggestion": {"wateringDone": true, "issueFound": true, "issueCategory": "water_stress"}
}
If the image is not a plant, planter, green wall, or maintained horticulture asset, set is_plant_image false and set reject_reason.`;

  try {
    const imageUrl = parseImageDataUrl(imageBase64);
    const { text, model } = await callOpenAIChat({
      apiKey,
      models: [process.env.OPENAI_VISION_MODEL, process.env.OPENAI_MODEL, "gpt-5.5", "gpt-5.4", "gpt-5.4-mini"],
      maxTokens: 1400,
      messages: [
        { role: "system", content: "You are a strict plant-health vision auditor. Return only valid JSON matching the requested schema." },
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: imageUrl, detail: "high" } }
          ]
        }
      ]
    });
    const result = normalizeResult(extractJson(text));
    result.aiProvider = "openai";
    result.aiModel = model;
    return res.status(200).json(result);
  } catch (error) {
    const message = error?.name === "AbortError" ? "OpenAI diagnosis timed out" : (error?.message || "Diagnosis failed");
    console.error("OpenAI diagnosis exception:", message);
    if (demoFallbackEnabled) return res.status(200).json(normalizeResult(fallbackDiagnosis(message, imageStats)));
    return res.status(500).json({ error: "Diagnosis failed. Please retry with a clear plant image." });
  }
}
