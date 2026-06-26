function fallbackAnswer(context = {}) {
  const q = String(context.question || "").toLowerCase();
  const s = context.summary || {};
  const invoice = context.invoice || null;
  const totals = invoice?.totals || {};
  if (q.includes("invoice") || q.includes("bill") || q.includes("credit") || q.includes("payable")) {
    if (!invoice) return "No invoice is currently available for this selected site and month in the portal data.";
    return `${invoice.invoiceNo || "Current invoice"}: base AMC ₹${Number(totals.monthlyAmc || 0).toLocaleString("en-IN")}, SLA credit ₹${Number(totals.slaCredit || 0).toLocaleString("en-IN")} for ${totals.breachedItems || 0} breached item(s), net payable ₹${Number(totals.netPayable || 0).toLocaleString("en-IN")}.`;
  }
  if (q.includes("ticket") || q.includes("pending") || q.includes("open")) return `There are ${s.openTickets || 0} open ticket(s), including ${s.p1Tickets || 0} P1 item(s). SLA-risk items: ${s.slaRisk || 0}.`;
  if (q.includes("sla") || q.includes("breach")) return `${s.slaRisk || 0} item(s) are currently at SLA risk in the selected scope.`;
  if (q.includes("recurring")) return s.recurringIssues || "No recurring issue pattern is visible.";
  if (q.includes("last") || q.includes("serviced") || q.includes("visited")) return `Latest service / scan record: ${s.latestService || "No scan/service record available yet"}.`;
  if (q.includes("report")) return `Report summary: ${s.scans || 0} scan(s), average health ${s.averageHealth || "—"}, ${s.openTickets || 0} open ticket(s), ${s.slaRisk || 0} SLA-risk item(s).`;
  return `Current site status: ${s.scans || 0} scan(s), average health ${s.averageHealth || "—"}, ${s.openTickets || 0} open ticket(s), ${s.p1Tickets || 0} P1 item(s), ${s.slaRisk || 0} SLA-risk item(s). Latest service: ${s.latestService || "No scan/service record available yet"}.`;
}
function fetchWithTimeout(url, options = {}, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}
function dedupeModels(models) {
  return [...new Set(models.filter(Boolean).map(String))];
}
async function callOpenAIText({ apiKey, models, messages }) {
  let lastError = "OpenAI client assistant failed";
  for (const model of dedupeModels(models)) {
    const response = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, temperature: 0.2, max_completion_tokens: 500 })
    });
    const raw = await response.text();
    let data = {};
    try { data = JSON.parse(raw); } catch { data = { raw }; }
    if (response.ok && !data.error) return data.choices?.[0]?.message?.content?.trim() || "";
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

  const context = req.body || {};
  const fallback = fallbackAnswer(context);
  if (!process.env.OPENAI_API_KEY) return res.status(200).json({ ok: true, mode: "fallback", answer: fallback });

  const system = "You are Ask GreenOps, a client operations assistant inside GreenOps ITSM. Answer only using the provided JSON context. Be concise, operational, and specific. Do not invent data, prices, ticket numbers, SLA status, or invoices. If data is missing, say it is not available in the portal data yet.";
  const prompt = `Question: ${context.question || "Site status"}\n\nClient-authorized portal context JSON:\n${JSON.stringify(context, null, 2)}\n\nReturn a direct answer in 2-5 short sentences. Do not include markdown tables.`;

  try {
    const answer = await callOpenAIText({
      apiKey: process.env.OPENAI_API_KEY,
      models: [process.env.OPENAI_TEXT_MODEL, process.env.OPENAI_MODEL, "gpt-5.4-mini", "gpt-5.4", "gpt-5.5"],
      messages: [{ role: "system", content: system }, { role: "user", content: prompt }]
    });
    return res.status(200).json({ ok: true, mode: "ai", answer: answer || fallback });
  } catch (error) {
    console.error("OpenAI client assistant fallback:", error?.message || error);
    return res.status(200).json({ ok: true, mode: "fallback", answer: fallback });
  }
}
