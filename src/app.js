import { APP, ROLES, STATUS } from "./config.js";
import { getDb, resetDb, seedDemoData } from "./store.js";
import { createScanRecord, createClientTicket, markInProgress, attachEvidence, closeTicket } from "./tickets.js";
import { healthClass, healthSummary, trendByDay } from "./health.js";
import { exportCsvReport, joinRecords } from "./reports.js";
import { slaState, resolutionTime } from "./sla.js";
import { $, $$, dataUrlToBase64, escapeHtml, fmtDate, imageToDataUrl, option, toast } from "./utils.js";

const savedUser = (() => { try { return JSON.parse(sessionStorage.getItem(APP.sessionUserKey) || "null"); } catch { return null; } })();

const state = {
  user: savedUser,
  loginRole: ROLES.MAINTENANCE,
  ownerViewRole: sessionStorage.getItem("greenops_owner_view") || ROLES.SUPERVISOR,
  tab: sessionStorage.getItem(APP.sessionTabKey) || "dashboard",
  scanImage: "",
  clientTicketImage: "",
  qrText: "",
  batchImages: [],
  batchResults: [],
  batchRunning: false,
  scanDraft: { siteId: "", zone: "", plantType: "", note: "" },
  filters: { clientId: "all", siteId: "all", city: "all", from: "", to: "" }
};

const roleTabs = {
  [ROLES.MAINTENANCE]: ["dashboard", "scan", "my tickets", "history"],
  [ROLES.SUPERVISOR]: ["dashboard", "tickets", "sla breaches", "reports"],
  [ROLES.CLIENT]: ["overview", "raise ticket", "reports", "evidence"],
  [ROLES.OWNER]: ["dashboard", "tickets", "sla breaches", "reports", "admin"]
};

function dbx() {
  const db = getDb();
  return {
    db,
    siteMap: Object.fromEntries(db.sites.map(s => [s.id, s])),
    clientMap: Object.fromEntries(db.clients.map(c => [c.id, c])),
    plantMap: Object.fromEntries(db.plants.map(p => [p.id, p]))
  };
}

function currentUser() {
  if (!state.user) return null;
  return getDb().users.find(u => u.id === state.user.id) || state.user;
}
function actualRole() { return currentUser()?.role || null; }
function effectiveRole() { return actualRole() === ROLES.OWNER ? state.ownerViewRole : actualRole(); }
function isOwner() { return actualRole() === ROLES.OWNER; }

function allowedSites(db = getDb()) {
  const user = currentUser();
  if (!user) return [];
  if (user.role === ROLES.OWNER) return db.sites;
  if (user.role === ROLES.SUPERVISOR) return db.sites.filter(s => (user.cityAccess || []).includes(s.city));
  if (user.siteAccess?.length) return db.sites.filter(s => user.siteAccess.includes(s.id));
  if (user.clientAccess?.length) return db.sites.filter(s => user.clientAccess.includes(s.clientId));
  return [];
}
function allowedSiteIds(db = getDb()) { return allowedSites(db).map(s => s.id); }
function allowedClients(db = getDb()) {
  const ids = new Set(allowedSites(db).map(s => s.clientId));
  return db.clients.filter(c => ids.has(c.id));
}

function roleFilter(db = getDb()) {
  return { ...state.filters, siteIds: allowedSiteIds(db) };
}
function visibleRecords() { return joinRecords(getDb(), roleFilter(getDb())); }

function loginScreen() {
  const role = state.loginRole;
  const isClient = role === ROLES.CLIENT;
  const isOwnerLogin = role === ROLES.OWNER;
  const credentialLabel = isClient ? "Registered email" : isOwnerLogin ? "Admin phone or email" : "Registered phone number";
  const secretLabel = isClient ? "Password" : isOwnerLogin ? "PIN or password" : "PIN";
  return `<main class="login-shell">
    <div class="login-frame">
      <section class="login-hero" aria-label="GreenOps ITSM overview">
        <div class="login-hero-copy">
          <h2 class="login-hero-statement">
            Every plant<br />
            Every site<br />
            Fully accounted for
          </h2>
        </div>
      </section>
      <section class="login-card">
        <div class="brand login-brand"><div class="logo">G</div><div><h1>${APP.name}</h1><p>Enterprise Plant Operations Platform</p></div></div>
        <h2>Sign in to your workspace</h2>
        <p class="subtitle">Each user sees only the interface, sites, and workflows assigned to them.</p>
        <div class="login-role-grid">
          ${loginRoleButton(ROLES.MAINTENANCE, "Maintenance", "Phone + PIN")}
          ${loginRoleButton(ROLES.SUPERVISOR, "Supervisor", "Phone + PIN")}
          ${loginRoleButton(ROLES.CLIENT, "Client", "Email + password")}
          ${loginRoleButton(ROLES.OWNER, "Admin", "Master access")}
        </div>
        <form id="loginForm" class="form login-form">
          <input type="hidden" name="role" value="${role}" />
          <div class="field"><label>${credentialLabel}</label><input class="input" name="identifier" autocomplete="username" required /></div>
          <div class="field"><label>${secretLabel}</label><input class="input" name="secret" type="password" autocomplete="current-password" required /></div>
          <button class="btn" type="submit">Sign In</button>
        </form>
      </section>
    </div>
  </main>`;
}
function loginRoleButton(role, label, hint) {
  return `<button type="button" class="login-role ${state.loginRole === role ? "active" : ""}" data-login-role="${role}"><strong>${label}</strong><span>${hint}</span></button>`;
}

function authenticate(role, identifier, secret) {
  const id = String(identifier || "").trim().toLowerCase();
  const sec = String(secret || "").trim();
  return getDb().users.find(u => {
    if (u.role !== role) return false;
    const phoneOk = u.phone && String(u.phone).toLowerCase() === id;
    const emailOk = u.email && String(u.email).toLowerCase() === id;
    if (role === ROLES.CLIENT) return emailOk && u.password === sec;
    if (role === ROLES.OWNER) return (phoneOk && u.pin === sec) || (emailOk && u.password === sec);
    return (phoneOk && u.pin === sec) || (emailOk && u.password === sec);
  });
}
function setLoggedIn(user) {
  state.user = { id: user.id, name: user.name, role: user.role };
  sessionStorage.setItem(APP.sessionUserKey, JSON.stringify(state.user));
  state.tab = firstTabFor(effectiveRole());
  sessionStorage.setItem(APP.sessionTabKey, state.tab);
  state.filters = { clientId: "all", siteId: "all", city: "all", from: "", to: "" };
  state.scanDraft = { siteId: "", zone: "", plantType: "", note: "" };
  state.scanImage = "";
  state.clientTicketImage = "";
  state.qrText = "";
  state.batchImages = [];
  state.batchResults = [];
  state.batchRunning = false;
}
function logout() {
  state.user = null;
  state.tab = "dashboard";
  sessionStorage.removeItem(APP.sessionUserKey);
  sessionStorage.removeItem(APP.sessionTabKey);
  sessionStorage.removeItem("greenops_owner_view");
}
function firstTabFor(role) { return (roleTabs[role] || roleTabs[ROLES.MAINTENANCE])[0]; }

function layout(content) {
  const role = effectiveRole();
  const tabs = isOwner() && state.ownerViewRole === ROLES.MAINTENANCE ? roleTabs[ROLES.MAINTENANCE] : isOwner() && state.ownerViewRole === ROLES.CLIENT ? roleTabs[ROLES.CLIENT] : isOwner() ? roleTabs[ROLES.OWNER] : roleTabs[role];
  if (!tabs.includes(state.tab)) state.tab = tabs[0];
  const user = currentUser();
  return `<div class="app-shell">
    <header class="topbar"><div class="top-inner">
      <div class="brand"><img class="brand-icon" src="./assets/Artboard 3.png" alt="GreenOps icon" /><div><h1>${APP.name}</h1><p>Enterprise Plant Operations Platform</p></div></div>
      <div class="user-menu">
        ${isOwner() ? ownerModeSwitch() : ""}
        <span class="user-pill">${escapeHtml(user?.name)} · ${title(actualRole())}</span>
        <button class="logout-btn" data-action="logout">Logout</button>
      </div>
    </div></header>
    <main class="main">
      <section class="hero hero-banner">
        <div class="hero-content"><div class="eyebrow">${escapeHtml(roleLabel())}</div><h2>${heroTitle()}</h2><p>${heroSubtitle()}</p></div>
        ${isOwner() ? adminQuickActions() : ""}
        <nav class="tabs tab-bar" aria-label="Section tabs">${tabs.map(t => `<button class="tab-item ${state.tab === t ? "active" : ""}" data-tab="${t}">${title(t)}</button>`).join("")}</nav>
      </section>
      <div style="height:16px"></div>${content}
    </main>
  </div>`;
}
function ownerModeSwitch() {
  return `<div class="owner-mode">
    <button class="${state.ownerViewRole === ROLES.SUPERVISOR ? "active" : ""}" data-owner-view="${ROLES.SUPERVISOR}">Supervisor</button>
    <button class="${state.ownerViewRole === ROLES.MAINTENANCE ? "active" : ""}" data-owner-view="${ROLES.MAINTENANCE}">Maintenance</button>
    <button class="${state.ownerViewRole === ROLES.CLIENT ? "active" : ""}" data-owner-view="${ROLES.CLIENT}">Client</button>
  </div>`;
}
function adminQuickActions() {
  return `<div class="hero-actions"><button class="btn secondary" data-action="seed">Seed demo data</button><button class="btn ghost" data-action="reset">Reset local data</button></div>`;
}
function title(s = "") {
  if (s === ROLES.OWNER) return "Admin";
  return String(s).split(" ").map(w => w.toLowerCase() === "sla" ? "SLA" : (w[0]?.toUpperCase() + w.slice(1))).join(" ");
}
function roleLabel() { const r = effectiveRole(); return r === ROLES.MAINTENANCE ? "Field execution" : r === ROLES.SUPERVISOR ? "Operations command center" : r === ROLES.CLIENT ? "Client visibility" : "Owner access"; }
function heroTitle() {
  const r = effectiveRole();
  if (r === ROLES.MAINTENANCE) return "Scan, act, close with proof.";
  if (r === ROLES.SUPERVISOR) return "Control assigned cities like an ITSM desk.";
  if (r === ROLES.CLIENT) return "Your sites, tickets, reports, and proof.";
  return "Owner control center.";
}
function heroSubtitle() {
  const r = effectiveRole();
  if (r === ROLES.MAINTENANCE) return "Staff sees only assigned sites and tasks. Scan, follow instructions, upload evidence, and close work.";
  if (r === ROLES.SUPERVISOR) return "City-restricted dashboard with plant health, SLA ageing, tickets, and downloadable reports.";
  if (r === ROLES.CLIENT) return "Client view is restricted to your mapped locations only. Raise P1 tickets and download reports.";
  return "Master owner access can view all sites, seed demo data, reset demo data, and test role modes.";
}

function render() {
  if (!state.user) { $("#app").innerHTML = loginScreen(); return; }
  const role = effectiveRole();
  const body = role === ROLES.MAINTENANCE ? maintenanceView() : role === ROLES.CLIENT ? clientView() : supervisorView();
  $("#app").innerHTML = layout(body);
  drawCharts();
}

function filterPanel({ client = true } = {}) {
  const { db } = dbx();
  const sitesAllowed = allowedSites(db);
  const clientsAllowed = allowedClients(db);
  const cities = [...new Set(sitesAllowed.map(s => s.city))].sort();
  const sites = sitesAllowed.filter(s => (state.filters.city === "all" || s.city === state.filters.city) && (state.filters.clientId === "all" || s.clientId === state.filters.clientId));
  const showClient = client && effectiveRole() !== ROLES.CLIENT;
  return `<div class="filters">
    ${showClient ? `<select class="select" data-filter="clientId">${option("all", "All clients", state.filters.clientId === "all")}${clientsAllowed.map(c => option(c.id, c.name, state.filters.clientId === c.id)).join("")}</select>` : ""}
    <select class="select" data-filter="city">${option("all", "All cities", state.filters.city === "all")}${cities.map(c => option(c, c, state.filters.city === c)).join("")}</select>
    <select class="select" data-filter="siteId">${option("all", sitesAllowed.length === 1 ? sitesAllowed[0].name : "All assigned sites", state.filters.siteId === "all")}${sites.map(s => option(s.id, s.name, state.filters.siteId === s.id)).join("")}</select>
    <input class="input" type="date" data-filter="from" value="${escapeHtml(state.filters.from)}" />
    <input class="input" type="date" data-filter="to" value="${escapeHtml(state.filters.to)}" />
  </div>`;
}

function metrics(scans, tickets) {
  const hs = healthSummary(scans);
  const open = tickets.filter(t => t.status !== STATUS.CLOSED);
  const breached = open.filter(t => slaState(t).breached);
  const avgHealth = hs.avg ? hs.avg : `<span class="metric-dash">—</span>`;
  return `<div class="kpi-strip"><div class="metric"><span>Avg Health</span><strong>${avgHealth}</strong></div><div class="metric good"><span>Healthy</span><strong>${hs.healthy}</strong></div><div class="metric monitor"><span>Monitor</span><strong>${hs.monitor}</strong></div><div class="metric critical"><span>Critical / SLA</span><strong>${hs.critical}/${breached.length}</strong></div></div>`;
}

function maintenanceView() {
  const { scans, tickets } = visibleRecords();
  if (state.tab === "scan") return scanView();
  if (state.tab === "my tickets") return ticketBoard(tickets.filter(t => t.status !== STATUS.CLOSED), { scope: "maintenance" });
  if (state.tab === "history") return historyView(scans, tickets);
  return `<div class="grid grid-2"><section class="card">${metrics(scans, tickets)}<div class="grid grid-2"><button class="btn" data-tab="scan">Scan Plant</button><button class="btn secondary" data-tab="my tickets">My Open Tasks</button></div><p class="footer-note">This view is restricted to assigned sites only.</p></section><section class="card"><div class="card-title"><h3>Critical assigned queue</h3><span class="pill critical">Action required</span></div>${ticketCards(tickets.filter(t => t.status !== STATUS.CLOSED).slice(0, 5))}</section></div>`;
}

function scanView() {
  const sites = allowedSites();
  const draft = state.scanDraft;
  const selectedSite = draft.siteId || sites[0]?.id || "";
  return `<div class="split"><section class="card"><div class="card-title"><h3>Scan Plant</h3><span class="pill good">AI Diagnosis</span></div><div class="form" id="scanPanel"><div class="grid grid-2"><div class="field"><label>Assigned site</label><select class="select" data-scan-field="siteId">${sites.map(s => option(s.id, `${s.city} · ${s.name}`, selectedSite === s.id)).join("")}</select></div><div class="field"><label>Zone / Location</label><input class="input" data-scan-field="zone" value="${escapeHtml(draft.zone)}" placeholder="Reception / Drop-off / Lobby" /></div></div><div class="field"><label>Plant type, if known</label><input class="input" data-scan-field="plantType" value="${escapeHtml(draft.plantType)}" placeholder="Areca Palm / ZZ / Peace Lily" /></div><div class="field"><label>Technician note</label><textarea class="textarea" data-scan-field="note" placeholder="Add technician observations.">${escapeHtml(draft.note)}</textarea></div><div class="filebox"><strong>Upload plant image</strong><br><div class="btn-row" style="justify-content:center;margin-top:12px"><label class="mini-btn">Choose image<input class="hidden" type="file" accept="image/*" data-scan-image /></label><button class="mini-btn danger ${state.scanImage ? "" : "hidden"}" type="button" data-action="clear-scan-image">Remove image</button></div><div id="scanImageState">${scanImageMarkup()}</div></div><button class="btn ${state.scanImage ? "" : "secondary"}" id="runDiagnosisBtn" type="button" data-action="run-diagnosis">Run AI Diagnosis</button></div><div id="scanOutput"></div></section><section class="card soft"><h3>Health Categories</h3><div class="grid"><div class="ticket-card"><div class="ticket-head"><strong>Healthy</strong><span class="pill good">7+</span></div></div><div class="ticket-card"><div class="ticket-head"><strong>Monitor</strong><span class="pill monitor">6–6.9</span></div></div><div class="ticket-card"><div class="ticket-head"><strong>Critical</strong><span class="pill critical">Below 6</span></div></div></div></section></div>`;
}
function scanImageMarkup() { return state.scanImage ? `<div class="image-ready" style="margin-top:12px"><span class="pill good">Plant image ready</span></div><img src="${state.scanImage}" class="preview" alt="Plant preview" />` : `<div class="small muted" style="margin-top:12px">No image selected yet.</div>`; }
function syncScanDraftFromDom() { const panel = document.querySelector("#scanPanel"); if (!panel) return; const next = { ...state.scanDraft }; panel.querySelectorAll("[data-scan-field]").forEach(el => { next[el.dataset.scanField] = el.value || ""; }); state.scanDraft = next; }
function updateScanImageUi() { const box = document.querySelector("#scanImageState"); if (box) box.innerHTML = scanImageMarkup(); const btn = document.querySelector("#runDiagnosisBtn"); if (btn) btn.disabled = !state.scanImage; const removeBtn = document.querySelector('[data-action="clear-scan-image"]'); if (removeBtn) removeBtn.classList.toggle("hidden", !state.scanImage); }

function supervisorView() {
  const { scans, tickets } = visibleRecords();
  if (state.tab === "tickets") return `<section class="card">${filterPanel()}${ticketBoard(tickets, { scope: "supervisor" })}</section>`;
  if (state.tab === "sla breaches") return `<section class="card">${filterPanel()}${ticketBoard(tickets.filter(t => t.status !== STATUS.CLOSED && slaState(t).breached), { scope: "supervisor" })}</section>`;
  if (state.tab === "reports") return reportsView(true);
  if (state.tab === "admin" && isOwner()) return adminView();
  return `<section class="card">${filterPanel()}${metrics(scans, tickets)}<div class="grid grid-2"><div>${healthBuckets(scans)}</div><div><h3>Health trend</h3><canvas class="chart" data-chart='${JSON.stringify(trendByDay(scans)).replaceAll("'", "&#39;")}'></canvas></div></div></section><div style="height:16px"></div><section class="card"><div class="card-title"><h3>Live ticket queue</h3><button class="btn secondary" data-tab="tickets">Open full board</button></div>${ticketBoard(tickets.slice(0, 8), { scope: "supervisor", compact: true })}</section>`;
}
function adminView() { return `<section class="card"><div class="card-title"><div><h3>Owner Admin Tools</h3><p class="subtitle">Visible only to the master owner account.</p></div></div><div class="grid grid-2"><button class="btn secondary" data-action="seed">Seed demo data</button><button class="btn ghost" data-action="reset">Reset local data</button></div><p class="footer-note">Normal maintenance, supervisor, and client users cannot see these controls.</p></section>`; }

function clientView() {
  const { scans, tickets } = visibleRecords();
  if (state.tab === "raise ticket") return raiseTicketView();
  if (state.tab === "reports") return reportsView(false);
  if (state.tab === "evidence") return evidenceView(tickets);
  return `<section class="card">${filterPanel({ client: false })}${metrics(scans, tickets)}<div class="grid grid-2"><div><h3>Location health graph</h3><canvas class="chart" data-chart='${JSON.stringify(trendByDay(scans)).replaceAll("'", "&#39;")}'></canvas></div><div>${healthBuckets(scans)}</div></div></section><div style="height:16px"></div><section class="card"><div class="card-title"><h3>Your open tickets</h3></div><button class="btn client-raise-ticket-cta" data-tab="raise ticket">Raise Priority 1 Ticket</button><div style="height:14px"></div>${ticketBoard(tickets, { scope: "client", compact: true })}</section>`;
}
function raiseTicketView() {
  const sites = allowedSites();
  return `<section class="card"><div class="card-title"><div><h3>Raise Client Ticket</h3><p class="subtitle">Every client-created ticket is automatically Priority 1. Photo evidence is optional.</p></div><span class="pill p1">P1</span></div><form class="form" id="clientTicketForm"><div class="field"><label>Your site</label><select class="select" name="siteId" required>${sites.map(s => option(s.id, `${s.city} · ${s.name}`)).join("")}</select></div><div class="field"><label>Issue</label><input class="input" name="issue" placeholder="Plant condition concern / area not serviced" required /></div><div class="field"><label>Description</label><textarea class="textarea" name="description" placeholder="Add exact location, concern, or expectation."></textarea></div><div class="filebox"><strong>Optional issue photo</strong><br><span class="small muted">Add a photo if it helps the operations team understand the issue.</span><div class="btn-row" style="justify-content:center;margin-top:12px"><label class="mini-btn">Upload / click photo<input class="hidden" type="file" accept="image/*" capture="environment" data-client-evidence /></label><button class="mini-btn danger ${state.clientTicketImage ? "" : "hidden"}" type="button" data-action="clear-client-ticket-image">Remove photo</button></div><div id="clientTicketImageState">${clientTicketImageMarkup()}</div></div><button class="btn" type="submit">Create Priority 1 Ticket</button></form></section>`;
}
function clientTicketImageMarkup() {
  return state.clientTicketImage ? `<div class="image-ready" style="margin-top:12px"><span class="pill good">Issue photo attached</span></div><img src="${state.clientTicketImage}" class="preview" alt="Client issue photo" />` : `<div class="small muted" style="margin-top:12px">No photo attached. This is optional.</div>`;
}
function updateClientTicketImageUi() {
  const box = document.querySelector("#clientTicketImageState");
  if (box) box.innerHTML = clientTicketImageMarkup();
  const removeBtn = document.querySelector('[data-action="clear-client-ticket-image"]');
  if (removeBtn) removeBtn.classList.toggle("hidden", !state.clientTicketImage);
}

function reportsView(supervisor = true) {
  const { db } = dbx(); const { scans, tickets } = visibleRecords();
  return `<section class="card"><div class="card-title"><div><h3>Reports</h3><p class="subtitle">Download service reports by date range, city, and site.</p></div><button class="btn report-download-btn" data-action="download-report">Download CSV</button></div>${filterPanel({ client: supervisor })}${metrics(scans, tickets)}<div class="table-wrap"><table><thead><tr><th>Type</th><th>Site</th><th>Details</th><th>Status</th><th>Date</th></tr></thead><tbody>${[...scans.slice(-8).map(s => reportRow(s, "scan", db)), ...tickets.slice(-8).map(t => reportRow(t, "ticket", db))].join("") || `<tr><td colspan="5">No records yet.</td></tr>`}</tbody></table></div></section>`;
}
function reportRow(r, type, db) { const site = db.sites.find(s => s.id === r.siteId); const plant = db.plants.find(p => p.id === r.plantId); if (type === "scan") return `<tr><td>Scan</td><td>${escapeHtml(site?.name)}</td><td>${escapeHtml(plant?.type)} · score ${r.score}</td><td><span class="pill ${healthClass(r.category)}">${r.category}</span></td><td>${fmtDate(r.createdAt)}</td></tr>`; return `<tr><td>Ticket</td><td>${escapeHtml(site?.name)}</td><td>${escapeHtml(r.issue)}</td><td><span class="pill ${r.status === STATUS.CLOSED ? "closed" : r.status === STATUS.IN_PROGRESS ? "progress" : "open"}">${r.status}</span></td><td>${fmtDate(r.createdAt)}</td></tr>`; }
function historyView(scans, tickets) { const closed = tickets.filter(t => t.status === STATUS.CLOSED); return `<section class="card"><div class="card-title"><h3>Closed Work History</h3><button class="btn secondary" data-action="download-report">Export</button></div>${metrics(scans, tickets)}${ticketBoard(closed, { scope: "maintenance" })}</section>`; }
function evidenceView(tickets) { const closed = tickets.filter(t => t.status === STATUS.CLOSED && t.closureEvidence); return `<section class="card"><h3>Closure Evidence</h3><p class="subtitle">Client-facing proof of work. Closure photos are accepted only after health check.</p>${closed.length ? `<div class="grid grid-3">${closed.map(t => `<div class="ticket-card"><img class="preview" src="${t.closureEvidence}" alt="Evidence"><strong>${escapeHtml(t.issue)}</strong><span class="small muted">${fmtDate(t.closedAt)} - ${resolutionTime(t)}</span><span class="pill good">Verified closure photo</span></div>`).join("")}</div>` : `<div class="empty">No closed tickets with evidence yet.</div>`}</section>`; }
function healthBuckets(scans) {
  const hs = healthSummary(scans);
  const total = hs.total || 1;
  return `<div class="card health-buckets-card"><h3>Health buckets</h3><div class="health-bucket-list">${bucket("Healthy", hs.healthy, total, "healthy")}${bucket("Monitor", hs.monitor, total, "monitor")}${bucket("Critical", hs.critical, total, "critical")}</div></div>`;
}
function bucket(label, value, total, cls) {
  const pct = Math.round((value / total) * 100);
  return `<div class="health-bucket-row ${cls}"><div class="health-bucket-row-top"><span>${label}</span><strong>${value}</strong></div><div class="health-bucket-bar"><i style="width:${pct}%"></i></div></div>`;
}
function ticketDisplayId(t) { if (t.ticketNo) return String(t.ticketNo).padStart(6, "0").slice(-6); const raw = String(t.id || ""); let hash = 0; for (let i = 0; i < raw.length; i++) hash = ((hash << 5) - hash + raw.charCodeAt(i)) >>> 0; return String(100000 + (hash % 900000)); }
function ticketCards(tickets) { if (!tickets.length) return `<div class="empty">No tickets in this queue.</div>`; return `<div class="grid">${tickets.map(t => ticketCard(t)).join("")}</div>`; }
function ticketCard(t) { const { siteMap, plantMap } = dbx(); const s = slaState(t); const plant = plantMap[t.plantId]; const site = siteMap[t.siteId]; return `<div class="ticket-card"><div class="ticket-head"><strong>${escapeHtml(t.issue)}</strong><span class="pill ${t.priority.toLowerCase()}">${t.priority}</span></div><div class="ticket-meta"><span class="pill">#${ticketDisplayId(t)}</span><span class="pill ${t.status === STATUS.CLOSED ? "closed" : t.status === STATUS.IN_PROGRESS ? "progress" : "open"}">${t.status}</span><span class="pill ${s.breached ? "critical" : "good"}">${s.label}</span></div><div class="small muted">${escapeHtml(site?.city)} · ${escapeHtml(site?.name)} · ${escapeHtml(plant?.zone || "General")}</div></div>`; }
function ticketBoard(tickets, { scope = "supervisor", compact = false } = {}) { const { siteMap, plantMap } = dbx(); if (!tickets.length) return `<div class="empty">No tickets found for selected filters.</div>`; if (compact) return ticketCards(tickets); return `<div class="table-wrap"><table><thead><tr><th>Ticket</th><th>Location</th><th>Priority</th><th>Status</th><th>SLA</th><th>Evidence / Action</th></tr></thead><tbody>${tickets.map(t => { const s = slaState(t); const site = siteMap[t.siteId]; const plant = plantMap[t.plantId]; return `<tr><td><strong>${escapeHtml(t.issue)}</strong><br><span class="small muted">Ticket #${ticketDisplayId(t)}<br>${fmtDate(t.createdAt)}</span></td><td>${escapeHtml(site?.city)}<br><span class="small muted">${escapeHtml(site?.name)} · ${escapeHtml(plant?.zone || "General")}</span></td><td><span class="pill ${t.priority.toLowerCase()}">${t.priority}</span></td><td><span class="pill ${t.status === STATUS.CLOSED ? "closed" : t.status === STATUS.IN_PROGRESS ? "progress" : "open"}">${t.status}</span><br><span class="small muted">Resolution: ${resolutionTime(t)}</span></td><td><span class="pill ${s.breached ? "critical" : "good"}">${s.label}</span><br><span class="small muted">Age ${s.ageLabel}; closure SLA ${s.closureHours}h</span></td><td>${ticketActions(t, scope)}</td></tr>`; }).join("")}</tbody></table></div>`; }
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

function drawCharts() { $$("canvas[data-chart]").forEach(canvas => { const data = JSON.parse(canvas.dataset.chart || "[]"); const rect = canvas.getBoundingClientRect(); const ratio = window.devicePixelRatio || 1; canvas.width = rect.width * ratio; canvas.height = rect.height * ratio; const ctx = canvas.getContext("2d"); ctx.scale(ratio, ratio); const w = rect.width, h = rect.height, pad = 34; ctx.clearRect(0,0,w,h); ctx.strokeStyle = "#e4e0d7"; ctx.lineWidth = 1; for(let i=0;i<=4;i++){ const y = pad + (h-pad*2)*i/4; ctx.beginPath(); ctx.moveTo(pad,y); ctx.lineTo(w-pad,y); ctx.stroke(); } if (!data.length) { ctx.fillStyle = "#6d756f"; ctx.font = "13px Inter"; ctx.fillText("No scan data yet", pad, h/2); return; } const xs = i => pad + (w-pad*2)*(data.length===1?0.5:i/(data.length-1)); const ys = v => h-pad - (h-pad*2)*(v/10); ctx.strokeStyle = "#1c6048"; ctx.lineWidth = 3; ctx.beginPath(); data.forEach((d,i)=> i?ctx.lineTo(xs(i),ys(d.avg)):ctx.moveTo(xs(i),ys(d.avg))); ctx.stroke(); data.forEach((d,i)=>{ ctx.fillStyle="#0f2f24"; ctx.beginPath(); ctx.arc(xs(i),ys(d.avg),4,0,Math.PI*2); ctx.fill(); }); ctx.fillStyle = "#6d756f"; ctx.font = "12px Inter"; ctx.fillText("0", 10, h-pad); ctx.fillText("10", 8, pad+4); ctx.fillText("Avg health score", pad, 18); }); }

async function diagnoseFromState() {
  syncScanDraftFromDom();
  const draft = { ...state.scanDraft };
  if (!state.scanImage) throw new Error("Upload a plant image before diagnosis.");
  const out = $("#scanOutput");
  out.innerHTML = `<div class="card soft"><strong>Checking plant health...</strong><p class="subtitle">Please wait. The scan result will appear here.</p></div>`;
  const result = await diagnoseImage({ image: state.scanImage, draft });
  const data = result.data;
  out.innerHTML = `<div class="card scan-result"><div class="card-title"><h3>${escapeHtml(data.plant_identified || "Plant diagnosed")}</h3><span class="pill ${healthClass(result.category)}">${result.category} · ${result.score}/10</span></div><p><strong>${escapeHtml(data.issue_detected || "Observation captured")}</strong></p><p class="muted">Root cause: ${escapeHtml(data.root_cause || "Not specified")}</p><ol class="instruction-list">${(data.treatment_plan || []).map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ol>${result.category === "Critical" ? `<p class="danger-text">Critical plant logged and ticket created.</p>` : ""}</div>`;
  toast("Diagnosis saved. Dashboard updated.");
}

async function diagnoseImage({ image, draft, batchId = "" }) {
  const { db } = dbx();
  const siteId = draft.siteId || allowedSites(db)[0]?.id || "";
  const site = db.sites.find(s => s.id === siteId);
  if (!siteId) throw new Error("No assigned site available.");
  if (!allowedSiteIds(db).includes(siteId)) throw new Error("This site is not assigned to your account.");
  if (!draft.zone?.trim()) throw new Error("Scan the zone QR or enter a zone.");
  const payload = { imageBase64: dataUrlToBase64(image), note: draft.note, site: site?.name, location: draft.zone, plantType: draft.plantType };
  const res = await fetch(APP.diagnosisEndpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Diagnosis failed");
  createScanRecord({ siteId, zone: draft.zone, plantType: draft.plantType, note: draft.note, batchId, createdBy: currentUser()?.id || "field-user" }, data, image);
  const score = Number(data.condition_score ?? data.score ?? 5);
  const category = score >= 7 ? "Healthy" : score >= 6 ? "Monitor" : "Critical";
  return { data, score, category, label: data.plant_identified || data.issue_detected || "Diagnosis saved" };
}

async function runBatchDiagnosis() {
  syncScanDraftFromDom();
  const draft = { ...state.scanDraft };
  if (!state.batchImages.length) throw new Error("Add batch photos first.");
  if (!draft.zone?.trim()) throw new Error("Scan zone QR or enter the zone before batch scan.");
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
      results.push(result);
    } catch (err) {
      results.push({ category: "Failed", label: err.message || "Scan failed" });
    }
    state.batchResults = results;
  }
  state.batchRunning = false;
  const critical = results.filter(r => r.category === "Critical").length;
  if (out) out.innerHTML = `<div class="card scan-result"><div class="card-title"><h3>Batch complete</h3><span class="pill ${critical ? "critical" : "good"}">${critical} critical</span></div><p>${results.length} photos processed. Critical plants have been logged as tickets.</p>${batchResultsMarkup()}</div>`;
  toast("Batch diagnosis completed.");
}

async function verifyClosureEvidence(id, img) {
  toast("Checking closure photo...", 5000);
  const res = await fetch(APP.verifyEvidenceEndpoint || APP.diagnosisEndpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imageBase64: dataUrlToBase64(img) }) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Closure photo check failed");
  if (!data.accepted) throw new Error(data.reason || "Closure photo not accepted. Upload a clear photo of a healthy/replaced plant.");
  attachEvidence(id, img, data);
  toast("Closure photo accepted. You can close the ticket.");
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
    const action = e.target.closest("[data-action]")?.dataset.action; const id = e.target.closest("[data-id]")?.dataset.id;
    try {
      if (action === "logout") { logout(); render(); return; }
      if (!state.user) return;
      if (action === "seed" && isOwner()) { seedDemoData(); toast("Demo data seeded."); render(); }
      if (action === "reset" && isOwner() && confirm("Reset all local app data?")) { resetDb(); state.filters = { clientId:"all",siteId:"all",city:"all",from:"",to:"" }; state.scanDraft = { siteId:"", zone:"", plantType:"", note:"" }; state.scanImage = ""; state.clientTicketImage = ""; state.batchImages = []; state.batchResults = []; toast("Local data reset."); render(); }
      if (action === "download-report") exportCsvReport(getDb(), roleFilter(getDb()));
      if (action === "clear-scan-image") { syncScanDraftFromDom(); state.scanImage = ""; const input = document.querySelector("[data-scan-image]"); if (input) input.value = ""; updateScanImageUi(); toast("Plant image removed."); }
      if (action === "clear-client-ticket-image") { state.clientTicketImage = ""; const input = document.querySelector("[data-client-evidence]"); if (input) input.value = ""; updateClientTicketImageUi(); toast("Issue photo removed."); }
      if (action === "apply-qr") { const input = document.querySelector("[data-qr-text]"); applyQr(input?.value || state.qrText); }
      if (action === "demo-qr") { applyQr(e.target.closest("[data-qr]")?.dataset.qr || ""); }
      if (action === "voice-note") { startVoiceNote(); }
      if (action === "run-diagnosis") { await diagnoseFromState(); }
      if (action === "clear-batch") { state.batchImages = []; state.batchResults = []; render(); toast("Batch cleared."); }
      if (action === "remove-batch-image") { syncScanDraftFromDom(); const index = Number(e.target.closest("[data-index]")?.dataset.index); state.batchImages.splice(index, 1); render(); }
      if (action === "run-batch") { await runBatchDiagnosis(); }
      if (action === "progress") { markInProgress(id); toast("Ticket moved to In Progress."); render(); }
      if (action === "close") { const ticket = getDb().tickets.find(t => t.id === id); if (!ticket) throw new Error("Ticket not found."); if (!ticket.closureEvidence) throw new Error("Upload closure photo before closing this ticket."); if (!ticket.closureEvidenceVerified) throw new Error("Closure photo must be accepted before closing this ticket."); closeTicket(id, "Issue resolved and verified with closure photo."); toast("Ticket closed with verified evidence."); render(); }
    } catch (err) { toast(err.message || "Action failed"); }
  });
  document.addEventListener("change", async e => {
    if (e.target.matches("[data-filter]")) { state.filters[e.target.dataset.filter] = e.target.value; if (["clientId","city"].includes(e.target.dataset.filter)) state.filters.siteId = "all"; render(); }
    if (e.target.closest("#scanPanel") && e.target.dataset.scanField) state.scanDraft[e.target.dataset.scanField] = e.target.value;
    if (e.target.matches("[data-scan-image]")) { syncScanDraftFromDom(); const file = e.target.files?.[0]; if (!file) return; state.scanImage = await imageToDataUrl(file); updateScanImageUi(); toast("Plant image ready for diagnosis."); }
    if (e.target.matches("[data-client-evidence]")) { const file = e.target.files?.[0]; if (!file) return; state.clientTicketImage = await imageToDataUrl(file, 900, .7); updateClientTicketImageUi(); toast("Issue photo attached."); }
    if (e.target.matches("[data-batch-images]")) { syncScanDraftFromDom(); const files = [...(e.target.files || [])].slice(0, Math.max(0, 20 - state.batchImages.length)); for (const file of files) state.batchImages.push(await imageToDataUrl(file, 900, .68)); render(); toast(`${files.length} batch photo(s) added.`); }
    if (e.target.matches("[data-qr-image]")) { const file = e.target.files?.[0]; if (file) await decodeQrImage(file); }
    if (e.target.matches("[data-evidence]")) { const id = e.target.dataset.evidence; const file = e.target.files?.[0]; if (!file) return; const img = await imageToDataUrl(file, 900, .7); await verifyClosureEvidence(id, img); }
  });
  document.addEventListener("input", e => { if (e.target.closest("#scanPanel") && e.target.dataset.scanField) state.scanDraft[e.target.dataset.scanField] = e.target.value; if (e.target.matches("[data-qr-text]")) state.qrText = e.target.value; });
  document.addEventListener("submit", async e => {
    e.preventDefault();
    try {
      if (e.target.id === "loginForm") { const fd = new FormData(e.target); const user = authenticate(fd.get("role"), fd.get("identifier"), fd.get("secret")); if (!user) throw new Error("Login failed. Check registered credentials."); setLoggedIn(user); toast(`Welcome, ${user.name}.`); render(); return; }
      if (e.target.id === "clientTicketForm") { const fd = new FormData(e.target); const siteId = fd.get("siteId"); if (!allowedSiteIds().includes(siteId)) throw new Error("This site is not assigned to your account."); createClientTicket({ siteId, issue: fd.get("issue"), description: fd.get("description"), clientEvidence: state.clientTicketImage }); state.clientTicketImage = ""; toast("Priority 1 ticket created."); state.tab = "overview"; render(); }
    } catch (err) { toast(err.message || "Submit failed"); }
  });
}

window.addEventListener("resize", () => drawCharts());
window.addEventListener("db:changed", () => drawCharts());
bindEvents();
render();
