import { BILLING, STATUS } from "./config.js";
import { slaState } from "./sla.js";

const monthKey = date => {
  const d = date ? new Date(date) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const monthLabel = key => {
  const [year, month] = String(key || monthKey()).split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleString("en-IN", { month: "long", year: "numeric" });
};
const inMonth = (iso, key) => monthKey(iso) === key;
const money = value => `₹${Number(value || 0).toLocaleString("en-IN")}`;

export function invoiceForSite(db, siteId, billingMonth = monthKey()) {
  const site = (db.sites || []).find(s => s.id === siteId);
  const client = (db.clients || []).find(c => c.id === site?.clientId);
  const tickets = (db.tickets || []).filter(t => t.siteId === siteId && inMonth(t.createdAt, billingMonth));
  const breachedTickets = tickets.filter(t => slaState(t).breached);
  const baseMonthlyAmc = Number(site?.monthlyAmc || BILLING.defaultMonthlyAmc || 0);
  const finePerBreach = Number(BILLING.slaFinePerBreachedItem || 50);
  const slaCreditAmount = breachedTickets.length * finePerBreach;
  const netPayable = Math.max(0, baseMonthlyAmc - slaCreditAmount);
  return {
    id: `inv-${siteId}-${billingMonth}`,
    invoiceNo: `${BILLING.invoicePrefix}/${String(siteId).replace("site-", "").toUpperCase()}/${billingMonth}`,
    clientId: site?.clientId || "",
    clientName: client?.name || "Client",
    siteId,
    siteName: site?.name || "Site",
    billingMonth,
    billingLabel: monthLabel(billingMonth),
    baseMonthlyAmc,
    finePerBreach,
    breachedCount: breachedTickets.length,
    slaCreditAmount,
    netPayable,
    status: "Generated",
    tickets,
    breachedTickets
  };
}

export function invoicesForSites(db, siteIds = [], billingMonth = monthKey()) {
  return siteIds.map(siteId => invoiceForSite(db, siteId, billingMonth));
}

export function invoiceHtml(invoice) {
  const rows = invoice.breachedTickets.length
    ? invoice.breachedTickets.map(t => `<tr><td>#${t.ticketNo || t.id}</td><td>${escapeInvoice(t.issue)}</td><td>${t.priority}</td><td>${escapeInvoice(slaState(t).label)}</td><td>${money(invoice.finePerBreach)}</td></tr>`).join("")
    : `<tr><td colspan="5">No SLA breaches recorded for this billing month.</td></tr>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeInvoice(invoice.invoiceNo)}</title><style>body{font-family:Inter,Arial,sans-serif;color:#111815;margin:32px}h1{margin:0 0 4px}.muted{color:#6d756f}.box{border:1px solid #e4e0d7;border-radius:14px;padding:16px;margin:16px 0}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{text-align:left;border-bottom:1px solid #e4e0d7;padding:10px;font-size:13px}th{font-size:11px;text-transform:uppercase;color:#6d756f}.total{font-size:22px;font-weight:800;color:#0f2f24}.credit{color:#b42318;font-weight:800}</style></head><body><h1>GreenOps ITSM Invoice</h1><div class="muted">${escapeInvoice(invoice.billingLabel)} · ${escapeInvoice(invoice.invoiceNo)}</div><div class="box"><strong>Client:</strong> ${escapeInvoice(invoice.clientName)}<br><strong>Site:</strong> ${escapeInvoice(invoice.siteName)}<br><strong>Status:</strong> ${escapeInvoice(invoice.status)}</div><table><thead><tr><th>Description</th><th>Amount</th></tr></thead><tbody><tr><td>Fixed monthly plant maintenance / GreenOps service</td><td>${money(invoice.baseMonthlyAmc)}</td></tr><tr><td>SLA service credit (${invoice.breachedCount} breached item(s) × ${money(invoice.finePerBreach)})</td><td class="credit">-${money(invoice.slaCreditAmount)}</td></tr><tr><td><strong>Net payable</strong></td><td class="total">${money(invoice.netPayable)}</td></tr></tbody></table><h2>SLA Summary</h2><div class="box">Total tickets this month: ${invoice.tickets.length}<br>SLA breached items: ${invoice.breachedCount}<br>Service credit rule: ${money(invoice.finePerBreach)} per breached SLA item / plant</div><table><thead><tr><th>Ticket</th><th>Issue</th><th>Priority</th><th>SLA Status</th><th>Credit</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
}

export function invoiceText(invoice) {
  return `Invoice ${invoice.invoiceNo} for ${invoice.billingLabel}: base AMC ${money(invoice.baseMonthlyAmc)}, SLA credit ${money(invoice.slaCreditAmount)} for ${invoice.breachedCount} breached item(s), net payable ${money(invoice.netPayable)}.`;
}

function escapeInvoice(value) {
  return String(value ?? "").replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
}
