import { STATUS } from "./config.js";
import { slaState } from "./sla.js";
import { hoursBetween, fmtHours } from "./utils.js";
import { normalizeIssueType, zoneOf } from "./efficiency.js";

const DAY = 24 * 60 * 60 * 1000;
const safeTime = iso => {
  const t = new Date(iso || "").getTime();
  return Number.isFinite(t) ? t : 0;
};

export function zoneHealthBreakdown({ sites = [], scans = [] }) {
  const rows = [];
  sites.forEach(site => (site.zones || ["General"]).forEach(zone => {
    const zoneScans = scans.filter(scan => scan.siteId === site.id && zoneOf(scan) === zone);
    const latest = zoneScans.slice().sort((a, b) => safeTime(b.createdAt) - safeTime(a.createdAt))[0] || null;
    const avg = zoneScans.length ? +(zoneScans.reduce((sum, scan) => sum + Number(scan.score || 0), 0) / zoneScans.length).toFixed(1) : 0;
    rows.push({ site, zone, scans: zoneScans.length, latest, avg, status: latest?.category || "Not scanned" });
  }));
  return rows;
}

export function lastVisitedByZone({ sites = [], scans = [] }) {
  return zoneHealthBreakdown({ sites, scans }).map(row => ({
    ...row,
    lastVisitedAt: row.latest?.createdAt || "",
    freshness: row.latest ? fmtHours(hoursBetween(row.latest.createdAt)) : "Never",
    stale: !row.latest || hoursBetween(row.latest.createdAt) > 7 * 24
  }));
}

export function baselineAudit({ sites = [], scans = [] }) {
  const rows = zoneHealthBreakdown({ sites, scans });
  const completed = rows.filter(r => r.latest).length;
  const total = rows.length;
  return {
    completed,
    total,
    pct: total ? Math.round((completed / total) * 100) : 0,
    rows,
    status: completed === total ? "Baseline complete" : completed ? "Baseline in progress" : "Baseline pending"
  };
}

export function recurringIssueFlags(tickets = []) {
  const grouped = new Map();
  const since = Date.now() - 30 * DAY;
  tickets.filter(t => safeTime(t.createdAt) >= since).forEach(ticket => {
    const key = `${ticket.siteId}||${zoneOf(ticket)}||${normalizeIssueType(ticket)}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(ticket);
  });
  return [...grouped.values()]
    .filter(group => group.length >= 3)
    .map(group => ({ site: group[0].site, zone: zoneOf(group[0]), issueType: normalizeIssueType(group[0]), count: group.length, tickets: group }))
    .sort((a, b) => b.count - a.count);
}

export function replacementFrequencyReport(tickets = []) {
  const replacements = tickets.filter(t => /replace|replacement|dead|mortality|dried|lost/i.test(`${t.issueType || ""} ${t.issue || ""} ${t.description || ""}`));
  const bySite = new Map();
  replacements.forEach(ticket => {
    const key = ticket.siteId;
    if (!bySite.has(key)) bySite.set(key, { site: ticket.site, count: 0, tickets: [] });
    bySite.get(key).count += 1;
    bySite.get(key).tickets.push(ticket);
  });
  return { total: replacements.length, rows: [...bySite.values()].sort((a, b) => b.count - a.count), tickets: replacements };
}

export function visitComplianceReport({ sites = [], scans = [], expectedPerZone = 1 }) {
  const rows = [];
  const since = Date.now() - 7 * DAY;
  sites.forEach(site => (site.zones || ["General"]).forEach(zone => {
    const completed = scans.filter(scan => scan.siteId === site.id && zoneOf(scan) === zone && safeTime(scan.createdAt) >= since).length;
    const pct = Math.min(100, Math.round((completed / expectedPerZone) * 100));
    rows.push({ site, zone, expected: expectedPerZone, completed, pct, status: pct >= 100 ? "Compliant" : pct >= 50 ? "Partial" : "Missed" });
  }));
  const expected = rows.reduce((sum, row) => sum + row.expected, 0);
  const completed = rows.reduce((sum, row) => sum + Math.min(row.completed, row.expected), 0);
  return { pct: expected ? Math.round((completed / expected) * 100) : 0, expected, completed, rows };
}

export function vendorPerformanceScore({ sites = [], scans = [], tickets = [] }) {
  const baseline = baselineAudit({ sites, scans });
  const visits = visitComplianceReport({ sites, scans });
  const closed = tickets.filter(t => t.status === STATUS.CLOSED);
  const open = tickets.filter(t => t.status !== STATUS.CLOSED);
  const slaBreaches = tickets.filter(t => slaState(t).breached).length;
  const evidenceRate = closed.length ? Math.round((closed.filter(t => t.closureEvidence || t.closureEvidenceVerified).length / closed.length) * 100) : 100;
  const avgHealth = scans.length ? +(scans.reduce((sum, scan) => sum + Number(scan.score || 0), 0) / scans.length).toFixed(1) : 0;
  const healthScore = Math.round((avgHealth / 10) * 100);
  const breachPenalty = Math.min(30, slaBreaches * 5);
  const openPenalty = Math.min(15, open.length * 2);
  const score = Math.max(0, Math.min(100, Math.round((baseline.pct * 0.2) + (visits.pct * 0.25) + (evidenceRate * 0.25) + (healthScore * 0.3) - breachPenalty - openPenalty)));
  return { score, baseline, visits, evidenceRate, avgHealth, slaBreaches, openItems: open.length };
}
