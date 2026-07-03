function printReportHeading() {
  const role = effectiveRole();
  if (role === ROLES.CLIENT) return `<h1>Client Service Summary Report</h1><p class="print-subtitle">Client-facing summary of site condition, open tickets, SLA movement, reports, invoices, and closure evidence.</p>`;
  if (role === ROLES.MAINTENANCE) return `<h1>Field Scan Checklist Report</h1><p class="print-subtitle">Field-facing record of scans, actions, root causes, next steps, and closure evidence.</p>`;
  return `<h1>Supervisor Operations Report</h1><p class="print-subtitle">Supervisor summary of scan coverage, health condition, open issues, SLA risk, recurring issues, and verified closure evidence.</p>`;
}

function buildPrintableReport() {
  const { db } = dbx();
  const { scans, tickets } = visibleRecords();
  const hs = healthSummary(scans);
  const open = tickets.filter(t => t.status !== STATUS.CLOSED);
  const breached = open.filter(t => slaState(t).breached);
  const closed = tickets.filter(t => t.status === STATUS.CLOSED);
  const verified = closed.filter(t => t.closureEvidenceVerified || t.closureEvidence);
  const generatedAt = new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  const user = currentUser();
  return `<section id="printReport" class="print-report" aria-label="Printable GreenOps report">
    <header class="print-report-header">
      <div>
        <p class="print-kicker">GreenOps ITSM</p>
        ${printReportHeading()}
      </div>
      <div class="print-report-meta">
        <strong>${escapeHtml(APP.name)}</strong>
        <span>Generated: ${escapeHtml(generatedAt)}</span>
        <span>Prepared by: ${escapeHtml(user?.name || "GreenOps")}</span>
      </div>
    </header>

    <section class="print-report-context">
      <div><span>Report scope</span><strong>${escapeHtml(filterSummaryLabel())}</strong></div>
      <div><span>Purpose</span><strong>Operational proof for green asset visibility and service accountability</strong></div>
    </section>

    <section class="print-report-metrics">
      <div><span>Total scans</span><strong>${scans.length}</strong></div>
      <div><span>Average health</span><strong>${hs.avg || "—"}</strong></div>
      <div><span>Healthy</span><strong>${hs.healthy}</strong></div>
      <div><span>Monitor</span><strong>${hs.monitor}</strong></div>
      <div><span>Critical</span><strong>${hs.critical}</strong></div>
      <div><span>Open issues</span><strong>${open.length}</strong></div>
      <div><span>SLA risk</span><strong>${breached.length}</strong></div>
      <div><span>Verified closures</span><strong>${verified.length}</strong></div>
    </section>

    <section class="print-report-summary">
      <h2>Executive summary</h2>
      <ul>
        <li>${scans.length ? `${scans.length} scan record(s) captured under the selected scope.` : "No scan records captured yet under the selected scope."}</li>
        <li>${open.length ? `${open.length} open work item(s) require operational follow-up.` : "No open work items under the selected scope."}</li>
        <li>${breached.length ? `${breached.length} item(s) are currently at SLA risk.` : "No SLA-risk item currently visible under the selected scope."}</li>
        <li>${verified.length ? `${verified.length} closure(s) have evidence retained for review.` : "Closure evidence will appear here once tickets are resolved with proof."}</li>
      </ul>
    </section>

    <section class="print-report-table-block">
      <h2>Recent operational records</h2>
      <table class="print-report-table">
        <thead><tr><th>Type</th><th>Site</th><th>Zone</th><th>Details</th><th>Score / Priority</th><th>Status</th><th>Date</th></tr></thead>
        <tbody>${printableReportRows(scans, tickets, db)}</tbody>
      </table>
    </section>

    <footer class="print-report-footer">This report is generated from GreenOps ITSM records. It is intended for internal property, FM, and leadership review.</footer>
  </section>`;
}

function preparePrintReport() {
  document.querySelector("#printReport")?.remove();
  document.body.insertAdjacentHTML("beforeend", buildPrintableReport());
}

function historyView(scans, tickets) { const closed = tickets.filter(t => t.status === STATUS.CLOSED); return `<section class="card"><div class="card-title"><h3>Closed Work History</h3><button class="btn secondary" data-action="download-report">Export</button></div>${metrics(scans, tickets)}${ticketBoard(closed, { scope: "maintenance" })}</section>`; }
function evidenceView(tickets) { const closed = tickets.filter(t => t.status === STATUS.CLOSED && t.closureEvidence); return `<section class="card"><h3>Closure Evidence</h3><p class="subtitle">Client-facing proof of work. Closure photos are accepted only after health check.</p>${closed.length ? `<div class="grid grid-3">${closed.map(t => `<div class="ticket-card"><img class="preview" src="${t.closureEvidence}" alt="Evidence"><strong>${escapeHtml(t.issue)}</strong><span class="small muted">${fmtDate(t.closedAt)} - ${resolutionTime(t)}</span><span class="pill good">Verified closure photo</span></div>`).join("")}</div>` : `<div class="empty">No closed tickets with evidence yet.</div>`}</section>`; }
function healthBuckets(scans) {
  const hs = healthSummary(scans);
  const total = hs.total || 1;
  return `<div class="health-buckets-card"><h3>Health buckets</h3><div class="health-bucket-list">${bucket("Healthy", hs.healthy, total, "healthy")}${bucket("Monitor", hs.monitor, total, "monitor")}${bucket("Critical", hs.critical, total, "critical")}</div></div>`;
}
function bucket(label, value, total, cls) {
  const pct = Math.round((value / total) * 100);
  return `<div class="health-bucket-row ${cls}"><div class="health-bucket-row-top"><span>${label}</span><strong>${value}</strong></div><div class="health-bucket-bar"><i style="width:${pct}%"></i></div></div>`;
}
function ticketDisplayId(t) { if (t.ticketNo) return String(t.ticketNo).padStart(6, "0").slice(-6); const raw = String(t.id || ""); let hash = 0; for (let i = 0; i < raw.length; i++) hash = ((hash << 5) - hash + raw.charCodeAt(i)) >>> 0; return String(100000 + (hash % 900000)); }
function ticketCards(tickets) { if (!tickets.length) return `<div class="empty">No tickets in this queue.</div>`; return `<div class="grid">${tickets.map(t => ticketCard(t)).join("")}</div>`; }
function ticketCard(t) { const { siteMap, plantMap } = dbx(); const s = slaState(t); const plant = plantMap[t.plantId]; const site = siteMap[t.siteId]; return `<div class="ticket-card"><div class="ticket-head"><strong>${escapeHtml(t.issue)}</strong><span class="pill ${t.priority.toLowerCase()}">${t.priority}</span></div><div class="ticket-meta"><span class="pill">#${ticketDisplayId(t)}</span><span class="pill ${t.status === STATUS.CLOSED ? "closed" : t.status === STATUS.IN_PROGRESS ? "progress" : t.status === STATUS.PAUSED ? "monitor" : "open"}">${t.status}</span><span class="pill ${s.breached ? "critical" : "good"}">${s.label}</span></div><div class="small muted">${escapeHtml(site?.city)} · ${escapeHtml(site?.name)} · ${escapeHtml(plant?.zone || "General")}</div></div>`; }
function ticketBoard(tickets, { scope = "supervisor", compact = false } = {}) { const { siteMap, plantMap } = dbx(); if (!tickets.length) return `<div class="empty">No tickets found for selected filters.</div>`; const columns = compact ? `<tr><th>Ticket</th><th>Location</th><th>Priority</th><th>Status</th><th>SLA</th></tr>` : `<tr><th>Ticket</th><th>Location</th><th>Priority</th><th>Status</th><th>SLA</th><th>Evidence / Action</th></tr>`; return `<div class="table-wrap"><table><thead>${columns}</thead><tbody>${tickets.map(t => { const s = slaState(t); const site = siteMap[t.siteId]; const plant = plantMap[t.plantId]; const row = `<td><strong>${escapeHtml(t.issue)}</strong><br><span class="small muted">Ticket #${ticketDisplayId(t)}<br>${fmtDate(t.createdAt)}</span></td><td>${escapeHtml(site?.city)}<br><span class="small muted">${escapeHtml(site?.name)} · ${escapeHtml(plant?.zone || "General")}</span></td><td><span class="pill ${t.priority.toLowerCase()}">${t.priority}</span></td><td><span class="pill ${t.status === STATUS.CLOSED ? "closed" : t.status === STATUS.IN_PROGRESS ? "progress" : t.status === STATUS.PAUSED ? "monitor" : "open"}">${t.status}</span><br><span class="small muted">Resolution: ${resolutionTime(t)}</span></td><td><span class="pill ${s.breached ? "critical" : "good"}">${s.label}</span><br><span class="small muted">Age ${s.ageLabel}; closure SLA ${s.closureHours}h</span></td>`; return `<tr>${compact ? row : `${row}<td>${ticketActions(t, scope)}</td>`}</tr>`; }).join("")}</tbody></table></div>`; }
function ticketActions(t, scope) {
  if (scope === "client") {
    return t.closureEvidence
      ? `<img class="evidence-img" src="${t.closureEvidence}" alt="Evidence"><br><span class="small muted">${escapeHtml(t.closureRemark || "Closed with verified evidence")}</span>`
      : `${t.clientEvidence ? `<img class="evidence-img" src="${t.clientEvidence}" alt="Client issue photo"><br><span class="small muted">Your issue photo is attached.</span>` : `<span class="small muted">Tracked by operations team</span>`}`;
  }
  if (t.status === STATUS.CLOSED) return `${t.closureEvidence ? `<img class="evidence-img" src="${t.closureEvidence}" alt="Evidence">` : ""}<br><span class="small muted">${escapeHtml(t.closureRemark || "Closed")}</span>`;
  const verifyLabel = t.closureEvidenceVerified ? `<span class="pill good">Closure photo accepted</span>` : t.closureEvidence ? `<span class="pill monitor">Photo pending acceptance</span>` : "";
  return `<div class="actions">${t.status === STATUS.OPEN ? `<button class="mini-btn" data-action="progress" data-id="${t.id}">Start</button>` : ""}<label class="mini-btn">Closure Photo<input class="hidden" type="file" accept="image/*" capture="environment" data-evidence="${t.id}"></label>${t.closureEvidence ? `<img class="evidence-img" src="${t.closureEvidence}" alt="Evidence">` : ""}${verifyLabel}<button class="mini-btn" data-action="close" data-id="${t.id}">Close</button></div>`;
}

function drawCharts() { 
  $$("canvas[data-chart]").forEach(canvas => { 
    const rawData = canvas.dataset.chart || "[]";
    let data = JSON.parse(rawData);
    const rect = canvas.getBoundingClientRect(); 
    const ratio = window.devicePixelRatio || 1; 
    canvas.width = rect.width * ratio; 
    canvas.height = rect.height * ratio; 
    const ctx = canvas.getContext("2d"); 
    ctx.scale(ratio, ratio); 
    const w = rect.width, h = rect.height, pad = 34; 
    ctx.clearRect(0,0,w,h); 
    
    // Handle multi-series (object with keys) vs single series (array)
    let seriesList = [];
    let maxVal = 10;
    if (data && typeof data === 'object' && !Array.isArray(data) && data.series) {
      seriesList = data.series;
      let allVals = seriesList.flatMap(s => s.data.map(d => d.avg));
      maxVal = Math.max(10, ...allVals);
    } else if (Array.isArray(data)) {
      seriesList = [{ label: "Avg", data: data }];
      maxVal = Math.max(10, ...data.map(d => d.avg));
    }
    
    if (!seriesList.length || !seriesList[0].data.length) { 
      ctx.fillStyle = "#6d756f"; ctx.font = "13px Inter"; ctx.fillText("No scan data yet", pad, h/2); return; 
    }
    
    const colors = ["#0c4a6e", "#079455", "#b54708"]; // Matched to our new accent colors
    seriesList.forEach((series, sIdx) => {
      const pts = series.data;
      const xs = (i) => pad + (w-pad*2)*(pts.length===1?0.5:i/(pts.length-1));
      const ys = (v) => h-pad - (h-pad*2)*(v/maxVal);
      ctx.strokeStyle = colors[sIdx % colors.length]; 
      ctx.lineWidth = 2.5; // Thinner, sharper line
      ctx.beginPath();
      pts.forEach((d,i)=> i?ctx.lineTo(xs(i),ys(d.avg)):ctx.moveTo(xs(i),ys(d.avg)));
      ctx.stroke();
      // Add dots
      ctx.fillStyle = colors[sIdx % colors.length];
      pts.forEach((d,i) => { 
        ctx.beginPath(); 
        ctx.arc(xs(i),ys(d.avg),3,0,Math.PI*2); // Smaller dots
        ctx.fill(); 
      });
    });
    ctx.fillStyle = "#6d756f"; ctx.font = "12px Inter"; 
    ctx.fillText("0", 10, h-pad); 
    ctx.fillText(maxVal, 8, pad+4);
    if (seriesList.length === 1) ctx.fillText("Avg health score", pad, 18);
  }); 
}


function stopCameraCapture() {
  activeCameraStream?.getTracks?.().forEach(track => track.stop());
  activeCameraStream = null;
  document.querySelector(".camera-modal")?.remove();
}
async function openCameraCapture() {
  syncScanDraftFromDom();
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Live camera is not supported in this browser. Use Quick phone camera instead.");
  stopCameraCapture();
  const modal = document.createElement("div");
  modal.className = "camera-modal";
  modal.innerHTML = `<div class="camera-dialog"><div class="card-title"><div><h3>Live plant capture</h3><p class="subtitle">Hold steady. Capture the full plant and visible leaf condition.</p></div><button class="mini-btn danger" type="button" data-camera-close>Close</button></div><video autoplay playsinline muted class="camera-video"></video><canvas class="hidden" data-camera-canvas></canvas><div class="camera-help"><span>Use rear camera where available</span><span>Avoid glare and dark background</span><span>Retake if leaves are blurred</span></div><button class="btn" type="button" data-camera-shot>Capture photo</button></div>`;
  document.body.appendChild(modal);
  const video = modal.querySelector("video");
  try {
    activeCameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    video.srcObject = activeCameraStream;
    await video.play();
  } catch (error) {
    stopCameraCapture();
    throw new Error("Camera permission failed. Use Phone camera instead.");
  }
  modal.querySelector("[data-camera-close]").addEventListener("click", stopCameraCapture);
  modal.addEventListener("click", e => { if (e.target === modal) stopCameraCapture(); });
  modal.querySelector("[data-camera-shot]").addEventListener("click", () => {
    const canvas = modal.querySelector("[data-camera-canvas]");
    const sourceW = video.videoWidth || 1280;
    const sourceH = video.videoHeight || 720;
    const maxEdge = 1024;
    const scale = Math.min(1, maxEdge / Math.max(sourceW, sourceH));
    canvas.width = Math.round(sourceW * scale);
    canvas.height = Math.round(sourceH * scale);
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    state.scanImage = canvas.toDataURL("image/jpeg", 0.72);
    state.scanCaptureSource = "live_camera";
    state.lastDiagnosis = null;
    updateScanImageUi();
    stopCameraCapture();
    toast("Live camera photo captured.");
  });
}

async function safeJson(res) {
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { return { error: text?.slice?.(0, 500) || "Unexpected server response" }; }
}

async function estimateImageHealthStats(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const maxEdge = 260;
        const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
        canvas.width = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
        canvas.height = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let relevant = 0, green = 0, brown = 0, yellow = 0, dark = 0;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2];
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          const sat = max - min;
          const avg = (r + g + b) / 3;
          const nearWhiteBackground = r > 220 && g > 220 && b > 220;
          // Ignore walls, glare, white backgrounds and low-saturation office surfaces.
          if (sat <= 22 || avg >= 235 || nearWhiteBackground) continue;
          relevant += 1;

          // Mutually exclusive classes. The previous logic double-counted green leaves as
          // brown/yellow and counted wooden floors/tables as stressed foliage, causing false
          // "Critical" scores in demo images.
          const isGreen = g >= r * 1.02 && g >= b * 1.08 && g > 45;
          const isYellow = !isGreen && r > 115 && g > 85 && b < 135 && r >= g * 0.78 && r <= g * 1.75 && g > b * 1.15;
          const isBrown = !isGreen && !isYellow && r > 65 && g > 35 && b < 125 && r > g * 1.03 && g > b * 1.03;
          const isDark = !isGreen && !isYellow && !isBrown && avg < 45;

          if (isGreen) green += 1;
          else if (isYellow) yellow += 1;
          else if (isBrown) brown += 1;
          else if (isDark) dark += 1;
        }
        const denom = Math.max(1, relevant);
        const brownYellow = brown + yellow;
        resolve({
          relevantPixelCount: relevant,
          greenRatio: Number((green / denom).toFixed(3)),
          brownYellowRatio: Number((brownYellow / denom).toFixed(3)),
          darkRatio: Number((dark / denom).toFixed(3)),
          stressRatio: Number((Math.min(denom, brownYellow + dark) / denom).toFixed(3))
        });
      } catch (error) {
        reject(error);
      }
    };
    img.onerror = () => reject(new Error("Unable to read image for local health estimate"));
    img.src = dataUrl;
  });
}


function imageHashForDiagnosis(dataUrl = "") {
  let hash = 2166136261;
  const text = String(dataUrl || "");
  const step = Math.max(1, Math.floor(text.length / 9000));
  for (let i = 0; i < text.length; i += step) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
function diagnosisKeyForImage(image, draft = {}, batchId = "") {
  const siteId = draft.siteId || "site";
  const location = draft.placementBucket || draft.zone || draft.floor || "location";
  return ["ai-sla", siteId, location, batchId || "single", imageHashForDiagnosis(image)].join(":");
}
function autoCreateSlaTicketFromDiagnosis({ image, draft = {}, data = {}, result = {}, batchId = "" }) {
  if (!result.ticketCreated) return false;
  const db = getDb();
  const siteId = draft.siteId || allowedSites(db)[0]?.id || "";
  if (!siteId || !allowedSiteIds(db).includes(siteId)) return false;
  const line = (db.boqLines || []).find(item => item.id === draft.boqLineId) ||
    baselineForSite(db, siteId).find(item => item.floor === draft.floor && item.placementBucket === draft.placementBucket);
  createScanRecord({
    siteId,
    zone: draft.placementBucket || draft.floor || draft.zone || "AI scan",
    plantType: draft.plantType || line?.plantSpecies || "",
    note: draft.note || data.immediate_action || data.issue_detected || "Auto-created from AI health scan",
    createdBy: currentUser()?.id || "field-user",
    batchId,
    diagnosisKey: diagnosisKeyForImage(image, draft, batchId)
  }, data, image);
  return true;
}

async function diagnoseFromState() {
  if (state.diagnosisRunning) return;
  syncScanDraftFromDom();
  const draft = { ...state.scanDraft };
  if (!state.scanImage) throw new Error("Capture a plant image before diagnosis.");
  const out = $("#scanOutput");
  const diagBtn = document.querySelector("#runDiagnosisBtn");
  state.diagnosisRunning = true;
  if (diagBtn) { diagBtn.disabled = true; diagBtn.textContent = "Analysing..."; }
  if (out) out.innerHTML = `<div class="card soft"><strong>Checking plant health...</strong><p class="subtitle">Please wait. The scan result will appear here.</p></div>`;
  let result;
  try {
    result = await diagnoseImage({ image: state.scanImage, draft });
  } catch (err) {
    if (out) out.innerHTML = `<div class="card soft"><p class="danger-text">${escapeHtml(err.message || "Diagnosis failed. Please retry with a clear plant photo.")}</p></div>`;
    throw err;
  } finally {
    state.diagnosisRunning = false;
    if (diagBtn) { diagBtn.disabled = false; diagBtn.textContent = "Run AI Diagnosis"; }
  }
  const data = result.data;
  state.lastDiagnosis = { image: state.scanImage, data, result, diagnosisKey: diagnosisKeyForImage(state.scanImage, draft) };
  const slaAutoCreated = autoCreateSlaTicketFromDiagnosis({ image: state.scanImage, draft, data, result });
  result.slaAutoCreated = slaAutoCreated;
  const submitLogBtn = document.querySelector('[data-action="submit-service-log"]');
  if (submitLogBtn) {
    submitLogBtn.textContent = result.ticketCreated ? "Add Field Notes (Optional)" : "Submit Routine Service Log";
    submitLogBtn.title = result.ticketCreated
      ? "SLA ticket is already created by AI. Field notes are optional supporting evidence."
      : "Submit routine service proof when no SLA ticket is required.";
  }
  if (data.service_log_suggestion) {
    state.scanDraft.wateringDone = String(Boolean(data.service_log_suggestion.wateringDone));
    state.scanDraft.issueFound = String(Boolean(data.service_log_suggestion.issueFound));
    state.scanDraft.issueCategory = data.service_log_suggestion.issueCategory || state.scanDraft.issueCategory;
  }
  const enText = [data.issue_detected, data.root_cause, data.immediate_action, ...(data.treatment_plan || [])].filter(Boolean).join(". ");
  const hiText = [data.issue_detected_hi, data.root_cause_hi, data.immediate_action_hi, ...(data.treatment_plan_hi || [])].filter(Boolean).join(". ");
  const fallbackNote = "";
  if (out) out.innerHTML = `<div class="card scan-result"><div class="scan-result-hero"><div><span class="eyebrow dark">AI diagnosis result</span><h3>${escapeHtml(data.plant_identified || "Plant diagnosed")}</h3><div class="mobile-health-inline ${healthClass(result.category)}"><span>Plant health score</span><strong>${healthScoreLabel(result.score)}</strong><small>${result.category}</small></div><p class="subtitle">Variety match confidence, not health score: <span class="pill ${confidenceClass(data)}">${confidenceLabel(data)}</span></p></div><div class="health-score-card ${healthClass(result.category)}"><span>Plant health score</span><strong>${healthScoreLabel(result.score)}</strong><small>${result.category}</small></div></div>${possibleMatchesMarkup(data)}<div class="btn-row" style="justify-content:flex-start;margin:10px 0"><button class="mini-btn" type="button" data-action="toggle-diagnosis-lang" data-lang="en">English</button><button class="mini-btn" type="button" data-action="toggle-diagnosis-lang" data-lang="hi">Hindi</button><button class="mini-btn" type="button" data-action="speak-diagnosis" data-speak-en="${escapeHtml(enText)}" data-speak-hi="${escapeHtml(hiText || enText)}">Recite result</button></div><div data-lang-section="en"><div class="diagnosis-grid"><div><span class="small muted">Main issue</span><p><strong>${escapeHtml(data.issue_detected || "Observation captured")}</strong></p></div><div><span class="small muted">Likely root cause</span><p>${escapeHtml(data.root_cause || "Not specified")}</p></div></div><div><span class="small muted">Next steps</span><ol class="instruction-list">${(data.treatment_plan || []).map(x => `<li>${escapeHtml(x)}</li>`).join("") || `<li>${escapeHtml(data.immediate_action || "Follow maintenance SOP")}</li>`}</ol></div></div><div data-lang-section="hi" style="display:none"><div class="diagnosis-grid"><div><span class="small muted">मुख्य समस्या</span><p><strong>${escapeHtml(data.issue_detected_hi || data.issue_detected || "Observation captured")}</strong></p></div><div><span class="small muted">मुख्य कारण</span><p>${escapeHtml(data.root_cause_hi || data.root_cause || "Not specified")}</p></div></div><div><span class="small muted">अगले कदम</span><ol class="instruction-list">${(data.treatment_plan_hi || data.treatment_plan || []).map(x => `<li>${escapeHtml(x)}</li>`).join("") || `<li>${escapeHtml(data.immediate_action_hi || data.immediate_action || "Follow maintenance SOP")}</li>`}</ol></div></div>${data.photo_quality ? `<p class="small muted">Photo quality: ${escapeHtml(data.photo_quality)}</p>` : ""}${result.ticketCreated ? `<p class="danger-text">SLA ticket auto-created from AI scan. Field notes are optional supporting evidence; ticket ownership does not depend on labour submitting a service log.</p>` : ""}${fallbackNote}</div>`;
  toast(result.ticketCreated ? "Diagnosis complete. SLA ticket auto-created." : "Diagnosis complete.");
}

async function diagnoseImage({ image, draft, batchId = "" }) {
  const { db } = dbx();
  const siteId = draft.siteId || allowedSites(db)[0]?.id || "";
  const site = db.sites.find(s => s.id === siteId);
  const location = draft.placementBucket || draft.zone || draft.floor;
  const expectedPlantType = draft.plantType || db.boqLines?.find(line => line.id === draft.boqLineId)?.plantSpecies || "";
  if (!siteId) throw new Error("No assigned site available.");
  if (!allowedSiteIds(db).includes(siteId)) throw new Error("This site is not assigned to your account.");
  if (!String(location || "").trim()) throw new Error("Select a floor or placement bucket before diagnosis.");
  const imageStats = await estimateImageHealthStats(image).catch(() => null);
  const payload = { imageBase64: image, note: draft.note, site: site?.name, location, plantType: expectedPlantType, expectedPlantType, imageStats };
  const res = await fetch(APP.diagnosisEndpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await safeJson(res);
  if (!res.ok) throw new Error(data.error || "Diagnosis failed");
  if (data.is_plant_image === false) throw new Error(data.reject_reason || "AI rejected this proof because it does not appear to contain a maintained plant.");
  const score = normalizeHealthScore(data.condition_score ?? data.score ?? 5);
  data.condition_score = score;
  const category = score >= 7 ? "Healthy" : score > 6 ? "Monitor" : "Critical";
  const ticketCreated = score <= 6;
  return { data, score, category, ticketCreated, label: data.plant_identified || data.issue_detected || "Diagnosis complete" };
}

async function runBatchDiagnosis() {
  syncScanDraftFromDom();
  const draft = { ...state.scanDraft };
  if (!state.batchImages.length) throw new Error("Add batch photos first.");
  if (!(draft.placementBucket || draft.zone || draft.floor)?.trim()) throw new Error("Select the floor or placement bucket before batch scan.");
  state.batchRunning = true;
  state.batchResults = [];
  const out = document.querySelector("#batchOutput");
  if (out) out.innerHTML = `<div class="card soft"><strong>Checking batch health...</strong><p class="subtitle">0 of ${state.batchImages.length} photos completed.</p></div>`;
  const batchId = `batch-${Date.now().toString(36)}`;
  const results = [];
  for (let i = 0; i < state.batchImages.length; i++) {
    try {
      if (out) out.innerHTML = `<div class="card soft"><strong>Checking batch health...</strong><p class="subtitle">${i + 1} of ${state.batchImages.length} photos in progress.</p></div>`;
      const result = await diagnoseImage({ image: state.batchImages[i], draft, batchId });
      if (result.ticketCreated) autoCreateSlaTicketFromDiagnosis({ image: state.batchImages[i], draft, data: result.data, result, batchId });
      results.push(result);
    } catch (err) {
      results.push({ category: "Failed", label: err.message || "Scan failed" });
    }
    state.batchResults = results;
  }
  state.batchRunning = false;
  const slaTickets = results.filter(r => r.ticketCreated).length;
  if (out) out.innerHTML = `<div class="card scan-result"><div class="card-title"><h3>Batch complete</h3><span class="pill ${slaTickets ? "critical" : "good"}">${slaTickets} SLA tickets</span></div><p>${results.length} photos processed. Scans with score 6/10 or below have been logged as SLA-bound tickets.</p></div>`;
  toast("Batch diagnosis completed.");
}

async function verifyClosureEvidence(id, img) {
  toast("Checking closure photo...", 5000);
  const res = await fetch(APP.verifyEvidenceEndpoint || APP.diagnosisEndpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imageBase64: dataUrlToBase64(img) }) });
  const data = await safeJson(res);
  if (!res.ok) throw new Error(data.error || "Closure photo check failed");
  if (!data.accepted) throw new Error(data.reason || "Closure photo not accepted. Upload a clear photo of a healthy/replaced plant.");
  attachEvidence(id, img, data);
  toast("Closure photo accepted. You can close the ticket.");
  render();
}

function draftNumber(key, fallback = 0) {
  const value = Number(state.scanDraft[key]);
  return Number.isFinite(value) ? value : fallback;
}
function draftBool(key) {
  return state.scanDraft[key] === true || String(state.scanDraft[key]) === "true";
}
function selectedBoqLineForDraft(db = getDb()) {
  const draft = state.scanDraft;
  return (db.boqLines || []).find(line => line.id === draft.boqLineId) ||
    baselineForSite(db, draft.siteId).find(line => line.floor === draft.floor && line.placementBucket === draft.placementBucket);
}
async function captureGpsForDraft() {
  const gps = await getCurrentGps();
  if (!gps) {
    state.scanDraft.gpsLat = "";
    state.scanDraft.gpsLng = "";
    state.scanDraft.gpsAccuracy = "";
    state.scanDraft.gpsCapturedAt = "";
    toast("GPS unavailable or permission denied.");
    render();
    return null;
  }
  Object.assign(state.scanDraft, gps);
  toast("GPS captured.");
  render();
  return gps;
}
function serviceLogPayload({ aiData = null, aiValidationPending = false, syncStatus = "synced" } = {}) {
  const db = getDb();
  const siteId = state.scanDraft.siteId || allowedSites(db)[0]?.id || "";
  const site = db.sites.find(s => s.id === siteId);
  const line = selectedBoqLineForDraft(db);
  const tempId = uid("svc-tmp");
  const createdAt = nowIso();
  return {
    id: uid("svc"),
    tempId,
    clientId: site?.clientId || "",
    siteId,
    floor: state.scanDraft.floor || line?.floor || "",
    placementBucket: state.scanDraft.placementBucket || line?.placementBucket || "",
    boqLineId: line?.id || state.scanDraft.boqLineId || "",
    plantCategory: state.scanDraft.plantCategory || line?.plantCategory || "",
    actionType: state.scanDraft.replacementsCount > 0 ? "replacement" : draftBool("issueFound") ? "issue" : "routine_service",
    plantsServicedCount: draftNumber("plantsServicedCount", 0),
    wateringDone: draftBool("wateringDone"),
    wateredPlantCount: draftNumber("wateredPlantCount", 0),
    replacementsCount: draftNumber("replacementsCount", 0),
    deadPlantCount: draftNumber("deadPlantCount", 0),
    materialUsed: state.scanDraft.materialUsed || "none",
    materialName: state.scanDraft.materialName || "",
    issueFound: draftBool("issueFound"),
    issueCategory: state.scanDraft.issueCategory || "other",
    disposalRoute: state.scanDraft.disposalRoute || "not_applicable",
    notes: state.scanDraft.note || "",
    voiceNoteText: state.scanDraft.voiceNoteText || "",
    photoDataUrl: state.scanImage,
    aiPlantDetected: aiData ? aiData.is_plant_image !== false : null,
    aiHealthScore: aiData ? normalizeHealthScore(aiData.condition_score ?? aiData.score ?? 0, 0) : null,
    aiIssueFlags: aiData ? [aiData.auto_ticket_category, aiData.work_action_required].filter(Boolean) : (aiValidationPending ? ["ai_validation_pending"] : []),
    gpsLat: state.scanDraft.gpsLat || "",
    gpsLng: state.scanDraft.gpsLng || "",
    gpsAccuracy: state.scanDraft.gpsAccuracy || "",
    gpsCapturedAt: state.scanDraft.gpsCapturedAt || "",
    captureSource: state.scanCaptureSource || "phone_camera",
    offlineCreated: syncStatus !== "synced",
    localCreatedAt: createdAt,
    serverCreatedAt: syncStatus === "synced" ? createdAt : "",
    syncStatus,
    syncAttempts: syncStatus === "synced" ? 1 : 0,
    createdBy: currentUser()?.id || "field-user"
  };
}
async function submitServiceLog() {
  syncScanDraftFromDom();
  const db = getDb();
  const siteId = state.scanDraft.siteId || allowedSites(db)[0]?.id || "";
  if (!siteId) throw new Error("Select an assigned site.");
  if (!allowedSiteIds(db).includes(siteId)) throw new Error("This site is not assigned to your account.");
  if (!state.scanDraft.placementBucket) throw new Error("Select a placement bucket.");
  if (!state.scanImage) throw new Error("Camera proof is required before submitting a service log.");
  if (!state.scanDraft.gpsLat && navigator.onLine !== false) await captureGpsForDraft();

  let aiData = state.lastDiagnosis?.image === state.scanImage ? state.lastDiagnosis.data : null;
  let aiValidationPending = false;
  if (!aiData && navigator.onLine !== false) {
    try {
      const result = await diagnoseImage({ image: state.scanImage, draft: { ...state.scanDraft } });
      aiData = result.data;
      state.lastDiagnosis = { image: state.scanImage, data: aiData, result, diagnosisKey: diagnosisKeyForImage(state.scanImage, state.scanDraft) };
    } catch (error) {
      if (String(error?.message || "").includes("AI rejected")) throw error;
      aiValidationPending = true;
    }
  } else if (navigator.onLine === false) {
    aiValidationPending = true;
  }
  if (aiData?.is_plant_image === false) throw new Error(aiData.reject_reason || "AI rejected this proof because it does not appear to contain a plant.");

  const syncStatus = navigator.onLine === false || aiValidationPending ? "pending" : "synced";
  const log = serviceLogPayload({ aiData, aiValidationPending, syncStatus });
  tx(d => {
    d.serviceLogs ||= [];
    d.serviceLogs.push(log);
    return d;
  });
  if (aiData && aiData.is_plant_image !== false && syncStatus === "synced") {
    createScanRecord({
      siteId,
      zone: state.scanDraft.placementBucket || state.scanDraft.floor || "Field service",
      plantType: state.scanDraft.plantType || selectedBoqLineForDraft(db)?.plantSpecies || "",
      note: state.scanDraft.note,
      createdBy: currentUser()?.id || "field-user",
      diagnosisKey: state.lastDiagnosis?.diagnosisKey || diagnosisKeyForImage(state.scanImage, state.scanDraft)
    }, aiData, state.scanImage);
  }
  if (syncStatus !== "synced") queueOfflineRecord("serviceLog", log);
  const retainedSite = log.siteId;
  state.scanDraft = { ...defaultScanDraft(), siteId: retainedSite };
  state.scanImage = "";
  state.scanCaptureSource = "";
  state.lastDiagnosis = null;
  toast(syncStatus === "synced" ? "Service log synced." : "Service log saved offline and queued for sync.");
  render();
}

function startVoiceNote() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) throw new Error("Voice note is not supported in this browser. Use Chrome on Android/Desktop.");
  syncScanDraftFromDom();
  const rec = new SpeechRecognition();
  rec.lang = "hi-IN";
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  toast("Listening... speak in Hindi or English.", 6000);
  rec.onresult = event => {
    const transcript = event.results?.[0]?.[0]?.transcript || "";
    state.scanDraft.note = [state.scanDraft.note, transcript].filter(Boolean).join(" ").trim();
    state.scanDraft.voiceNoteText = [state.scanDraft.voiceNoteText, transcript].filter(Boolean).join(" ").trim();
    const note = document.querySelector('[data-scan-field="note"]');
    if (note) note.value = state.scanDraft.note;
    toast("Voice note captured.");
  };
  rec.onerror = () => toast("Voice note failed. Please type or try again.");
  rec.start();
}

async function decodeQrImage(file) {
  if (!file) return;
  if (!("BarcodeDetector" in window)) throw new Error("QR camera decoding is not supported here. Paste QR code instead.");
  const detector = new BarcodeDetector({ formats: ["qr_code"] });
  const bitmap = await createImageBitmap(file);
  const codes = await detector.detect(bitmap);
  if (!codes.length) throw new Error("No QR code found in this image.");
  applyQr(codes[0].rawValue);
}

function bindEvents() {
  document.addEventListener("click", async e => {
    const loginRole = e.target.closest("[data-login-role]")?.dataset.loginRole; if (loginRole) { state.loginRole = loginRole; render(); return; }
    const ownerView = e.target.closest("[data-owner-view]")?.dataset.ownerView; if (ownerView && isOwner()) { state.ownerViewRole = ownerView; sessionStorage.setItem("greenops_owner_view", ownerView); state.tab = firstTabFor(ownerView === ROLES.MAINTENANCE ? ROLES.MAINTENANCE : ownerView === ROLES.CLIENT ? ROLES.CLIENT : ROLES.OWNER); render(); return; }
    const tab = e.target.closest("[data-tab]")?.dataset.tab; if (tab) { state.tab = tab; sessionStorage.setItem(APP.sessionTabKey, tab); render(); return; }
    const filterSite = e.target.closest("[data-filter-site]")?.dataset.filterSite; if (filterSite) { state.filters.siteId = filterSite; render(); return; }
    const efficiencyFilter = e.target.closest("[data-efficiency-filter]")?.dataset.efficiencyFilter; if (efficiencyFilter) { state.efficiencyFilter = efficiencyFilter; sessionStorage.setItem("greenops_efficiency_filter", efficiencyFilter); render(); return; }
    const clientAssuranceFilter = e.target.closest("[data-client-assurance-filter]")?.dataset.clientAssuranceFilter; if (clientAssuranceFilter) { state.clientAssuranceFilter = state.clientAssuranceFilter === clientAssuranceFilter ? "" : clientAssuranceFilter; sessionStorage.setItem("greenops_client_assurance_filter", state.clientAssuranceFilter); render(); return; }
    const framework = e.target.closest("[data-framework]")?.dataset.framework; if (framework) { state.sustainabilityFramework = framework; sessionStorage.setItem("greenops_sustainability_framework", framework); render(); return; }
    const frameworkMetric = e.target.closest("[data-framework-metric]")?.dataset.frameworkMetric; if (frameworkMetric) { state.frameworkModalMetricId = frameworkMetric; render(); return; }
    if (e.target.closest("[data-framework-close]") || e.target.matches("[data-framework-backdrop]")) { state.frameworkModalMetricId = ""; render(); return; }
    const assistantPrompt = e.target.closest("[data-assistant-prompt]")?.dataset.assistantPrompt; if (assistantPrompt) { await askClientAssistant(assistantPrompt); return; }
    const action = e.target.closest("[data-action]")?.dataset.action; const id = e.target.closest("[data-id]")?.dataset.id;
    try {
      if (action === "logout") { stopCameraCapture(); logout(); render(); return; }
      if (!state.user) return;
      if (action === "seed" && isOwner()) { seedDemoData(); toast("Demo data seeded."); render(); }
      if (action === "reset" && isOwner() && confirm("Reset all local app data?")) { resetDb(); state.filters = { clientId:"all",siteId:"all",city:"all",from:"",to:"" }; state.scanDraft = defaultScanDraft(); state.scanImage = ""; state.scanCaptureSource = ""; state.lastDiagnosis = null; state.clientTicketImage = ""; state.batchImages = []; state.batchResults = []; toast("Local data reset."); render(); }
      if (action === "assistant-open") { state.assistantOpen = true; render(); return; }
      if (action === "assistant-close") { state.assistantOpen = false; render(); return; }
      if (action === "download-report") exportCsvReport(getDb(), roleFilter(getDb()));
      if (action === "download-invoice") downloadInvoiceHtml(currentInvoice());
      if (action === "download-sustainability") downloadSustainabilityCsv();
      if (action === "print-report") { preparePrintReport(); setTimeout(() => window.print(), 30); }
      if (action === "insert-boq-template") { const site = getDb().sites.find(s => s.id === selectedBoqSite()); state.boqDraft.csv = boqTemplateCsv(site); previewBoqDraft(); render(); }
      if (action === "preview-boq") { previewBoqDraft(); toast("BOQ rows parsed."); render(); }
      if (action === "save-boq-draft") { const result = saveBoqDraft(); toast(`BOQ draft saved with ${result.upload.acceptedRows} accepted row(s).`); render(); }
      if (action === "save-activate-boq") { const result = saveBoqDraft({ activate: true }); toast(`BOQ baseline v${result.upload.version} activated.`); render(); }
      if (action === "activate-boq") { activateBoqUpload(id); toast("BOQ baseline activated."); render(); }
      if (action === "archive-boq") { archiveBoqUpload(id); toast("BOQ version archived."); render(); }
      if (action === "sync-now") { const result = await syncPendingRecords(); toast(result.offline ? "Still offline. Pending records remain local." : `${result.synced} record(s) synced.`); render(); }
      if (action === "enable-trial-30") { applySustainabilityPreset("trial30"); toast("30-day trial enabled."); render(); }
      if (action === "enable-trial-60") { applySustainabilityPreset("trial60"); toast("60-day trial enabled."); render(); }
      if (action === "activate-paid-access") { applySustainabilityPreset("active"); toast("Paid sustainability access activated."); render(); }
      if (action === "expire-sustainability-access") { applySustainabilityPreset("expired"); toast("Sustainability access expired."); render(); }
      if (action === "reset-sustainability-core") { applySustainabilityPreset("core"); toast("Sustainability access reset to Core."); render(); }
      if (action === "seed-sustainability-demo") { seedDemoSustainabilityData(); toast("Demo sustainability data seeded."); render(); }
      if (action === "open-client-demo-view") { const { site, clientId } = entitlementContext(); if (!site) throw new Error("Select a site first."); state.ownerViewRole = ROLES.CLIENT; sessionStorage.setItem("greenops_owner_view", ROLES.CLIENT); state.filters = { ...state.filters, clientId, siteId: site.id, city: site.city || "all" }; state.tab = "sustainability"; sessionStorage.setItem(APP.sessionTabKey, state.tab); render(); }
      if (action === "toggle-diagnosis-lang") { const lang = e.target.closest("[data-lang]")?.dataset.lang || "en"; document.querySelectorAll("[data-lang-section]").forEach(el => { el.style.display = el.dataset.langSection === lang ? "" : "none"; }); state.diagnosisLang = lang; }
      if (action === "speak-diagnosis") { const btn = e.target.closest("[data-speak-en]"); const text = state.diagnosisLang === "hi" ? (btn?.dataset.speakHi || btn?.dataset.speakEn || "") : (btn?.dataset.speakEn || ""); if (!window.speechSynthesis) throw new Error("Read-aloud is not supported in this browser."); window.speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(text); utterance.lang = state.diagnosisLang === "hi" ? "hi-IN" : "en-IN"; window.speechSynthesis.speak(utterance); }
      if (action === "clear-scan-image") { syncScanDraftFromDom(); state.scanImage = ""; state.scanCaptureSource = ""; state.lastDiagnosis = null; document.querySelectorAll("[data-scan-camera]").forEach(input => { input.value = ""; }); updateScanImageUi(); toast("Plant image removed."); }
      if (action === "clear-client-ticket-image") { state.clientTicketImage = ""; const input = document.querySelector("[data-client-evidence]"); if (input) input.value = ""; updateClientTicketImageUi(); toast("Issue photo removed."); }
      if (action === "apply-qr") { const input = document.querySelector("[data-qr-text]"); applyQr(input?.value || state.qrText); }
      if (action === "demo-qr") { applyQr(e.target.closest("[data-qr]")?.dataset.qr || ""); }
      if (action === "voice-note") { startVoiceNote(); }
      if (action === "capture-gps") { await captureGpsForDraft(); }
      if (action === "open-camera") { await openCameraCapture(); }
      if (action === "run-diagnosis") { await diagnoseFromState(); }
      if (action === "submit-service-log") { await submitServiceLog(); }
      if (action === "clear-batch") { state.batchImages = []; state.batchResults = []; render(); toast("Batch cleared."); }
      if (action === "remove-batch-image") { syncScanDraftFromDom(); const index = Number(e.target.closest("[data-index]")?.dataset.index); state.batchImages.splice(index, 1); render(); }
      if (action === "run-batch") { await runBatchDiagnosis(); }
      if (action === "progress") { markInProgress(id); toast("Ticket moved to In Progress."); render(); dispatchWhatsAppNotifications(id); }
      if (action === "close") { const ticket = getDb().tickets.find(t => t.id === id); if (!ticket) throw new Error("Ticket not found."); if (!ticket.closureEvidence) throw new Error("Upload closure photo before closing this ticket."); if (!ticket.closureEvidenceVerified) throw new Error("Closure photo must be accepted before closing this ticket."); closeTicket(id, "Issue resolved and verified with closure photo."); toast("Ticket closed with verified evidence."); render(); dispatchWhatsAppNotifications(id); }
    } catch (err) { toast(err.message || "Action failed"); }
  });
  document.addEventListener("change", async e => {
    if (e.target.matches("[data-filter]")) { state.filters[e.target.dataset.filter] = e.target.value; if (["clientId","city"].includes(e.target.dataset.filter)) state.filters.siteId = "all"; render(); }
    if (e.target.matches("[data-boq-site]")) { state.boqDraft.siteId = e.target.value; state.boqDraft.rows = []; state.boqDraft.acceptedRows = []; state.boqDraft.rejectedRows = []; render(); }
    if (e.target.matches("[data-boq-file]")) { const file = e.target.files?.[0]; if (!file) return; state.boqDraft.fileName = file.name; state.boqDraft.csv = await file.text(); previewBoqDraft(); toast("BOQ CSV loaded."); render(); }
    if (e.target.matches("[data-entitlement-client]")) { state.entitlementClientId = e.target.value; state.entitlementSiteId = allowedSites().find(site => site.clientId === state.entitlementClientId)?.id || ""; render(); }
    if (e.target.matches("[data-entitlement-site]")) { state.entitlementSiteId = e.target.value; render(); }
    if (e.target.closest("#scanPanel") && e.target.dataset.scanField) {
      state.scanDraft[e.target.dataset.scanField] = e.target.value;
      if (e.target.dataset.scanField === "boqLineId") {
        const line = selectedBoqLineForDraft();
        if (line) Object.assign(state.scanDraft, { floor: line.floor, placementBucket: line.placementBucket, plantCategory: line.plantCategory, plantType: state.scanDraft.plantType || line.plantSpecies || "" });
      }
      if (["siteId", "floor", "boqLineId"].includes(e.target.dataset.scanField)) render();
    }
    if (e.target.matches("[data-scan-camera]")) { syncScanDraftFromDom(); const file = e.target.files?.[0]; if (!file) return; state.scanImage = await imageToDataUrl(file, 1600, .82); state.scanCaptureSource = "phone_camera"; state.lastDiagnosis = null; updateScanImageUi(); toast("Plant image ready for diagnosis."); }
    if (e.target.matches("[data-client-evidence]")) { const file = e.target.files?.[0]; if (!file) return; state.clientTicketImage = await imageToDataUrl(file, 900, .7); updateClientTicketImageUi(); toast("Issue photo attached."); }
    if (e.target.matches("[data-batch-images]")) { syncScanDraftFromDom(); const files = [...(e.target.files || [])].slice(0, Math.max(0, 20 - state.batchImages.length)); for (const file of files) state.batchImages.push(await imageToDataUrl(file, 1200, .75)); render(); toast(`${files.length} batch photo(s) added.`); }
    if (e.target.matches("[data-qr-image]")) { const file = e.target.files?.[0]; if (file) await decodeQrImage(file); }
    if (e.target.matches("[data-evidence]")) { const id = e.target.dataset.evidence; const file = e.target.files?.[0]; if (!file) return; const img = await imageToDataUrl(file, 900, .7); await verifyClosureEvidence(id, img); }
  });
  document.addEventListener("input", e => { if (e.target.closest("#scanPanel") && e.target.dataset.scanField) state.scanDraft[e.target.dataset.scanField] = e.target.value; if (e.target.matches("[data-boq-csv]")) state.boqDraft.csv = e.target.value; if (e.target.matches("[data-qr-text]")) state.qrText = e.target.value; if (e.target.closest("#floatingAssistantForm") && e.target.name === "question") state.assistantInput = e.target.value; });
  document.addEventListener("submit", async e => {
    e.preventDefault();
    try {
      if (e.target.id === "loginForm") { const fd = new FormData(e.target); const user = authenticate(fd.get("role"), fd.get("identifier"), fd.get("secret")); if (!user) throw new Error("Login failed. Check registered credentials."); setLoggedIn(user); toast(`Welcome, ${user.name}.`); render(); return; }
      if (e.target.id === "floatingAssistantForm") { const fd = new FormData(e.target); await askClientAssistant(fd.get("question")); return; }
      if (e.target.id === "sustainabilityAccessForm") { saveSustainabilityAccess(e.target); toast("Sustainability access updated."); render(); return; }
      if (e.target.id === "clientTicketForm") { const fd = new FormData(e.target); const siteId = fd.get("siteId"); if (!allowedSiteIds().includes(siteId)) throw new Error("This site is not assigned to your account."); const beforeIds = new Set(getDb().tickets.map(t => t.id)); createClientTicket({ siteId, issue: fd.get("issue"), description: fd.get("description"), clientEvidence: state.clientTicketImage }); const created = getDb().tickets.find(t => !beforeIds.has(t.id)); state.clientTicketImage = ""; toast("Priority 1 ticket created. Supervisor WhatsApp notification triggered."); render(); if (created?.id) dispatchWhatsAppNotifications(created.id); }
    } catch (err) { toast(err.message || "Submit failed"); }
  });
}

window.addEventListener("beforeunload", stopCameraCapture);
window.addEventListener("resize", () => drawCharts());
window.addEventListener("db:changed", () => drawCharts());
window.addEventListener("online", async () => { await syncPendingRecords(); render(); });
bindEvents();
render();
