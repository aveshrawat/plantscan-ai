import { STATUS, HEALTH } from "./config.js";
import { hoursBetween, fmtHours } from "./utils.js";

const DAY = 24 * 60 * 60 * 1000;
const safeDate = iso => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};
const zoneOf = record => record?.plant?.zone || record?.zone || record?.location || "General";
const ticketNo = t => t?.ticketNo ? String(t.ticketNo).padStart(6, "0").slice(-6) : String(t?.id || "");
const lower = value => String(value || "").toLowerCase();
const isClosed = t => t?.status === STATUS.CLOSED;
const isClientSource = t => lower(t?.source) === "client" || lower(t?.createdBy) === "client";

function rangeDays(filters = {}) {
  const from = safeDate(filters.from);
  const to = safeDate(filters.to);
  if (!from && !to) return 7;
  const start = from || new Date(Date.now() - 7 * DAY);
  const end = to || new Date();
  return Math.max(1, Math.ceil((end - start) / DAY) + 1);
}

function normalizeIssueType(ticket = {}) {
  const explicit = lower(ticket.issueType || ticket.category);
  const text = lower(`${ticket.issue || ""} ${ticket.description || ""} ${ticket.blockerReason || ""}`);
  const source = explicit || text;
  if (source.includes("pest") || source.includes("disease")) return "Pest / disease";
  if (source.includes("water") || source.includes("dry") || source.includes("irrigation")) return "Watering / irrigation";
  if (source.includes("light") || source.includes("draft") || source.includes("hvac") || source.includes("ac")) return "Light / HVAC mismatch";
  if (source.includes("replace") || source.includes("dead") || source.includes("mortality")) return "Replacement / mortality";
  if (source.includes("soil") || source.includes("root")) return "Soil / root issue";
  if (source.includes("client") || source.includes("concern")) return "Client concern";
  if (source.includes("critical plant health")) return "Critical plant health";
  return ticket.issueType || "General plant health";
}

function latestScansByZone(scans = []) {
  const map = new Map();
  scans.forEach(scan => {
    const key = `${scan.siteId}||${zoneOf(scan)}`;
    const existing = map.get(key);
    if (!existing || new Date(scan.createdAt) > new Date(existing.createdAt)) map.set(key, scan);
  });
  return map;
}

function scanCoverage({ sites = [], scans = [], filters = {} }) {
  const days = rangeDays(filters);
  const expectedPerZone = Math.max(1, Math.ceil(days / 7));
  const expectedRows = [];
  sites.forEach(site => (site.zones || ["General"]).forEach(zone => expectedRows.push({ site, zone, expected: expectedPerZone })));
  const completedByZone = new Map();
  scans.forEach(scan => {
    const key = `${scan.siteId}||${zoneOf(scan)}`;
    completedByZone.set(key, (completedByZone.get(key) || 0) + 1);
  });
  const rows = expectedRows.map(row => {
    const completed = completedByZone.get(`${row.site.id}||${row.zone}`) || 0;
    const pct = Math.min(100, Math.round((completed / row.expected) * 100));
    return { ...row, completed, pct, missing: Math.max(0, row.expected - completed) };
  });
  const expected = rows.reduce((sum, r) => sum + r.expected, 0);
  const completed = rows.reduce((sum, r) => sum + Math.min(r.completed, r.expected), 0);
  const pct = expected ? Math.round((completed / expected) * 100) : 0;
  return { pct, expected, completed, rows };
}

function freshness({ sites = [], scans = [] }) {
  const latest = latestScansByZone(scans);
  const rows = [];
  sites.forEach(site => (site.zones || ["General"]).forEach(zone => {
    const scan = latest.get(`${site.id}||${zone}`);
    const ageHours = scan?.createdAt ? hoursBetween(scan.createdAt) : null;
    const days = ageHours === null ? null : ageHours / 24;
    const status = days === null ? "Not checked" : days <= 2 ? "Fresh" : days <= 5 ? "Acceptable" : days <= 7 ? "Stale" : "Critical stale";
    rows.push({ site, zone, scan, ageHours, status });
  }));
  const checked = rows.filter(r => r.scan);
  const latestScan = checked.sort((a, b) => new Date(b.scan.createdAt) - new Date(a.scan.createdAt))[0] || null;
  const stale = rows.filter(r => ["Stale", "Critical stale", "Not checked"].includes(r.status));
  return { latestScan, rows, staleCount: stale.length, stale };
}

function interventionAvoidance(tickets = []) {
  const closed = tickets.filter(isClosed);
  const avoided = closed.filter(t => {
    const activity = t.activity || [];
    const touchedByClientOrIfm = activity.some(a => ["client", "ifm", "fm"].includes(lower(a.userRole)));
    return !isClientSource(t) && !t.fmInterventionRequired && !t.actionRequiredOwner && !t.blockerOwner && !t.escalated && !touchedByClientOrIfm;
  });
  return { totalClosed: closed.length, count: avoided.length, rows: avoided };
}

function recurringIssues(tickets = [], scans = []) {
  const windowStart = Date.now() - 30 * DAY;
  const rows = tickets
    .filter(t => new Date(t.createdAt).getTime() >= windowStart)
    .map(t => ({ ticket: t, key: `${t.siteId}||${zoneOf(t)}||${normalizeIssueType(t)}`, issueType: normalizeIssueType(t), zone: zoneOf(t) }));
  const grouped = new Map();
  rows.forEach(row => {
    if (!grouped.has(row.key)) grouped.set(row.key, []);
    grouped.get(row.key).push(row);
  });
  const clusters = [...grouped.values()]
    .filter(group => group.length >= 3)
    .map(group => {
      const first = group[0];
      const relatedTickets = group.map(x => x.ticket);
      const relatedScans = scans.filter(scan => scan.siteId === first.ticket.siteId && zoneOf(scan) === first.zone);
      return {
        site: first.ticket.site,
        zone: first.zone,
        issueType: first.issueType,
        count: group.length,
        relatedTickets,
        relatedScans,
        suggestion: first.issueType.includes("Water") ? "Check watering schedule / irrigation" : first.issueType.includes("Light") ? "Review species suitability and AC/light exposure" : first.issueType.includes("Pest") ? "Expert pest treatment review" : "Review root cause and recurring closure quality"
      };
    })
    .sort((a, b) => b.count - a.count);
  return { count: clusters.length, clusters };
}

function reopenRate(tickets = []) {
  const closed = tickets.filter(isClosed);
  const reopened = tickets.filter(t => Number(t.reopenCount || 0) > 0 || t.reopened || lower(t.status) === "reopened");
  // Also infer reopen if same site/zone/issue is raised within 7 days after a closed ticket.
  closed.forEach(original => {
    const originalClosedAt = safeDate(original.closedAt);
    if (!originalClosedAt) return;
    const related = tickets.find(t => t.id !== original.id && t.siteId === original.siteId && zoneOf(t) === zoneOf(original) && normalizeIssueType(t) === normalizeIssueType(original) && safeDate(t.createdAt) && new Date(t.createdAt) > originalClosedAt && (new Date(t.createdAt) - originalClosedAt) <= 7 * DAY);
    if (related && !reopened.some(t => t.id === original.id)) reopened.push({ ...original, inferredReopenTicket: related });
  });
  const pct = closed.length ? Math.round((reopened.length / closed.length) * 100) : 0;
  return { pct, reopened: reopened.length, closed: closed.length, rows: reopened };
}

function actionRequired(tickets = []) {
  const rows = tickets.filter(t => t.status !== STATUS.CLOSED && ["client", "ifm", "fm"].includes(lower(t.actionRequiredOwner || t.blockerOwner)));
  return { count: rows.length, rows };
}

function blockerSummary(tickets = []) {
  const rows = tickets.filter(t => t.status !== STATUS.CLOSED && (t.slaPaused || t.slaPausedAt || t.blockerOwner || t.blockerReason || lower(t.status) === lower(STATUS.PAUSED || "Paused")));
  return { count: rows.length, rows };
}

function expertRequired(tickets = [], recurring = { clusters: [] }) {
  const recurringTicketIds = new Set(recurring.clusters.flatMap(c => c.relatedTickets.map(t => t.id)));
  const rows = tickets.filter(t => {
    const text = lower(`${t.issue || ""} ${t.description || ""} ${t.issueType || ""}`);
    const score = Number(t.plant?.latestScore ?? t.latestScore ?? 10);
    return !!t.expertRequired || lower(t.expertLevel) === "l3" || score <= 4.5 || recurringTicketIds.has(t.id) || ["pest", "disease", "root", "soil", "irrigation", "species", "green wall"].some(k => text.includes(k));
  }).map(t => ({ ...t, expertReason: t.expertReason || (recurringTicketIds.has(t.id) ? "Recurring issue pattern" : Number(t.plant?.latestScore ?? 10) <= 4.5 ? "Low health score requires expert review" : "Technical horticulture issue") }));
  return { count: rows.length, rows };
}

function statusForPct(pct) {
  if (pct >= 85) return "good";
  if (pct >= 60) return "monitor";
  return "critical";
}

export function buildEfficiencyModel({ db, scans, tickets, filters = {}, sites = [] }) {
  const coverage = scanCoverage({ sites, scans, filters });
  const fresh = freshness({ sites, scans });
  const avoided = interventionAvoidance(tickets);
  const recurring = recurringIssues(tickets, scans);
  const reopen = reopenRate(tickets);
  const action = actionRequired(tickets);
  const blockers = blockerSummary(tickets);
  const expert = expertRequired(tickets, recurring);
  return {
    coverage,
    freshness: fresh,
    avoided,
    recurring,
    reopen,
    action,
    blockers,
    expert,
    cards: [
      { key: "coverage", label: "Scan Coverage", value: `${coverage.pct}%`, status: statusForPct(coverage.pct), sub: `${coverage.completed}/${coverage.expected} expected checks` },
      { key: "freshness", label: "Last Checked", value: fresh.latestScan ? fmtHours(fresh.latestScan.ageHours) : "—", status: fresh.staleCount ? "monitor" : "good", sub: `${fresh.staleCount} stale / unchecked zones` },
      { key: "avoided", label: "FM Intervention Avoided", value: avoided.count, status: "good", sub: `${avoided.totalClosed} closed tickets analysed` },
      { key: "recurring", label: "Recurring Issues", value: recurring.count, status: recurring.count ? "monitor" : "good", sub: "3+ repeats in 30 days" },
      { key: "reopen", label: "Reopen Rate", value: `${reopen.pct}%`, status: reopen.pct > 10 ? "critical" : reopen.pct ? "monitor" : "good", sub: `${reopen.reopened}/${reopen.closed} closed tickets` },
      { key: "action", label: "Action Required", value: action.count, status: action.count ? "monitor" : "good", sub: "Client / IFM dependency" },
      { key: "blockers", label: "SLA Paused / Blockers", value: blockers.count, status: blockers.count ? "monitor" : "good", sub: "Blocked work items" },
      { key: "expert", label: "Expert Required", value: expert.count, status: expert.count ? "monitor" : "good", sub: "L3 horticulture review" }
    ]
  };
}

export { zoneOf, ticketNo, normalizeIssueType };
