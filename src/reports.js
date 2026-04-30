import { downloadFile } from "./utils.js";
import { slaState } from "./sla.js";

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

const HEADERS = [
  "Report Date",
  "Site Name",
  "City",
  "Plant Zone/Location",
  "Plant Type",
  "Health Score",
  "Health Status",
  "Ticket ID (if any)",
  "Ticket Status",
  "SLA Met (Yes/No)",
  "Technician Name",
  "Last Service Date",
  "Notes"
];

function formatDateDDMMYYYY(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function isoDate(iso = new Date().toISOString()) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function ticketNo(t) {
  if (!t) return "";
  if (t.ticketNo) return String(t.ticketNo).padStart(6, "0").slice(-6);
  return String(t.id || "");
}

function normalizeHealthStatus(value) {
  if (value === "Healthy" || value === "Monitor" || value === "Critical") return value;
  return "";
}

function userName(db, id, fallback = "") {
  if (!id) return fallback || "";
  return db.users?.find(u => u.id === id)?.name || fallback || id;
}

function latestScanForPlant(scans, plantId) {
  return scans
    .filter(s => s.plantId && s.plantId === plantId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;
}

function ticketForScan(tickets, scan) {
  return tickets
    .filter(t => {
      if (scan.plantId && t.plantId === scan.plantId) return true;
      return !t.plantId && t.siteId === scan.siteId && Math.abs(new Date(t.createdAt) - new Date(scan.createdAt)) < 24 * 60 * 60 * 1000;
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;
}

function csvEscape(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function toCsv(headers, rows) {
  return [
    headers.join(","),
    ...rows.map(row => headers.map(header => csvEscape(row[header])).join(","))
  ].join("\n");
}

function sanitizeFilePart(value) {
  return String(value || "All-Sites")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 80) || "All-Sites";
}

function reportSiteName(db, filters, rows) {
  if (filters?.siteId && filters.siteId !== "all") {
    return db.sites.find(s => s.id === filters.siteId)?.name || "Selected-Site";
  }
  const uniqueSites = [...new Set(rows.map(r => r["Site Name"]).filter(Boolean))];
  return uniqueSites.length === 1 ? uniqueSites[0] : "All-Sites";
}

function rowFromScan(db, scan, matchingTicket) {
  const sla = matchingTicket ? slaState(matchingTicket) : null;
  return {
    "Report Date": formatDateDDMMYYYY(scan.createdAt),
    "Site Name": scan.site?.name || "",
    "City": scan.site?.city || "",
    "Plant Zone/Location": scan.plant?.zone || "",
    "Plant Type": scan.plant?.type || "",
    "Health Score": scan.score ?? "",
    "Health Status": normalizeHealthStatus(scan.category),
    "Ticket ID (if any)": ticketNo(matchingTicket),
    "Ticket Status": matchingTicket?.status || "",
    "SLA Met (Yes/No)": matchingTicket ? (sla?.breached ? "No" : "Yes") : "Yes",
    "Technician Name": userName(db, scan.createdBy),
    "Last Service Date": formatDateDDMMYYYY(scan.createdAt),
    "Notes": scan.note || scan.diagnosis || ""
  };
}

function rowFromTicket(db, ticket, latestScan) {
  const sla = slaState(ticket);
  return {
    "Report Date": formatDateDDMMYYYY(ticket.createdAt),
    "Site Name": ticket.site?.name || "",
    "City": ticket.site?.city || "",
    "Plant Zone/Location": ticket.plant?.zone || "",
    "Plant Type": ticket.plant?.type || "General",
    "Health Score": latestScan?.score ?? "",
    "Health Status": normalizeHealthStatus(latestScan?.category),
    "Ticket ID (if any)": ticketNo(ticket),
    "Ticket Status": ticket.status || "",
    "SLA Met (Yes/No)": sla?.breached ? "No" : "Yes",
    "Technician Name": userName(db, ticket.assignedTo, ticket.assignedTo || ""),
    "Last Service Date": formatDateDDMMYYYY(latestScan?.createdAt || ticket.closedAt || ticket.startedAt || ticket.createdAt),
    "Notes": ticket.description || ticket.closureRemark || ticket.issue || ""
  };
}

export function exportCsvReport(db, filters = {}) {
  const { scans, tickets } = joinRecords(db, filters);
  const rows = [];
  const usedTicketIds = new Set();

  scans
    .slice()
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .forEach(scan => {
      const matchingTicket = ticketForScan(tickets, scan);
      if (matchingTicket) usedTicketIds.add(matchingTicket.id);
      rows.push(rowFromScan(db, scan, matchingTicket));
    });

  tickets
    .filter(ticket => !usedTicketIds.has(ticket.id))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .forEach(ticket => rows.push(rowFromTicket(db, ticket, latestScanForPlant(scans, ticket.plantId))));

  const siteName = sanitizeFilePart(reportSiteName(db, filters, rows));
  const fileDate = isoDate();
  const csv = "\uFEFF" + toCsv(HEADERS, rows);
  downloadFile(`GreenOps-Report-${siteName}-${fileDate}.csv`, csv, "text/csv;charset=utf-8");
}
