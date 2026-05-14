import { HEALTH, PRIORITY, STATUS, NOTIFICATIONS } from "./config.js";
import { tx } from "./store.js";
import { healthCategory } from "./health.js";
import { nowIso, uid, hoursBetween } from "./utils.js";

export function priorityForScan(score) {
  if (Number(score) < 4.5) return PRIORITY.P1;
  if (Number(score) < 6) return PRIORITY.P2;
  return PRIORITY.P3;
}

function siteFor(d, siteId) { return (d.sites || []).find(s => s.id === siteId); }
function clientFor(d, clientId) { return (d.clients || []).find(c => c.id === clientId); }
function supervisorForSite(d, siteId) {
  const site = siteFor(d, siteId);
  return (d.users || []).find(u => u.role === "supervisor" && (u.cityAccess || []).includes(site?.city)) || null;
}
function whatsappUrl(phone, message) {
  const clean = String(phone || NOTIFICATIONS.demoWhatsappNumber || "").replace(/\D/g, "");
  return `https://wa.me/${clean}?text=${encodeURIComponent(message || "")}`;
}
function addWhatsappNotification(d, { ticket, type, recipientRole, sentTo, message }) {
  if (!Array.isArray(d.notifications)) d.notifications = [];
  d.notifications.push({
    id: uid("ntf"),
    ticketId: ticket.id,
    ticketNo: ticket.ticketNo,
    type,
    channel: "whatsapp",
    recipientRole,
    sentTo: sentTo || NOTIFICATIONS.demoWhatsappNumber,
    message,
    waUrl: whatsappUrl(sentTo || NOTIFICATIONS.demoWhatsappNumber, message),
    sentAt: nowIso(),
    status: "ready",
    mode: NOTIFICATIONS.mode || "demo_link"
  });
}
function logClientTicketWhatsapp(d, ticket) {
  const site = siteFor(d, ticket.siteId);
  const client = clientFor(d, site?.clientId);
  const supervisor = supervisorForSite(d, ticket.siteId);
  const phone = NOTIFICATIONS.demoWhatsappNumber;
  const ticketNo = String(ticket.ticketNo || "");
  addWhatsappNotification(d, {
    ticket,
    type: "client_ticket_confirmation",
    recipientRole: "client",
    sentTo: phone,
    message: `GreenOps Ticket Created\n\nTicket: #${ticketNo}\nClient: ${client?.name || "Client"}\nSite: ${site?.name || "Site"}\nZone: General\nIssue: ${ticket.issue}\nPriority: ${ticket.priority}\n\nOur team has been notified. You will receive an update once work starts.`
  });
  addWhatsappNotification(d, {
    ticket,
    type: "p1_supervisor_alert",
    recipientRole: "supervisor",
    sentTo: supervisor?.whatsappNumber || phone,
    message: `P1 Alert — GreenOps ITSM\n\nTicket: #${ticketNo}\nSite: ${site?.name || "Site"}\nIssue: ${ticket.issue}\nRaised by: Client\n\nPlease review and move to In Progress.`
  });
}
function logTicketStatusWhatsapp(d, ticket, type) {
  const site = siteFor(d, ticket.siteId);
  const phone = NOTIFICATIONS.demoWhatsappNumber;
  const message = type === "ticket_closed"
    ? `GreenOps Ticket Closed\n\nTicket #${ticket.ticketNo} has been marked as resolved with closure evidence uploaded.\n\nSite: ${site?.name || "Site"}`
    : `GreenOps Update\n\nTicket #${ticket.ticketNo} is now In Progress.\nOur team has started working on the issue.\n\nSite: ${site?.name || "Site"}`;
  addWhatsappNotification(d, { ticket, type, recipientRole: "client", sentTo: phone, message });
}

function ticketNumber(d) {
  const used = new Set((d.tickets || []).map(t => String(t.ticketNo || "")));
  let value = "";
  do value = String(Math.floor(100000 + Math.random() * 900000));
  while (used.has(value));
  return value;
}

export function createScanRecord(input, diagnosis, image) {
  return tx(d => {
    const score = Number(diagnosis.condition_score ?? diagnosis.score ?? 5);
    const category = healthCategory(score);
    let plant = d.plants.find(p => p.id === input.plantId);
    if (!plant) {
      plant = {
        id: uid("plt"),
        siteId: input.siteId,
        type: input.plantType || diagnosis.plant_identified || "Unknown plant",
        zone: input.zone || "Unmapped",
        latestScore: score,
        latestCategory: category,
        createdAt: nowIso()
      };
      d.plants.push(plant);
    }
    Object.assign(plant, {
      latestScore: score,
      latestCategory: category,
      type: input.plantType || diagnosis.plant_identified || plant.type,
      zone: input.zone || plant.zone
    });
    const scan = {
      id: uid("scn"),
      plantId: plant.id,
      siteId: input.siteId,
      score,
      category,
      diagnosis: diagnosis.issue_detected || "Diagnosis captured",
      rootCause: diagnosis.root_cause || "Root cause not specified",
      instructions: diagnosis.treatment_plan || [diagnosis.immediate_action || "Follow maintenance SOP"],
      image,
      createdAt: nowIso(),
      createdBy: input.createdBy || "field-user",
      batchId: input.batchId || "",
      note: input.note || "",
      raw: diagnosis
    };
    d.scans.push(scan);
    if (category === HEALTH.CRITICAL) {
      d.tickets.push({
        id: uid("tkt"),
        ticketNo: ticketNumber(d),
        plantId: plant.id,
        siteId: input.siteId,
        priority: priorityForScan(score),
        status: STATUS.OPEN,
        source: input.batchId ? "Batch Scan" : "Auto Scan",
        issue: `Critical plant health: ${plant.type}`,
        description: input.note || "",
        assignedTo: "Unassigned",
        createdAt: nowIso(),
        startedAt: null,
        closedAt: null,
        closureEvidence: "",
        closureEvidenceVerified: false,
        closureVerification: null,
        closureRemark: "",
        clientEvidence: "",
        createdBy: input.createdBy || "system"
      });
    }
    return d;
  });
}
export function createClientTicket({ siteId, plantId = "", issue, description, clientEvidence = "" }) {
  return tx(d => {
    const ticket = {
      id: uid("tkt"),
      ticketNo: ticketNumber(d),
      plantId,
      siteId,
      priority: PRIORITY.P1,
      status: STATUS.OPEN,
      source: "Client",
      issue: issue || "Client-raised concern",
      description: description || "",
      assignedTo: "Unassigned",
      createdAt: nowIso(),
      startedAt: null,
      closedAt: null,
      closureEvidence: "",
      closureEvidenceVerified: false,
      closureVerification: null,
      closureRemark: "",
      clientEvidence,
      createdBy: "client"
    };
    d.tickets.push(ticket);
    logClientTicketWhatsapp(d, ticket);
    return d;
  });
}
export function updateTicket(id, patch) {
  return tx(d => { const t = d.tickets.find(x => x.id === id); if (t) Object.assign(t, patch); return d; });
}
export function markInProgress(id) {
  return tx(d => {
    const t = d.tickets.find(x => x.id === id);
    if (t) {
      Object.assign(t, { status: STATUS.IN_PROGRESS, startedAt: nowIso() });
      if (t.source === "Client") logTicketStatusWhatsapp(d, t, "ticket_in_progress");
    }
    return d;
  });
}
export function attachEvidence(id, evidenceDataUrl, verification = null) {
  return updateTicket(id, {
    closureEvidence: evidenceDataUrl,
    closureEvidenceVerified: !!verification?.accepted,
    closureVerification: verification || null
  });
}
export function closeTicket(id, remark = "") {
  return tx(d => {
    const t = d.tickets.find(x => x.id === id);
    if (!t) throw new Error("Ticket not found");
    if (!t.closureEvidence) throw new Error("Upload closure photo before closing this ticket.");
    if (!t.closureEvidenceVerified) throw new Error("Closure photo must be accepted before closing this ticket.");
    const closedAt = nowIso();
    Object.assign(t, { status: STATUS.CLOSED, closedAt, closureRemark: remark, resolutionHours: +hoursBetween(t.createdAt, closedAt).toFixed(2) });
    if (t.source === "Client") logTicketStatusWhatsapp(d, t, "ticket_closed");
    return d;
  });
}
