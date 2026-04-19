import { downloadFile, fmtDate, toCsv } from "./utils.js";
import { slaState, resolutionTime } from "./sla.js";

export function joinRecords(db, filters = {}) {
  const { clientId = "all", siteId = "all", city = "all", from = "", to = "" } = filters;
  const siteMap = Object.fromEntries(db.sites.map(s => [s.id, s]));
  const clientMap = Object.fromEntries(db.clients.map(c => [c.id, c]));
  const plantMap = Object.fromEntries(db.plants.map(p => [p.id, p]));
  const inRange = iso => (!from || iso.slice(0, 10) >= from) && (!to || iso.slice(0, 10) <= to);
  const matchSite = sid => {
    const site = siteMap[sid];
    if (!site) return false;
    return (clientId === "all" || site.clientId === clientId) && (siteId === "all" || site.id === siteId) && (city === "all" || site.city === city);
  };
  const scans = db.scans.filter(s => matchSite(s.siteId) && inRange(s.createdAt)).map(s => ({ ...s, site: siteMap[s.siteId], client: clientMap[siteMap[s.siteId]?.clientId], plant: plantMap[s.plantId] }));
  const tickets = db.tickets.filter(t => matchSite(t.siteId) && inRange(t.createdAt)).map(t => ({ ...t, site: siteMap[t.siteId], client: clientMap[siteMap[t.siteId]?.clientId], plant: plantMap[t.plantId] }));
  return { scans, tickets };
}

export function exportCsvReport(db, filters) {
  const { scans, tickets } = joinRecords(db, filters);
  const rows = [
    ...scans.map(s => ({ type: "Scan", client: s.client?.name, city: s.site?.city, site: s.site?.name, plant: s.plant?.type, zone: s.plant?.zone, score: s.score, category: s.category, issue: s.diagnosis, ticket_status: "", priority: "", sla: "", created_at: fmtDate(s.createdAt), resolution_time: "" })),
    ...tickets.map(t => ({ type: "Ticket", client: t.client?.name, city: t.site?.city, site: t.site?.name, plant: t.plant?.type || "General", zone: t.plant?.zone || "—", score: "", category: "", issue: t.issue, ticket_status: t.status, priority: t.priority, sla: slaState(t).label, created_at: fmtDate(t.createdAt), resolution_time: resolutionTime(t) }))
  ];
  downloadFile(`greenops-report-${new Date().toISOString().slice(0,10)}.csv`, toCsv(rows));
}
