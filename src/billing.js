import { BILLING } from "./config.js";
import { slaState } from "./sla.js";

const monthLabel = monthKey => {
  const [year, month] = String(monthKey || currentMonthKey()).split("-");
  return new Date(Number(year), Number(month) - 1, 1).toLocaleString("en-IN", { month: "long", year: "numeric" });
};
const currentMonthKey = () => new Date().toISOString().slice(0, 7);
const money = n => `₹${Number(n || 0).toLocaleString("en-IN")}`;
const inMonth = (iso, monthKey) => String(iso || "").slice(0, 7) === monthKey;
const invoiceNo = (siteId, monthKey) => `GO/${String(siteId || "SITE").replace(/[^a-z0-9]/gi, "").slice(-6).toUpperCase()}/${monthKey.replace("-", "")}`;

function siteTicketsForMonth(db, siteId, monthKey) {
  return (db.tickets || []).filter(t => t.siteId === siteId && inMonth(t.createdAt, monthKey));
}

export function buildInvoice(db, siteId, monthKey = currentMonthKey()) {
  const site = (db.sites || []).find(s => s.id === siteId);
  const client = (db.clients || []).find(c => c.id === site?.clientId);
  const tickets = siteTicketsForMonth(db, siteId, monthKey);
  const breachedTickets = tickets.filter(t => slaState(t).breached);
  const baseMonthlyAmount = Number(site?.monthlyAmcAmount ?? BILLING.defaultMonthlyAmc ?? 0);
  const creditPerBreach = Number(BILLING.slaCreditPerBreach ?? 50);
  const slaCreditAmount = breachedTickets.length * creditPerBreach;
  const netPayable = Math.max(0, baseMonthlyAmount - slaCreditAmount);
  return {
    id: `inv-${siteId}-${monthKey}`,
    invoiceNo: invoiceNo(siteId, monthKey),
    clientId: client?.id || "",
    clientName: client?.name || "Client",
    siteId,
    siteName: site?.name || "Assigned site",
    city: site?.city || "",
    billingMonth: monthKey,
    billingLabel: monthLabel(monthKey),
    baseMonthlyAmount,
    slaCreditAmount,
    netPayable,
    creditPerBreach,
    breachedCount: breachedTickets.length,
    totalTickets: tickets.length,
    breachedTickets,
    status: "Generated"
  };
}

export function buildInvoicesForSites(db, siteIds = [], monthKey = currentMonthKey()) {
  return siteIds.map(siteId => buildInvoice(db, siteId, monthKey));
}

export function invoiceSummaryText(invoice) {
  return `${invoice.billingLabel}: Base AMC ${money(invoice.baseMonthlyAmount)}, SLA credit ${money(invoice.slaCreditAmount)} (${invoice.breachedCount} breach${invoice.breachedCount === 1 ? "" : "es"} × ${money(invoice.creditPerBreach)}), net payable ${money(invoice.netPayable)}.`;
}

export function invoiceHtml(invoice) {
  const rows = invoice.breachedTickets.length
    ? invoice.breachedTickets.map(t => `<tr><td>#${t.ticketNo || t.id}</td><td>${escapeInvoice(t.issue)}</td><td>${t.priority}</td><td>${t.status}</td><td>${money(invoice.creditPerBreach)}</td></tr>`).join("")
    : `<tr><td colspan="5">No breached SLA items for this billing month.</td></tr>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${invoice.invoiceNo}</title><style>body{font-family:Arial,sans-serif;color:#122019;padding:32px}h1{margin-bottom:4px}.muted{color:#66746d}table{width:100%;border-collapse:collapse;margin-top:18px}td,th{border:1px solid #d8dfd9;padding:10px;text-align:left}.total{font-size:20px;font-weight:700}.right{text-align:right}</style></head><body><h1>GreenOps ITSM Invoice</h1><p class="muted">Invoice ${invoice.invoiceNo} · ${invoice.billingLabel}</p><p><strong>Client:</strong> ${escapeInvoice(invoice.clientName)}<br><strong>Site:</strong> ${escapeInvoice(invoice.siteName)}${invoice.city ? `, ${escapeInvoice(invoice.city)}` : ""}</p><table><tbody><tr><th>Line item</th><th class="right">Amount</th></tr><tr><td>Fixed monthly plant maintenance service</td><td class="right">${money(invoice.baseMonthlyAmount)}</td></tr><tr><td>SLA service credit (${invoice.breachedCount} breached item(s) × ${money(invoice.creditPerBreach)})</td><td class="right">-${money(invoice.slaCreditAmount)}</td></tr><tr><td class="total">Net payable</td><td class="right total">${money(invoice.netPayable)}</td></tr></tbody></table><h2>SLA Billing Summary</h2><p>Total tickets in billing month: ${invoice.totalTickets}<br>Breached SLA items: ${invoice.breachedCount}<br>Service credit rule: ${money(invoice.creditPerBreach)} per breached SLA item / plant.</p><table><thead><tr><th>Ticket</th><th>Issue</th><th>Priority</th><th>Status</th><th>Credit</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
}

function escapeInvoice(value) {
  return String(value ?? "").replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
}

export { currentMonthKey, money };
