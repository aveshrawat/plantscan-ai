import { HEALTH, PRIORITY, STATUS } from "./config.js";
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
    d.tickets.push({
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
    });
    return d;
  });
}
export function updateTicket(id, patch) {
  return tx(d => { const t = d.tickets.find(x => x.id === id); if (t) Object.assign(t, patch); return d; });
}
export function markInProgress(id) {
  return updateTicket(id, { status: STATUS.IN_PROGRESS, startedAt: nowIso() });
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
    return d;
  });
}
