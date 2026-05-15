import { downloadFile, fmtDate, toCsv } from "./utils.js";
import { slaState, resolutionTime } from "./sla.js";
import { healthSummary } from "./health.js";

export function joinRecords(db, filters = {}) {
  const { clientId = "all", siteId = "all", city = "all", from = "", to = "", siteIds = [] } = filters;
  const allowed = Array.isArray(siteIds) && siteIds.length ? new Set(siteIds) : null;
  const siteMap = Object.fromEntries(db.sites.map(s => [s.id, s]));
  const clientMap = Object.fromEntries(db.clients.map(c => [c.id, c]));
  const plantMap = Object.fromEntries(db.plants.map(p => [p.id, p]));
  const inRange = iso => (!from || iso.slice(0, 10) >= from) && (!to || iso.slice(0, 10) <= to);
  const matchSite = sid => {
    const site = siteMap[sid];
    if (!site) return false;
    return (!allowed || allowed.has(site.id)) && (clientId === "all" || site.clientId === clientId) && (siteId === "all" || site.id === siteId) && (city === "all" || site.city === city);
  };
  const scans = db.scans.filter(s => matchSite(s.siteId) && inRange(s.createdAt)).map(s => ({ ...s, site: siteMap[s.siteId], client: clientMap[siteMap[s.siteId]?.clientId], plant: plantMap[s.plantId] }));
  const tickets = db.tickets.filter(t => matchSite(t.siteId) && inRange(t.createdAt)).map(t => ({ ...t, site: siteMap[t.siteId], client: clientMap[siteMap[t.siteId]?.clientId], plant: plantMap[t.plantId] }));
  return { scans, tickets };
}

export function exportCsvReport(db, filters) {
  const { scans, tickets } = joinRecords(db, filters);
  const ticketNo = t => t.ticketNo ? `#${String(t.ticketNo).padStart(6, "0").slice(-6)}` : "";
  const rows = [
    ...scans.map(s => ({ type: "Scan", ticket_no: "", client: s.client?.name, city: s.site?.city, site: s.site?.name, plant: s.plant?.type, zone: s.plant?.zone, score: s.score, category: s.category, issue: s.diagnosis, ticket_status: "", priority: "", sla: "", created_at: fmtDate(s.createdAt), resolution_time: "" })),
    ...tickets.map(t => ({ type: "Ticket", ticket_no: ticketNo(t), client: t.client?.name, city: t.site?.city, site: t.site?.name, plant: t.plant?.type || "General", zone: t.plant?.zone || "—", score: "", category: "", issue: t.issue, ticket_status: t.status, priority: t.priority, sla: slaState(t).label, created_at: fmtDate(t.createdAt), resolution_time: resolutionTime(t) }))
  ];
  downloadFile(`greenops-report-${new Date().toISOString().slice(0,10)}.csv`, toCsv(rows));
}

export function exportFormalReport(db, filters, role = "supervisor") {
  const { scans, tickets } = joinRecords(db, filters);
  const isClient = role === "client";
  const html = formalReportHtml({ scans, tickets, role, isClient, generatedAt: new Date().toISOString() });
  const safeRole = isClient ? "client" : "supervisor";
  downloadFile(`greenops-${safeRole}-formal-report-${new Date().toISOString().slice(0,10)}.html`, html, "text/html");
}

function formalReportHtml({ scans, tickets, isClient, generatedAt }) {
  const hs = healthSummary(scans);
  const open = tickets.filter(t => t.status !== "Closed");
  const closed = tickets.filter(t => t.status === "Closed");
  const breached = open.filter(t => slaState(t).breached);
  const p1 = open.filter(t => t.priority === "P1");
  const title = isClient ? "GreenOps Client Service Report" : "GreenOps Supervisor Operations Report";
  const subtitle = isClient ? "Client-facing service summary, issue status, and closure proof snapshot." : "Supervisor-facing operations summary, SLA status, ticket queue, and scan records.";
  const rows = isClient
    ? tickets.slice(-14).map(t => `<tr><td>#${escapeReport(t.ticketNo || t.id)}</td><td>${escapeReport(t.site?.name)}</td><td>${escapeReport(t.issue)}</td><td>${escapeReport(t.status)}</td><td>${escapeReport(slaState(t).label)}</td></tr>`).join("")
    : [...scans.slice(-10).map(s => `<tr><td>Scan</td><td>${escapeReport(s.site?.name)}</td><td>${escapeReport(s.plant?.type || "Plant")} · ${escapeReport(s.plant?.zone || "Zone")}</td><td>${escapeReport(s.category)} · ${s.score}/10</td><td>${fmtDate(s.createdAt)}</td></tr>`), ...tickets.slice(-10).map(t => `<tr><td>Ticket</td><td>${escapeReport(t.site?.name)}</td><td>${escapeReport(t.issue)}</td><td>${escapeReport(t.status)} · ${escapeReport(slaState(t).label)}</td><td>${fmtDate(t.createdAt)}</td></tr>`)].join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>body{font-family:Inter,Arial,sans-serif;margin:32px;color:#111815}h1{margin:0}.muted{color:#6d756f}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:18px 0}.kpi{border:1px solid #e4e0d7;border-radius:14px;padding:14px}.kpi span{display:block;color:#6d756f;font-size:12px}.kpi strong{font-size:24px;color:#0f2f24}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{border-bottom:1px solid #e4e0d7;text-align:left;padding:10px;font-size:13px}th{font-size:11px;text-transform:uppercase;color:#6d756f}.box{border:1px solid #e4e0d7;border-radius:14px;padding:16px;margin:18px 0}.footer{margin-top:24px;font-size:11px;color:#6d756f}</style></head><body><h1>${title}</h1><p class="muted">${subtitle}<br>Generated: ${fmtDate(generatedAt)}</p><div class="box"><strong>Executive Snapshot</strong><p>${isClient ? `Current status: ${open.length} open ticket(s), ${p1.length} P1 issue(s), ${breached.length} SLA breach(es), and average health score ${hs.avg || "—"}.` : `Operations status: ${scans.length} scan(s), ${tickets.length} ticket(s), ${closed.length} closure(s), ${breached.length} active SLA breach(es), average health ${hs.avg || "—"}.`}</p></div><div class="grid"><div class="kpi"><span>Avg Health</span><strong>${hs.avg || "—"}</strong></div><div class="kpi"><span>Open Tickets</span><strong>${open.length}</strong></div><div class="kpi"><span>P1 Open</span><strong>${p1.length}</strong></div><div class="kpi"><span>SLA Breaches</span><strong>${breached.length}</strong></div></div><h2>${isClient ? "Ticket Status Summary" : "Operations Records"}</h2><table><thead><tr>${isClient ? "<th>Ticket</th><th>Site</th><th>Issue</th><th>Status</th><th>SLA</th>" : "<th>Type</th><th>Site</th><th>Details</th><th>Status</th><th>Date</th>"}</tr></thead><tbody>${rows || `<tr><td colspan="5">No records available for the selected period.</td></tr>`}</tbody></table><div class="footer">This report is generated from GreenOps ITSM platform records. Use browser print / Save as PDF for PDF output.</div></body></html>`;
}

function escapeReport(value) {
  return String(value ?? "").replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
}
