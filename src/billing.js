import { BILLING } from "./config.js";
import { slaState } from "./sla.js";
import { downloadFile, escapeHtml } from "./utils.js";

export const currency = amount => new Intl.NumberFormat("en-IN", { style: "currency", currency: BILLING.currency || "INR", maximumFractionDigits: 0 }).format(Number(amount || 0));

export function currentBillingMonth(date = new Date()) {
  return date.toISOString().slice(0, 7);
}
export function monthLabel(month = currentBillingMonth()) {
  const [year, m] = month.split("-").map(Number);
  return new Date(year, m - 1, 1).toLocaleString("en-IN", { month: "long", year: "numeric" });
}
function withinMonth(iso, month) {
  return String(iso || "").slice(0, 7) === month;
}
export function invoiceForSite(db, siteId, month = currentBillingMonth()) {
  const site = db.sites.find(s => s.id === siteId);
  const client = db.clients.find(c => c.id === site?.clientId);
  const tickets = (db.tickets || []).filter(t => t.siteId === siteId && withinMonth(t.createdAt, month));
  const breachedTickets = tickets.filter(t => slaState(t).breached);
  const breachedPlants = breachedTickets.length;
  const baseMonthlyAmount = Number(site?.baseMonthlyAmount || BILLING.defaultMonthlyAmount || 0);
  const slaFinePerBreach = Number(BILLING.slaFinePerBreachedPlant || 50);
  const slaCreditAmount = breachedPlants * slaFinePerBreach;
  const netPayable = Math.max(0, baseMonthlyAmount - slaCreditAmount);
  const invoiceNo = `GO/${String(site?.name || "SITE").replace(/[^A-Z0-9]+/gi, "").slice(0, 6).toUpperCase()}/${month.replace("-", "")}/001`;
  return {
    id: `${siteId}-${month}`,
    invoiceNo,
    clientId: site?.clientId,
    clientName: client?.name || "Client",
    siteId,
    siteName: site?.name || "Site",
    city: site?.city || "",
    billingMonth: month,
    billingLabel: monthLabel(month),
    baseMonthlyAmount,
    totalTickets: tickets.length,
    breachedTickets: breachedTickets.length,
    breachedPlants,
    slaFinePerBreach,
    slaCreditAmount,
    netPayable,
    status: "Generated",
    dueDate: new Date(new Date(`${month}-01T00:00:00`).getTime() + (BILLING.defaultDueDays || 15) * 86400000).toISOString().slice(0, 10),
    breachedTicketNos: breachedTickets.map(t => t.ticketNo ? `#${String(t.ticketNo).padStart(6, "0").slice(-6)}` : t.id)
  };
}
export function invoicesForSites(db, siteIds, month = currentBillingMonth()) {
  return siteIds.map(siteId => invoiceForSite(db, siteId, month));
}
export function downloadInvoiceHtml(invoice) {
  const rows = [
    ["Fixed monthly plant maintenance service", invoice.baseMonthlyAmount],
    [`SLA service credit — ${invoice.breachedPlants} breached plant/ticket × ${currency(invoice.slaFinePerBreach)}`, -invoice.slaCreditAmount]
  ];
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(invoice.invoiceNo)}</title><style>
    body{font-family:Inter,Arial,sans-serif;margin:40px;color:#111815} .wrap{max-width:860px;margin:auto}.head{display:flex;justify-content:space-between;border-bottom:2px solid #0f2f24;padding-bottom:18px;margin-bottom:24px}.brand{font-weight:800;font-size:22px;color:#0f2f24}.muted{color:#6d756f}.box{border:1px solid #e4e0d7;border-radius:14px;padding:16px;margin:16px 0}table{width:100%;border-collapse:collapse;margin-top:18px}th,td{text-align:left;padding:12px;border-bottom:1px solid #e4e0d7}th{background:#faf8f2}.right{text-align:right}.total{font-size:20px;font-weight:800}.credit{color:#b42318}.good{color:#1c6048}.note{font-size:13px;line-height:1.6;color:#4b5550}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}</style></head><body><div class="wrap">
      <div class="head"><div><div class="brand">GreenOps ITSM</div><div class="muted">Monthly Fixed Service Invoice</div></div><div><strong>${escapeHtml(invoice.invoiceNo)}</strong><br><span class="muted">${escapeHtml(invoice.billingLabel)}</span></div></div>
      <div class="grid"><div class="box"><strong>Bill To</strong><br>${escapeHtml(invoice.clientName)}<br>${escapeHtml(invoice.siteName)}<br>${escapeHtml(invoice.city)}</div><div class="box"><strong>Status</strong><br>${escapeHtml(invoice.status)}<br><span class="muted">Due: ${escapeHtml(invoice.dueDate)}</span></div></div>
      <table><thead><tr><th>Description</th><th class="right">Amount</th></tr></thead><tbody>${rows.map(([label, amount]) => `<tr><td>${escapeHtml(label)}</td><td class="right ${amount < 0 ? "credit" : ""}">${currency(amount)}</td></tr>`).join("")}<tr><td class="total">Net Payable</td><td class="right total good">${currency(invoice.netPayable)}</td></tr></tbody></table>
      <div class="box"><strong>SLA Billing Summary</strong><p class="note">Total tickets in billing month: ${invoice.totalTickets}. Breached SLA items: ${invoice.breachedPlants}. Current demo rule: ${currency(invoice.slaFinePerBreach)} service credit per breached plant/ticket. This is configurable once final SLA terms are agreed.</p>${invoice.breachedTicketNos.length ? `<p class="note">Breached ticket references: ${invoice.breachedTicketNos.map(escapeHtml).join(", ")}</p>` : `<p class="note">No SLA service credit applied for this period.</p>`}</div>
      <p class="note">This invoice is generated from GreenOps ITSM operational records. Final commercial terms remain subject to the signed agreement.</p>
    </div></body></html>`;
  downloadFile(`greenops-invoice-${invoice.siteName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${invoice.billingMonth}.html`, html, "text/html");
}
