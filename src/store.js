import { APP, INITIAL_DB, STATUS } from "./config.js";
import { uid, nowIso } from "./utils.js";

const clone = value => JSON.parse(JSON.stringify(value));
function randomTicketNo(d) {
  const used = new Set((d.tickets || []).map(t => String(t.ticketNo || "")));
  let value = "";
  do value = String(Math.floor(100000 + Math.random() * 900000));
  while (used.has(value));
  return value;
}
function hoursAgo(hours) { return new Date(Date.now() - hours * 36e5).toISOString(); }
function daysAgo(days) { return new Date(Date.now() - days * 86400000).toISOString(); }
function addActivity(d, ticketId, type, userRole = "system", remarks = "") {
  d.activityLog ||= [];
  d.activityLog.push({ id: uid("act"), ticketId, activityType: type, userRole, userId: userRole, remarks, timestamp: nowIso() });
}
function defaultTicketFields(t) {
  return Object.assign({
    closureEvidenceVerified: false,
    closureVerification: null,
    clientEvidence: "",
    reopenCount: 0,
    actionRequiredOwner: "",
    actionRequiredNote: "",
    blockerOwner: "",
    blockerReason: "",
    slaPaused: false,
    slaPausedAt: "",
    expertRequired: false,
    expertLevel: "",
    expertReason: ""
  }, t);
}
function pushTicket(d, ticket) {
  const next = defaultTicketFields({ id: uid("tkt"), ticketNo: randomTicketNo(d), ...ticket });
  d.tickets.push(next);
  addActivity(d, next.id, "created", next.source === "Client" ? "client" : "system", next.issue || "Ticket created");
  return next;
}

let db = load();

function load() {
  try {
    const stored = localStorage.getItem(APP.storageKey);
    const base = clone(INITIAL_DB);
    const parsed = stored ? JSON.parse(stored) : null;
    return parsed ? { ...base, ...parsed, activityLog: parsed.activityLog || [] } : base;
  } catch {
    return clone(INITIAL_DB);
  }
}
function save() { localStorage.setItem(APP.storageKey, JSON.stringify(db)); }
export const getDb = () => clone(db);
export const setDb = next => { db = clone(next); save(); return getDb(); };
export const tx = fn => { const draft = clone(db); const result = fn(draft) ?? draft; db = result; save(); window.dispatchEvent(new CustomEvent("db:changed")); return getDb(); };
export const resetDb = () => { db = clone(INITIAL_DB); save(); window.dispatchEvent(new CustomEvent("db:changed")); };

function enrichDemoData(d) {
  d.activityLog ||= [];
  d.tickets = (d.tickets || []).map(defaultTicketFields);

  const openAuto = d.tickets.filter(t => t.source !== "Client" && t.status !== STATUS.CLOSED);
  openAuto.slice(0, 4).forEach((t, index) => {
    t.status = STATUS.CLOSED;
    t.startedAt = t.startedAt || new Date(new Date(t.createdAt).getTime() + 2 * 36e5).toISOString();
    t.closedAt = new Date(new Date(t.createdAt).getTime() + (10 + index * 2) * 36e5).toISOString();
    t.closureRemark = "Resolved through routine maintenance and verified closure workflow.";
    t.closureEvidenceVerified = true;
    t.resolutionHours = Number(((new Date(t.closedAt) - new Date(t.createdAt)) / 36e5).toFixed(2));
    addActivity(d, t.id, "closed", "maintenance", "Demo closure for efficiency analytics");
  });

  const paused = openAuto[4];
  if (paused) {
    Object.assign(paused, {
      status: STATUS.PAUSED,
      slaPaused: true,
      slaPausedAt: hoursAgo(7),
      blockerOwner: "IFM",
      blockerReason: "Access pending: lobby area temporarily locked for guest movement.",
      actionRequiredOwner: "IFM",
      actionRequiredNote: "Confirm work window and provide access to close the ticket."
    });
    addActivity(d, paused.id, "sla_paused", "system", paused.blockerReason);
  }

  const expert = openAuto[5];
  if (expert) {
    Object.assign(expert, {
      expertRequired: true,
      expertLevel: "L3",
      expertReason: "Repeated low score pattern needs horticulture expert review."
    });
    addActivity(d, expert.id, "expert_flagged", "system", expert.expertReason);
  }

  const closedForReopen = d.tickets.find(t => t.status === STATUS.CLOSED && !t.reopenCount);
  if (closedForReopen) {
    closedForReopen.reopenCount = 1;
    addActivity(d, closedForReopen.id, "reopened", "system", "Issue reappeared within 7 days in the same zone.");
  }

  const site = d.sites.find(s => s.id === "site-mar-blr") || d.sites[0];
  const plant = d.plants.find(p => p.siteId === site?.id && p.zone === "Lobby") || d.plants.find(p => p.siteId === site?.id);
  if (site && plant && !d.tickets.some(t => t.issueType === "Recurring low health" && t.siteId === site.id)) {
    [18, 11, 4].forEach((days, i) => {
      const createdAt = daysAgo(days);
      const t = pushTicket(d, {
        plantId: plant.id,
        siteId: site.id,
        priority: i === 2 ? "P1" : "P2",
        status: i === 2 ? STATUS.IN_PROGRESS : STATUS.CLOSED,
        source: "Auto Scan",
        issueType: "Recurring low health",
        issue: `Recurring low health: ${plant.type}`,
        description: "Same high-visibility zone has repeated health drop.",
        assignedTo: "Maintenance Staff",
        createdAt,
        startedAt: new Date(new Date(createdAt).getTime() + 2 * 36e5).toISOString(),
        closedAt: i === 2 ? null : new Date(new Date(createdAt).getTime() + 14 * 36e5).toISOString(),
        closureRemark: i === 2 ? "" : "Temporary recovery achieved; recurrence pattern still visible.",
        closureEvidenceVerified: i !== 2,
        expertRequired: i === 2,
        expertLevel: i === 2 ? "L3" : "",
        expertReason: i === 2 ? "Third recurrence in 30 days; species/location suitability review required." : ""
      });
      if (t.status === STATUS.CLOSED) addActivity(d, t.id, "closed", "maintenance", "Closed recurring issue instance");
    });
  }
}

export function seedDemoData() {
  tx(d => {
    if (d.meta.seeded && Number(d.meta.version || 0) >= 3) return d;
    if (!d.meta.seeded) {
      const siteIds = d.sites.map(s => s.id);
      const plantTypes = ["Areca Palm", "Money Plant", "Peace Lily", "ZZ Plant", "Ficus Lyrata", "Philodendron", "Aglaonema", "Dracaena"];
      const zones = ["Reception", "Cafe", "Boardroom", "Lift Lobby", "Workbay A", "Workbay B", "Drop-off", "Atrium"];
      const offsets = [22, 18, 14, 10, 7, 4, 2, 1];
      siteIds.forEach((siteId, sIndex) => {
        Array.from({ length: 10 }).forEach((_, i) => {
          const score = [8.4, 7.5, 6.6, 5.8, 5.1, 8.9, 6.2, 7.1, 4.4, 8.0][(i + sIndex) % 10];
          const plant = { id: uid("plt"), siteId, type: plantTypes[(i + sIndex) % plantTypes.length], zone: zones[i % zones.length], latestScore: score, latestCategory: score >= 7 ? "Healthy" : score >= 6 ? "Monitor" : "Critical", createdAt: nowIso() };
          d.plants.push(plant);
          const createdAt = new Date(Date.now() - offsets[(i + sIndex) % offsets.length] * 86400000).toISOString();
          d.scans.push({ id: uid("scn"), plantId: plant.id, siteId, score, category: plant.latestCategory, diagnosis: score < 6 ? "Visible stress and decline pattern detected" : score < 7 ? "Mild stress, monitor closely" : "Plant appears stable", rootCause: score < 6 ? "Likely watering/light imbalance" : "Routine observation", instructions: score < 6 ? ["Isolate from AC draft", "Check soil moisture", "Remove damaged leaves", "Recheck within 48 hours"] : ["Continue scheduled maintenance"], image: "", createdAt, createdBy: "u-maint-1" });
          if (score < 6) pushTicket(d, { plantId: plant.id, siteId, priority: score < 4.5 ? "P1" : "P2", status: i % 3 === 0 ? STATUS.IN_PROGRESS : STATUS.OPEN, source: "Auto Scan", issueType: "Critical plant health", issue: `Critical plant health: ${plant.type}`, assignedTo: "Maintenance Staff", createdAt, startedAt: i % 3 === 0 ? new Date(Date.now() - 18 * 36e5).toISOString() : null, closedAt: null, closureEvidence: "", closureRemark: "", createdBy: "system" });
        });
      });
    }
    enrichDemoData(d);
    d.meta.seeded = true;
    d.meta.version = 3;
    return d;
  });
}
