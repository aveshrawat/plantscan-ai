import { STATUS } from "./config.js";
import { joinRecords } from "./reports.js";
import { slaState } from "./sla.js";
import { downloadFile, escapeHtml } from "./utils.js";

export const SLA_CREDIT_PER_BREACH = 50;
export const DEFAULT_MONTHLY_AMC = 50000;

function monthStart(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}
function monthEnd(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}
function inPeriod(iso, start, end) {
  const d = new Date(iso);
  return !Number.isNaN(d.getTime()) && d >= start && d <= end;
}
function money(value) {
  return `₹${Number(value || 0).toLocaleString("en-IN")}`;
}
function siteMonthlyAmc(db, siteId) {
  const site = db.sites?.find(s => s.id === siteId);
  return Number(site?.billing?.monthlyAmc || db.billingDefaults?.fixedMonthlyAmc || DEFAULT_MONTHLY_AMC);
}
function invoiceNo(date = new Date()) {
  return `GOPS-${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function siteIdsFromRecords(scans = [], tickets = []) {
  return [...new Set([...scans.map(s => s.siteId), ...tickets.map(t => t.siteId)].filter(Boolean))];
}

export function generateInvoiceData(db, filters = {}, date = new Date()) {
  const start = monthStart(date);
  const end = monthEnd(date);
  const periodLabel = date.toLocaleString("en-IN", { month: "long", year: "numeric" });
  const records = joinRecords(db, filters);
  const sitesAllowed = new Set((filters.siteIds || db.sites.map(s => s.id)).filter(Boolean));
  const visibleSiteIds = filters.siteId && filters.siteId !== "all"
    ? [filters.siteId]
    : siteIdsFromRecords(records.scans, records.tickets).length
      ? siteIdsFromRecords(records.scans, records.tickets)
      : [...sitesAllowed];

  const rows = visibleSiteIds
    .filter(siteId => sitesAllowed.has(siteId))
    .map(siteId => {
      const site = db.sites.find(s => s.id === siteId);
      const tickets = records.tickets.filter(t => t.siteId === siteId && inPeriod(t.createdAt, start, end));
      const breached = tickets.filter(t => slaState(t).breached || (t.status !== STATUS.CLOSED && slaState(t).breached));
      const monthlyAmc = siteMonthlyAmc(db, siteId);
      const credit = breached.length * SLA_CREDIT_PER_BREACH;
      return { siteId, siteName: site?.name || "Site", city: site?.city || "", monthlyAmc, breachedItems: breached.length, slaCredit: credit, netPayable: Math.max(0, monthlyAmc - credit), tickets };
    });

  const totals = rows.reduce((acc, row) => {
    acc.monthlyAmc += row.monthlyAmc;
    acc.breachedItems += row.breachedItems;
    acc.slaCredit += row.slaCredit;
    acc.netPayable += row.netPayable;
    return acc;
  }, { monthlyAmc: 0, breachedItems: 0, slaCredit: 0, netPayable: 0 });

  return {
    invoiceNo: invoiceNo(date),
    generatedAt: new Date().toISOString(),
    periodLabel,
    formula: "Fixed Monthly AMC - SLA Service Credit = Net Payable",
    creditRule: `₹${SLA_CREDIT_PER_BREACH} per breached SLA item / plant`,
    rows,
    totals,
    money
  };
}

export function invoiceSummaryText(invoice) {
  return `Invoice ${invoice.invoiceNo} for ${invoice.periodLabel}: Base AMC ${money(invoice.totals.monthlyAmc)}, SLA credit ${money(invoice.totals.slaCredit)} for ${invoice.totals.breachedItems} breached item(s), net payable ${money(invoice.totals.netPayable)}.`;
}

export function invoiceHtml(invoice) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(invoice.invoiceNo)}</title><style>body{font-family:Arial,sans-serif;color:#1f2f29;margin:32px}h1{margin-bottom:4px}.muted{color:#607068}table{border-collapse:collapse;width:100%;margin-top:20px}th,td{border:1px solid #d9e1dc;padding:10px;text-align:left}th{background:#eef5f1}.total td{font-weight:700;background:#f7faf8}</style></head><body><h1>GreenOps ITSM Invoice</h1><p class="muted">${escapeHtml(invoice.invoiceNo)} · ${escapeHtml(invoice.periodLabel)}</p><p><strong>Billing formula:</strong> ${escapeHtml(invoice.formula)}</p><p><strong>SLA credit rule:</strong> ${escapeHtml(invoice.creditRule)}</p><table><thead><tr><th>Site</th><th>City</th><th>Fixed Monthly AMC</th><th>SLA Breaches</th><th>SLA Credit</th><th>Net Payable</th></tr></thead><tbody>${invoice.rows.map(row => `<tr><td>${escapeHtml(row.siteName)}</td><td>${escapeHtml(row.city)}</td><td>${money(row.monthlyAmc)}</td><td>${row.breachedItems}</td><td>${money(row.slaCredit)}</td><td>${money(row.netPayable)}</td></tr>`).join("")}<tr class="total"><td colspan="2">Total</td><td>${money(invoice.totals.monthlyAmc)}</td><td>${invoice.totals.breachedItems}</td><td>${money(invoice.totals.slaCredit)}</td><td>${money(invoice.totals.netPayable)}</td></tr></tbody></table><p class="muted">This is a GreenOps demo invoice generated from platform SLA records. It is not auto-delivered through WhatsApp Business API.</p></body></html>`;
}

export function downloadInvoiceHtml(invoice) {
  downloadFile(`${invoice.invoiceNo}-GreenOps-Invoice.html`, invoiceHtml(invoice), "text/html;charset=utf-8");
}
