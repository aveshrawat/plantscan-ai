function fallbackAnswer(context = {}) {
  const s = context.summary || {};
  const invoice = context.invoice || {};
  const q = String(context.question || "").toLowerCase();
  if (q.includes("invoice") || q.includes("billing") || q.includes("payable")) {
    const totals = invoice.totals || {};
    return `${invoice.invoiceNo || "Current invoice"}: base AMC ₹${Number(totals.monthlyAmc || 0).toLocaleString("en-IN")}, SLA credit ₹${Number(totals.slaCredit || 0).toLocaleString("en-IN")} for ${totals.breachedItems || 0} breached item(s), net payable ₹${Number(totals.netPayable || 0).toLocaleString("en-IN")}.`;
  }
  if (q.includes("ticket") || q.includes("pending") || q.includes("open")) {
    return `There are ${s.openTickets || 0} open ticket(s), including ${s.p1Tickets || 0} P1 item(s). SLA-risk items: ${s.slaRisk || 0}.`;
  }
  if (q.includes("sla") || q.includes("breach")) return `${s.slaRisk || 0} item(s) are currently at SLA risk in the selected scope.`;
  if (q.includes("recurring")) return s.recurringIssues || "No recurring issue pattern is visible.";
  if (q.includes("last") || q.includes("serviced") || q.includes("visited")) return `Latest service / scan record: ${s.latestService || "No scan/service record available yet"}.`;
  if (q.includes("report")) return `Report summary: ${s.scans || 0} scan(s), average health ${s.averageHealth || "—"}, ${s.openTickets || 0} open ticket(s), ${s.slaRisk || 0} SLA-risk item(s).`;
  return `Current site status: ${s.scans || 0} scan(s), average health ${s.averageHealth || "—"}, ${s.openTickets || 0} open ticket(s), ${s.p1Tickets || 0} P1 item(s), ${s.slaRisk || 0} SLA-risk item(s). Latest service: ${s.latestService || "No scan/service record available yet"}.`;
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
  if (!process.env.ANTHROPIC_API_KEY) return res.status(200).json({ ok: true, mode: "fallback", answer: fallback });

  const system = "You are Ask GreenOps, a client operations assistant inside GreenOps ITSM. Answer only using the provided JSON context. Be concise, operational, and specific. Do not invent data, prices, ticket numbers, SLA status, or invoices. If data is missing, say it is not available in the portal data yet.";
  const prompt = `Question: ${context.question || "Site status"}\n\nClient-authorized portal context JSON:\n${JSON.stringify(context, null, 2)}\n\nReturn a direct answer in 2-5 short sentences. Do not include markdown tables.`;

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
        max_tokens: 500,
        temperature: 0,
        system,
        messages: [{ role: "user", content: prompt }]
      })
    });
    const data = await response.json();
    if (!response.ok || data.error) return res.status(200).json({ ok: true, mode: "fallback", answer: fallback });
    const answer = data.content?.map(block => block.text || "").join(" ").trim() || fallback;
    return res.status(200).json({ ok: true, mode: "ai", answer });
  } catch {
    return res.status(200).json({ ok: true, mode: "fallback", answer: fallback });
  }
}
