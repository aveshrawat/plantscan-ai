import { HEALTH, PRIORITY, STATUS } from "./config.js";
import { tx } from "./store.js";
import { healthCategory } from "./health.js";
import { nowIso, uid, hoursBetween } from "./utils.js";

export function priorityForScan(score) {
  const value = Number(score);
  if (value <= 4.5) return PRIORITY.P1;
  if (value <= 6) return PRIORITY.P2;
  return PRIORITY.P3;
}
function ticketNumber(d) {
  const used = new Set((d.tickets || []).map(t => String(t.ticketNo || "")));
  let value = "";
  do value = String(Math.floor(100000 + Math.random() * 900000));
  while (used.has(value));
  return value;
}
function defaultTicketFields(ticket) {
  return {
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
    expertReason: "",
    ...ticket
  };
}
function logActivity(d, ticketId, activityType, userRole = "system", remarks = "") {
  d.activityLog ||= [];
  d.activityLog.push({ id: uid("act"), ticketId, activityType, userRole, userId: userRole, remarks, timestamp: nowIso() });
}

function normalizeScanScore(value, fallback = 5) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const score = n > 10 && n <= 100 ? n / 10 : n;
  return Math.max(1, Math.min(10, Number(score.toFixed(1))));
}
function normalizeConfidence(value, fallback = 0.65) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n > 1 ? n / 100 : n));
}

function expertFlagFor(score, diagnosis = {}) {
  const text = `${diagnosis.issue_detected || ""} ${diagnosis.root_cause || ""}`.toLowerCase();
  const technical = ["pest", "disease", "root", "soil", "irrigation", "fungal", "green wall"].some(k => text.includes(k));
  return Number(score) <= 4.5 || technical;
}

export function createScanRecord(input, diagnosis, image) {
  return tx(d => {
    const score = normalizeScanScore(diagnosis.condition_score ?? diagnosis.score ?? 5);
    diagnosis.condition_score = score;
    const category = healthCategory(score);
    const identificationConfidence = normalizeConfidence(diagnosis.plant_identification_confidence ?? diagnosis.identification_confidence ?? 0.65);
    const aiPlantName = diagnosis.plant_identified || "Unconfirmed plant";
    const reliablePlantName = input.plantType || (identificationConfidence >= 0.75 ? aiPlantName : `Unconfirmed - ${aiPlantName}`);
    let plant = d.plants.find(p => p.id === input.plantId);
    if (!plant) {
      plant = {
        id: uid("plt"),
        siteId: input.siteId,
        type: reliablePlantName || "Unknown plant",
        aiSuggestedType: aiPlantName,
        identificationConfidence,
        needsManualPlantConfirmation: Boolean(diagnosis.requires_manual_confirmation) || identificationConfidence < 0.75,
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
      type: reliablePlantName || plant.type,
      aiSuggestedType: aiPlantName,
      identificationConfidence,
      needsManualPlantConfirmation: Boolean(diagnosis.requires_manual_confirmation) || identificationConfidence < 0.75,
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
    const shouldCreateSlaTicket = score <= 6;
    if (shouldCreateSlaTicket) {
      const expertRequired = expertFlagFor(score, diagnosis);
      const ticket = defaultTicketFields({
        id: uid("tkt"),
        ticketNo: ticketNumber(d),
        plantId: plant.id,
        siteId: input.siteId,
        priority: priorityForScan(score),
        status: STATUS.OPEN,
        source: input.batchId ? "Batch Scan" : "Auto Scan",
        issueType: score <= 6 ? "SLA-bound plant health action" : "Critical plant health",
        issue: `${category === HEALTH.CRITICAL ? "Critical" : "SLA-bound"} plant health: ${plant.type}`,
        description: input.note || "",
        assignedTo: "Unassigned",
        createdAt: nowIso(),
        startedAt: null,
        closedAt: null,
        closureEvidence: "",
        closureRemark: "",
        createdBy: input.createdBy || "system",
        linkedScanId: scan.id,
        expertRequired,
        expertLevel: expertRequired ? "L3" : "",
        expertReason: expertRequired ? "Low score or technical diagnosis requires horticulture expert review." : ""
      });
      d.tickets.push(ticket);
      scan.linkedTicketId = ticket.id;
      logActivity(d, ticket.id, "created_from_scan", "system", `AI scan score ${score}/10 triggered SLA-bound ${ticket.priority} ticket`);
      if (expertRequired) logActivity(d, ticket.id, "expert_flagged", "system", ticket.expertReason);
    }
    return d;
  });
}
export function createClientTicket({ siteId, plantId = "", issue, description, clientEvidence = "" }) {
  return tx(d => {
    const ticket = defaultTicketFields({
      id: uid("tkt"),
      ticketNo: ticketNumber(d),
      plantId,
      siteId,
      priority: PRIORITY.P1,
      status: STATUS.OPEN,
      source: "Client",
      issueType: "Client concern",
      issue: issue || "Client-raised concern",
      description: description || "",
      assignedTo: "Unassigned",
      createdAt: nowIso(),
      startedAt: null,
      closedAt: null,
      closureEvidence: "",
      closureRemark: "",
      clientEvidence,
      createdBy: "client",
      fmInterventionRequired: true
    });
    d.tickets.push(ticket);
    logActivity(d, ticket.id, "created", "client", "Client raised Priority 1 ticket");
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
      logActivity(d, id, "status_changed", "maintenance", "Ticket moved to In Progress");
    }
    return d;
  });
}
export function attachEvidence(id, evidenceDataUrl, verification = null) {
  return tx(d => {
    const t = d.tickets.find(x => x.id === id);
    if (t) {
      Object.assign(t, {
        closureEvidence: evidenceDataUrl,
        closureEvidenceVerified: !!verification?.accepted,
        closureVerification: verification || null
      });
      logActivity(d, id, "closure_evidence_uploaded", "maintenance", verification?.accepted ? "Closure photo accepted" : "Closure photo uploaded");
    }
    return d;
  });
}
export function closeTicket(id, remark = "") {
  return tx(d => {
    const t = d.tickets.find(x => x.id === id);
    if (!t) throw new Error("Ticket not found");
    if (!t.closureEvidence) throw new Error("Upload closure photo before closing this ticket.");
    if (!t.closureEvidenceVerified) throw new Error("Closure photo must be accepted before closing this ticket.");
    const closedAt = nowIso();
    Object.assign(t, { status: STATUS.CLOSED, closedAt, closureRemark: remark, resolutionHours: +hoursBetween(t.createdAt, closedAt).toFixed(2), slaPaused: false, slaPausedAt: "" });
    logActivity(d, id, "closed", "maintenance", remark || "Ticket closed with verified evidence");
    return d;
  });
}
