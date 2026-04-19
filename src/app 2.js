import { APP, ROLES, STATUS } from "./config.js";
import { getDb, resetDb, seedDemoData } from "./store.js";
import { createScanRecord, createClientTicket, updateTicket, markInProgress, attachEvidence, closeTicket } from "./tickets.js";
import { healthClass, healthSummary, scorePct, trendByDay } from "./health.js";
import { exportCsvReport, joinRecords } from "./reports.js";
import { slaState, resolutionTime } from "./sla.js";
import { $, $$, dataUrlToBase64, escapeHtml, fmtDate, imageToDataUrl, option, toast } from "./utils.js";

const state = {
  role: sessionStorage.getItem(APP.sessionRoleKey) || ROLES.MAINTENANCE,
  tab: sessionStorage.getItem(APP.sessionTabKey) || "dashboard",
  scanImage: "",
  scanDraft: { siteId: "", zone: "", plantType: "", note: "" },
  evidenceImage: {},
  filters: { clientId: "all", siteId: "all", city: "all", from: "", to: "" }
};

const roleTabs = {
  [ROLES.MAINTENANCE]: ["dashboard", "scan", "my tickets", "history"],
  [ROLES.SUPERVISOR]: ["dashboard", "tickets", "sla breaches", "reports"],
  [ROLES.CLIENT]: ["overview", "raise ticket", "reports", "evidence"]
};

function dbx() {
  const db = getDb();
  const siteMap = Object.fromEntries(db.sites.map(s => [s.id, s]));
  const clientMap = Object.fromEntries(db.clients.map(c => [c.id, c]));
  const plantMap = Object.fromEntries(db.plants.map(p => [p.id, p]));
  return { db, siteMap, clientMap, plantMap };
}

function visibleRecords() {
  const { db } = dbx();
  const filters = roleFilter(db);
  return joinRecords(db, filters);
}

function roleFilter(db) {
  const f = { ...state.filters };
  if (state.role === ROLES.CLIENT && f.clientId === "all") f.clientId = db.clients[0]?.id || "all";
  return f;
}

function layout(content) {
  const tabList = roleTabs[state.role];
  if (!tabList.includes(state.tab)) state.tab = tabList[0];
  return `
    <div class="app-shell">
      <header class="topbar">
        <div class="top-inner">
          <div class="brand">
            <div class="logo">G</div>
            <div><h1>${APP.name}</h1><p>Plant Health Service Management</p></div>
          </div>
          <nav class="role-switch" aria-label="Role selector">
            ${roleButton(ROLES.MAINTENANCE, "Maintenance")}
            ${roleButton(ROLES.SUPERVISOR, "Supervisor")}
            ${roleButton(ROLES.CLIENT, "Client")}
          </nav>
        </div>
      </header>
      <main class="main">
        <section class="hero">
          <div>
            <div class="eyebrow">${escapeHtml(roleLabel())}</div>
            <h2>${heroTitle()}</h2>
            <p>${heroSubtitle()}</p>
          </div>
          <div class="hero-actions">
            <button class="btn secondary" data-action="seed">Seed demo data</button>
            <button class="btn ghost" data-action="reset">Reset local data</button>
          </div>
        </section>
        <nav class="tabs" aria-label="Section tabs">${tabList.map(t => `<button class="${state.tab === t ? "active" : ""}" data-tab="${t}">${title(t)}</button>`).join("")}</nav>
        <div style="height:16px"></div>
        ${content}
      </main>
    </div>`;
}

function roleButton(role, label) { return `<button class="${state.role === role ? "active" : ""}" data-role="${role}">${label}</button>`; }
function title(s) { return s.split(" ").map(w => w[0].toUpperCase() + w.slice(1)).join(" "); }
function roleLabel() { return state.role === ROLES.MAINTENANCE ? "Field execution" : state.role === ROLES.SUPERVISOR ? "Operations command center" : "Client visibility"; }
function heroTitle() {
  if (state.role === ROLES.MAINTENANCE) return "Scan, act, close with proof.";
  if (state.role === ROLES.SUPERVISOR) return "Control every site like an ITSM desk.";
  return "Live health, tickets, reports, proof.";
}
function heroSubtitle() {
  if (state.role === ROLES.MAINTENANCE) return "One workflow for staff: scan the plant, get instructions, handle assigned tickets, upload picture evidence before closure.";
  if (state.role === ROLES.SUPERVISOR) return "City-wise plant health, automatic critical tickets, SLA ageing, evidence-controlled closure, and downloadable reports.";
  return "Clean client view across locations with health trends, service reports, raised tickets, and closure evidence.";
}

function render() {
  const body = state.role === ROLES.MAINTENANCE ? maintenanceView() : state.role === ROLES.SUPERVISOR ? supervisorView() : clientView();
  $("#app").innerHTML = layout(body);
  drawCharts();
}

function filterPanel({ client = true } = {}) {
  const { db } = dbx();
  const cities = [...new Set(db.sites.map(s => s.city))].sort();
  const sites = db.sites.filter(s => (state.filters.city === "all" || s.city === state.filters.city) && (state.filters.clientId === "all" || s.clientId === state.filters.clientId));
  return `<div class="filters">
    ${client ? `<select class="select" data-filter="clientId">${option("all", "All clients", state.filters.clientId === "all")}${db.clients.map(c => option(c.id, c.name, state.filters.clientId === c.id)).join("")}</select>` : ""}
    <select class="select" data-filter="city">${option("all", "All cities", state.filters.city === "all")}${cities.map(c => option(c, c, state.filters.city === c)).join("")}</select>
    <select class="select" data-filter="siteId">${option("all", "All sites", state.filters.siteId === "all")}${sites.map(s => option(s.id, s.name, state.filters.siteId === s.id)).join("")}</select>
    <input class="input" type="date" data-filter="from" value="${state.filters.from}" />
    <input class="input" type="date" data-filter="to" value="${state.filters.to}" />
  </div>`;
}

function metrics(scans, tickets) {
  const hs = healthSummary(scans);
  const open = tickets.filter(t => t.status !== STATUS.CLOSED);
  const breached = open.filter(t => slaState(t).breached);
  return `<div class="kpi-strip">
    <div class="metric"><span>Avg Health</span><strong>${hs.avg || "—"}</strong></div>
    <div class="metric good"><span>Healthy</span><strong>${hs.healthy}</strong></div>
    <div class="metric monitor"><span>Monitor</span><strong>${hs.monitor}</strong></div>
    <div class="metric critical"><span>Critical / SLA</span><strong>${hs.critical}/${breached.length}</strong></div>
  </div>`;
}

function maintenanceView() {
  const { scans, tickets } = visibleRecords();
  if (state.tab === "scan") return scanView();
  if (state.tab === "my tickets") return ticketBoard(tickets.filter(t => t.status !== STATUS.CLOSED), { scope: "maintenance" });
  if (state.tab === "history") return historyView(scans, tickets);
  return `<div class="grid grid-2">
    <section class="card">${metrics(scans, tickets)}<div class="grid grid-2">
      <button class="btn" data-tab="scan">Scan Plant</button><button class="btn secondary" data-tab="my tickets">My Open Tasks</button>
    </div><p class="footer-note">Staff view is intentionally limited: no client clutter, no analytics maze.</p></section>
    <section class="card"><div class="card-title"><h3>Critical assigned queue</h3><span class="pill critical">Auto-ticketed</span></div>${ticketCards(tickets.filter(t => t.status !== STATUS.CLOSED).slice(0, 5))}</section>
  </div>`;
}

function scanView() {
  const { db } = dbx();
  const draft = state.scanDraft;
  const selectedSite = draft.siteId || db.sites[0]?.id || "";
  return `<div class="split">
    <section class="card">
      <div class="card-title"><h3>Scan Plant</h3><span class="pill good">LLM call only here</span></div>
      <form class="form" id="scanForm">
        <div class="grid grid-2">
          <div class="field"><label>Site</label><select class="select" name="siteId" required>${db.sites.map(s => option(s.id, `${s.city} · ${s.name}`, selectedSite === s.id)).join("")}</select></div>
          <div class="field"><label>Zone / Location</label><input class="input" name="zone" value="${escapeHtml(draft.zone)}" placeholder="Reception / Boardroom / Lobby" required /></div>
        </div>
        <div class="field"><label>Plant type, if known</label><input class="input" name="plantType" value="${escapeHtml(draft.plantType)}" placeholder="Areca Palm / ZZ / Peace Lily" /></div>
        <div class="field"><label>Technician note</label><textarea class="textarea" name="note" placeholder="Leaves yellowing near AC vent, soil wet, etc.">${escapeHtml(draft.note)}</textarea></div>
        <div class="filebox">
          <strong>Upload plant image</strong><br><span class="small muted">Compressed locally before diagnosis/storage</span>
          <input type="file" accept="image/*" data-scan-image />
          ${state.scanImage ? `<div class="image-ready"><span class="pill good">Plant image ready</span><button class="mini-btn" type="button" data-action="clear-scan-image">Remove image</button></div><img src="${state.scanImage}" class="preview" alt="Plant preview" />` : `<div class="small muted">No image selected yet.</div>`}
        </div>
        <button class="btn" type="submit" ${state.scanImage ? "" : "disabled"}>Run AI Diagnosis</button>
      </form>
      <div id="scanOutput"></div>
    </section>
    <section class="card soft"><h3>Auto ITSM rules</h3><p class="subtitle">After scan, score is cached. Dashboards never call AI again.</p><ul class="instruction-list">
      <li><strong>Healthy:</strong> score 7+</li><li><strong>Monitor:</strong> score 6–6.9</li><li><strong>Critical:</strong> score below 6 creates automatic ticket</li><li><strong>Close ticket:</strong> blocked unless picture evidence exists</li></ul></section>
  </div>`;
}
function supervisorView() {
  const { scans, tickets } = visibleRecords();
  if (state.tab === "tickets") return `<section class="card">${filterPanel()}${ticketBoard(tickets, { scope: "supervisor" })}</section>`;
  if (state.tab === "sla breaches") return `<section class="card">${filterPanel()}${ticketBoard(tickets.filter(t => t.status !== STATUS.CLOSED && slaState(t).breached), { scope: "supervisor" })}</section>`;
  if (state.tab === "reports") return reportsView(true);
  return `<section class="card">${filterPanel()}${metrics(scans, tickets)}<div class="grid grid-2"><div>${healthBuckets(scans)}</div><div><h3>Health trend</h3><canvas class="chart" data-chart='${JSON.stringify(trendByDay(scans)).replaceAll("'", "&#39;")}'></canvas></div></div></section><div style="height:16px"></div><section class="card"><div class="card-title"><h3>Live ticket queue</h3><button class="btn secondary" data-tab="tickets">Open full board</button></div>${ticketBoard(tickets.slice(0, 8), { scope: "supervisor", compact: true })}</section>`;
}

function clientView() {
  const { db } = dbx();
  if (state.filters.clientId === "all") state.filters.clientId = db.clients[0]?.id || "all";
  const { scans, tickets } = visibleRecords();
  if (state.tab === "raise ticket") return raiseTicketView();
  if (state.tab === "reports") return reportsView(false);
  if (state.tab === "evidence") return evidenceView(tickets);
  return `<section class="card">${filterPanel({ client: true })}${metrics(scans, tickets)}<div class="grid grid-2"><div><h3>Location health graph</h3><canvas class="chart" data-chart='${JSON.stringify(trendByDay(scans)).replaceAll("'", "&#39;")}'></canvas></div><div>${healthBuckets(scans)}</div></div></section><div style="height:16px"></div><section class="card"><div class="card-title"><h3>Your open tickets</h3><button class="btn" data-tab="raise ticket">Raise Priority 1 Ticket</button></div>${ticketBoard(tickets, { scope: "client", compact: true })}</section>`;
}

function raiseTicketView() {
  const { db } = dbx();
  const clientId = state.filters.clientId === "all" ? db.clients[0]?.id : state.filters.clientId;
  const sites = db.sites.filter(s => s.clientId === clientId);
  return `<section class="card"><div class="card-title"><div><h3>Raise Client Ticket</h3><p class="subtitle">Every client-created ticket is automatically Priority 1.</p></div><span class="pill p1">P1</span></div>
    <form class="form" id="clientTicketForm">
      <div class="field"><label>Site</label><select class="select" name="siteId" required>${sites.map(s => option(s.id, `${s.city} · ${s.name}`)).join("")}</select></div>
      <div class="field"><label>Issue</label><input class="input" name="issue" placeholder="Plant condition concern / area not serviced" required /></div>
      <div class="field"><label>Description</label><textarea class="textarea" name="description" placeholder="Add exact location, concern, or expectation."></textarea></div>
      <button class="btn" type="submit">Create Priority 1 Ticket</button>
    </form></section>`;
}

function reportsView(supervisor = true) {
  const { db } = dbx();
  const { scans, tickets } = visibleRecords();
  return `<section class="card"><div class="card-title"><div><h3>Reports</h3><p class="subtitle">Download service reports by date range, client, city, and site.</p></div><button class="btn" data-action="download-report">Download CSV</button></div>${filterPanel({ client: supervisor })}${metrics(scans, tickets)}<div class="table-wrap"><table><thead><tr><th>Type</th><th>Site</th><th>Details</th><th>Status</th><th>Date</th></tr></thead><tbody>${[...scans.slice(-8).map(s => reportRow(s, "scan", db)), ...tickets.slice(-8).map(t => reportRow(t, "ticket", db))].join("") || `<tr><td colspan="5">No records yet.</td></tr>`}</tbody></table></div></section>`;
}

function reportRow(r, type, db) {
  const site = db.sites.find(s => s.id === r.siteId); const plant = db.plants.find(p => p.id === r.plantId);
  if (type === "scan") return `<tr><td>Scan</td><td>${escapeHtml(site?.name)}</td><td>${escapeHtml(plant?.type)} · score ${r.score}</td><td><span class="pill ${healthClass(r.category)}">${r.category}</span></td><td>${fmtDate(r.createdAt)}</td></tr>`;
  return `<tr><td>Ticket</td><td>${escapeHtml(site?.name)}</td><td>${escapeHtml(r.issue)}</td><td><span class="pill ${r.status === STATUS.CLOSED ? "closed" : r.status === STATUS.IN_PROGRESS ? "progress" : "open"}">${r.status}</span></td><td>${fmtDate(r.createdAt)}</td></tr>`;
}

function historyView(scans, tickets) {
  const closed = tickets.filter(t => t.status === STATUS.CLOSED);
  return `<section class="card"><div class="card-title"><h3>Closed Work History</h3><button class="btn secondary" data-action="download-report">Export</button></div>${metrics(scans, tickets)}${ticketBoard(closed, { scope: "maintenance" })}</section>`;
}

function evidenceView(tickets) {
  const closed = tickets.filter(t => t.status === STATUS.CLOSED && t.closureEvidence);
  return `<section class="card"><h3>Closure Evidence</h3><p class="subtitle">Client-facing proof of work. No evidence means no closure.</p>${closed.length ? `<div class="grid grid-3">${closed.map(t => `<div class="ticket-card"><img class="preview" src="${t.closureEvidence}" alt="Evidence"><strong>${escapeHtml(t.issue)}</strong><span class="small muted">${fmtDate(t.closedAt)} · ${resolutionTime(t)}</span></div>`).join("")}</div>` : `<div class="empty">No closed tickets with evidence yet.</div>`}</section>`;
}

function healthBuckets(scans) {
  const hs = healthSummary(scans); const total = hs.total || 1;
  return `<h3>Health buckets</h3><div class="grid">
    ${bucket("Healthy", hs.healthy, total, "good")}${bucket("Monitor", hs.monitor, total, "monitor")}${bucket("Critical", hs.critical, total, "critical")}
  </div>`;
}
function bucket(label, value, total, cls) { return `<div class="metric ${cls}"><span>${label}</span><strong>${value}</strong><div class="health-bar"><span style="width:${Math.round(value / total * 100)}%"></span></div></div>`; }

function ticketCards(tickets) {
  if (!tickets.length) return `<div class="empty">No tickets in this queue.</div>`;
  return `<div class="grid">${tickets.map(t => ticketCard(t)).join("")}</div>`;
}
function ticketCard(t) {
  const { siteMap, plantMap } = dbx(); const s = slaState(t); const plant = plantMap[t.plantId]; const site = siteMap[t.siteId];
  return `<div class="ticket-card"><div class="ticket-head"><strong>${escapeHtml(t.issue)}</strong><span class="pill ${t.priority.toLowerCase()}">${t.priority}</span></div><div class="ticket-meta"><span class="pill ${t.status === STATUS.CLOSED ? "closed" : t.status === STATUS.IN_PROGRESS ? "progress" : "open"}">${t.status}</span><span class="pill ${s.breached ? "critical" : "good"}">${s.label}</span></div><div class="small muted">${escapeHtml(site?.city)} · ${escapeHtml(site?.name)} · ${escapeHtml(plant?.zone || "General")}</div></div>`;
}

function ticketBoard(tickets, { scope = "supervisor", compact = false } = {}) {
  const { siteMap, plantMap } = dbx();
  if (!tickets.length) return `<div class="empty">No tickets found for selected filters.</div>`;
  if (compact) return ticketCards(tickets);
  return `<div class="table-wrap"><table><thead><tr><th>Ticket</th><th>Location</th><th>Priority</th><th>Status</th><th>SLA</th><th>Evidence / Action</th></tr></thead><tbody>${tickets.map(t => {
    const s = slaState(t); const site = siteMap[t.siteId]; const plant = plantMap[t.plantId];
    return `<tr><td><strong>${escapeHtml(t.issue)}</strong><br><span class="small muted">${t.id}<br>${fmtDate(t.createdAt)}</span></td><td>${escapeHtml(site?.city)}<br><span class="small muted">${escapeHtml(site?.name)} · ${escapeHtml(plant?.zone || "General")}</span></td><td><span class="pill ${t.priority.toLowerCase()}">${t.priority}</span></td><td><span class="pill ${t.status === STATUS.CLOSED ? "closed" : t.status === STATUS.IN_PROGRESS ? "progress" : "open"}">${t.status}</span><br><span class="small muted">Resolution: ${resolutionTime(t)}</span></td><td><span class="pill ${s.breached ? "critical" : "good"}">${s.label}</span><br><span class="small muted">Age ${s.ageLabel}; closure SLA ${s.closureHours}h</span></td><td>${ticketActions(t, scope)}</td></tr>`;
  }).join("")}</tbody></table></div>`;
}

function ticketActions(t, scope) {
  if (scope === "client") return t.closureEvidence ? `<img class="evidence-img" src="${t.closureEvidence}" alt="Evidence"><br><span class="small muted">${escapeHtml(t.closureRemark || "Closed with evidence")}</span>` : `<span class="small muted">Tracked by operations team</span>`;
  if (t.status === STATUS.CLOSED) return `${t.closureEvidence ? `<img class="evidence-img" src="${t.closureEvidence}" alt="Evidence">` : ""}<br><span class="small muted">${escapeHtml(t.closureRemark || "Closed")}</span>`;
  return `<div class="actions">
    ${t.status === STATUS.OPEN ? `<button class="mini-btn" data-action="progress" data-id="${t.id}">Start</button>` : ""}
    <label class="mini-btn">Evidence<input class="hidden" type="file" accept="image/*" data-evidence="${t.id}"></label>
    ${t.closureEvidence ? `<img class="evidence-img" src="${t.closureEvidence}" alt="Evidence">` : ""}
    <button class="mini-btn" data-action="close" data-id="${t.id}">Close</button>
  </div>`;
}

function drawCharts() {
  $$("canvas[data-chart]").forEach(canvas => {
    const data = JSON.parse(canvas.dataset.chart || "[]");
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = rect.width * ratio; canvas.height = rect.height * ratio;
    const ctx = canvas.getContext("2d"); ctx.scale(ratio, ratio);
    const w = rect.width, h = rect.height, pad = 34;
    ctx.clearRect(0,0,w,h); ctx.strokeStyle = "#e4e0d7"; ctx.lineWidth = 1;
    for(let i=0;i<=4;i++){ const y = pad + (h-pad*2)*i/4; ctx.beginPath(); ctx.moveTo(pad,y); ctx.lineTo(w-pad,y); ctx.stroke(); }
    if (!data.length) { ctx.fillStyle = "#6d756f"; ctx.font = "13px Inter"; ctx.fillText("No scan data yet", pad, h/2); return; }
    const xs = i => pad + (w-pad*2)*(data.length===1?0.5:i/(data.length-1)); const ys = v => h-pad - (h-pad*2)*(v/10);
    ctx.strokeStyle = "#1c6048"; ctx.lineWidth = 3; ctx.beginPath(); data.forEach((d,i)=> i?ctx.lineTo(xs(i),ys(d.avg)):ctx.moveTo(xs(i),ys(d.avg))); ctx.stroke();
    data.forEach((d,i)=>{ ctx.fillStyle="#0f2f24"; ctx.beginPath(); ctx.arc(xs(i),ys(d.avg),4,0,Math.PI*2); ctx.fill(); });
    ctx.fillStyle = "#6d756f"; ctx.font = "12px Inter"; ctx.fillText("0", 10, h-pad); ctx.fillText("10", 8, pad+4); ctx.fillText("Avg health score", pad, 18);
  });
}

async function diagnose(form) {
  const fd = new FormData(form); const { db } = dbx(); const site = db.sites.find(s => s.id === fd.get("siteId"));
  const payload = { imageBase64: dataUrlToBase64(state.scanImage), note: fd.get("note"), site: site?.name, location: fd.get("zone"), plantType: fd.get("plantType") };
  const out = $("#scanOutput"); out.innerHTML = `<div class="card soft"><strong>Analysing plant...</strong><p class="subtitle">Only this step calls the LLM. Result will be cached locally.</p></div>`;
  const res = await fetch(APP.diagnosisEndpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await res.json(); if (!res.ok) throw new Error(data.error || "Diagnosis failed");
  createScanRecord({ siteId: fd.get("siteId"), zone: fd.get("zone"), plantType: fd.get("plantType") }, data, state.scanImage);
  const category = data.condition_score >= 7 ? "Healthy" : data.condition_score >= 6 ? "Monitor" : "Critical";
  out.innerHTML = `<div class="card scan-result"><div class="card-title"><h3>${escapeHtml(data.plant_identified || "Plant diagnosed")}</h3><span class="pill ${healthClass(category)}">${category} · ${data.condition_score}/10</span></div><p><strong>${escapeHtml(data.issue_detected)}</strong></p><p class="muted">Root cause: ${escapeHtml(data.root_cause)}</p><ol class="instruction-list">${(data.treatment_plan || []).map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ol>${category === "Critical" ? `<p class="danger-text">Automatic ticket created with SLA timer.</p>` : ""}</div>`;
  state.scanImage = ""; state.scanDraft = { siteId: "", zone: "", plantType: "", note: "" }; toast("Diagnosis saved. Dashboard updated.");
}

function bindEvents() {
  document.addEventListener("click", async e => {
    const role = e.target.closest("[data-role]")?.dataset.role; if (role) { state.role = role; state.tab = roleTabs[role][0]; sessionStorage.setItem(APP.sessionRoleKey, role); sessionStorage.setItem(APP.sessionTabKey, state.tab); render(); return; }
    const tab = e.target.closest("[data-tab]")?.dataset.tab; if (tab) { state.tab = tab; sessionStorage.setItem(APP.sessionTabKey, tab); render(); return; }
    const action = e.target.closest("[data-action]")?.dataset.action; const id = e.target.closest("[data-id]")?.dataset.id;
    try {
      if (action === "seed") { seedDemoData(); toast("Demo data seeded."); render(); }
      if (action === "reset" && confirm("Reset all local app data?")) { resetDb(); state.filters = { clientId:"all",siteId:"all",city:"all",from:"",to:"" }; state.scanDraft = { siteId:"", zone:"", plantType:"", note:"" }; state.scanImage = ""; toast("Local data reset."); render(); }
      if (action === "download-report") exportCsvReport(getDb(), roleFilter(getDb()));
      if (action === "clear-scan-image") { state.scanImage = ""; toast("Plant image removed."); render(); }
      if (action === "progress") { markInProgress(id); toast("Ticket moved to In Progress."); render(); }
      if (action === "close") {
        const ticket = getDb().tickets.find(t => t.id === id);
        if (!ticket) throw new Error("Ticket not found.");
        if (!ticket.closureEvidence) throw new Error("Upload picture evidence before closing this ticket.");
        const remark = "Issue resolved and evidence uploaded.";
        closeTicket(id, remark);
        toast("Ticket closed with resolution time captured.");
        render();
      }
    } catch (err) { toast(err.message || "Action failed"); }
  });
  document.addEventListener("change", async e => {
    if (e.target.matches("[data-filter]")) { state.filters[e.target.dataset.filter] = e.target.value; if (["clientId","city"].includes(e.target.dataset.filter)) state.filters.siteId = "all"; render(); }
    if (e.target.closest("#scanForm") && e.target.name) state.scanDraft[e.target.name] = e.target.value;
    if (e.target.matches("[data-scan-image]")) { state.scanImage = await imageToDataUrl(e.target.files[0]); toast("Plant image ready for diagnosis."); render(); }
    if (e.target.matches("[data-evidence]")) { const id = e.target.dataset.evidence; const img = await imageToDataUrl(e.target.files[0], 900, .7); attachEvidence(id, img); toast("Evidence attached. You can now close the ticket."); render(); }
  });
  document.addEventListener("input", e => {
    if (e.target.closest("#scanForm") && e.target.name) state.scanDraft[e.target.name] = e.target.value;
  });
  document.addEventListener("submit", async e => {
    e.preventDefault();
    try {
      if (e.target.id === "scanForm") await diagnose(e.target);
      if (e.target.id === "clientTicketForm") { const fd = new FormData(e.target); createClientTicket({ siteId: fd.get("siteId"), issue: fd.get("issue"), description: fd.get("description") }); toast("Priority 1 ticket created."); state.tab = "overview"; render(); }
    } catch (err) { toast(err.message || "Submit failed"); }
  });
}

window.addEventListener("resize", () => drawCharts());
window.addEventListener("db:changed", () => drawCharts());
bindEvents();
render();
