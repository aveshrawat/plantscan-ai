import { HEALTH, PRIORITY, STATUS, ROLES, NOTIFICATIONS } from "./config.js";
import { tx } from "./store.js";
import { healthCategory } from "./health.js";
import { nowIso, uid, hoursBetween } from "./utils.js";

export function priorityForScan(score) {
  if (Number(score) < 4.5) return PRIORITY.P1;
  if (Number(score) < 6) return PRIORITY.P2;
  return PRIORITY.P3;
}
function ticketNumber(d) {
  const used = new Set((d.tickets || []).map(t => String(t.ticketNo || "")));
  let value = "";
  do value = String(Math.floor(100000 + Math.random() * 900000));
  while (used.has(value));
  return value;
}
function cleanPhone(phone = "") {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.startsWith("91") ? digits : `91${digits.slice(-10)}`;
}
function whatsappUrl(phone, message) {
  const cleaned = cleanPhone(phone || NOTIFICATIONS.demoWhatsappNumber);
  return cleaned ? `https://wa.me/${cleaned}?text=${encodeURIComponent(message)}` : "";
}
function ticketDisplayId(t) {
  return String(t.ticketNo || "").padStart(6, "0").slice(-6);
}
function clientUsersForSite(d, site) {
  return (d.users || []).filter(u => u.role === ROLES.CLIENT && ((u.siteAccess || []).includes(site.id) || (u.clientAccess || []).includes(site.clientId)));
}
function supervisorForSite(d, site) {
  return (d.users || []).find(u => u.role === ROLES.SUPERVISOR && (u.cityAccess || []).includes(site.city));
}
function logWhatsappNotification(d, { ticket, type, recipientRole, sentTo, message }) {
  const record = {
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
    mode: "demo_link"
  };
  d.notifications ||= [];
  d.notifications.push(record);
  return record;
}

export function createScanRecord(input, diagnosis, image) {
  let createdTicket = null;
  tx(d => {
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
      createdTicket = {
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
      };
      d.tickets.push(createdTicket);
    }
    return d;
  });
  return { ticket: createdTicket };
}

export function createClientTicket({ siteId, plantId = "", issue, description, clientEvidence = "" }) {
  let createdTicket = null;
  let notifications = [];
  tx(d => {
    d.notifications ||= [];
    const site = d.sites.find(s => s.id === siteId);
    createdTicket = {
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
    d.tickets.push(createdTicket);
    if (NOTIFICATIONS.whatsappEnabled && site) {
      const ticketNo = ticketDisplayId(createdTicket);
      const clientMessage = `GreenOps Ticket Created\n\nTicket: #${ticketNo}\nSite: ${site.name}\nZone: General / client-raised\nIssue: ${createdTicket.issue}\nPriority: P1\n\nOur team has been notified. You will receive an update once work starts.`;
      const supervisorMessage = `P1 Alert — GreenOps ITSM\n\nTicket: #${ticketNo}\nSite: ${site.name}\nZone: General / client-raised\nIssue: ${createdTicket.issue}\nRaised by: Client\n\nPlease review and move to In Progress.`;
      const clients = clientUsersForSite(d, site);
      const clientRecipient = clients.find(u => u.notifyOnWhatsApp)?.whatsappNumber || NOTIFICATIONS.demoWhatsappNumber;
      const supervisor = supervisorForSite(d, site);
      notifications.push(logWhatsappNotification(d, { ticket: createdTicket, type: "client_ticket_confirmation", recipientRole: "client", sentTo: clientRecipient, message: clientMessage }));
      notifications.push(logWhatsappNotification(d, { ticket: createdTicket, type: "p1_supervisor_alert", recipientRole: "supervisor", sentTo: supervisor?.whatsappNumber || NOTIFICATIONS.demoWhatsappNumber, message: supervisorMessage }));
    }
    return d;
  });
  return { ticket: createdTicket, notifications };
}

export function updateTicket(id, patch) {
  return tx(d => { const t = d.tickets.find(x => x.id === id); if (t) Object.assign(t, patch); return d; });
}
export function markInProgress(id) {
  return tx(d => {
    const t = d.tickets.find(x => x.id === id);
    if (!t) return d;
    Object.assign(t, { status: STATUS.IN_PROGRESS, startedAt: nowIso() });
    const site = d.sites.find(s => s.id === t.siteId);
    if (site && t.source === "Client" && NOTIFICATIONS.whatsappEnabled) {
      const clients = clientUsersForSite(d, site);
      const message = `GreenOps Update\n\nTicket #${ticketDisplayId(t)} is now In Progress.\nOur team has started working on the issue.`;
      logWhatsappNotification(d, { ticket: t, type: "ticket_in_progress", recipientRole: "client", sentTo: clients.find(u => u.notifyOnWhatsApp)?.whatsappNumber || NOTIFICATIONS.demoWhatsappNumber, message });
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
    const site = d.sites.find(s => s.id === t.siteId);
    if (site && t.source === "Client" && NOTIFICATIONS.whatsappEnabled) {
      const clients = clientUsersForSite(d, site);
      const message = `GreenOps Ticket Closed\n\nTicket #${ticketDisplayId(t)} has been marked as resolved with closure evidence uploaded.\n\nYou can view the closure photo in the client portal.`;
      logWhatsappNotification(d, { ticket: t, type: "ticket_closed", recipientRole: "client", sentTo: clients.find(u => u.notifyOnWhatsApp)?.whatsappNumber || NOTIFICATIONS.demoWhatsappNumber, message });
    }
    return d;
  });
}
