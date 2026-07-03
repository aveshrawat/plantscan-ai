const heroBg = new URL('./assets/login-bg.jpeg', import.meta.url).href;
const productIcon = new URL('./assets/Artboard-icon.png', import.meta.url).href;
const logoWordmark = new URL('./assets/onescape-logo-cropped.png', import.meta.url).href;
import { APP, PLACEMENT_BUCKETS, PLANT_CATEGORIES, ROLES, STATUS } from "./config.js";
import { getDb, resetDb, seedDemoData, setDb, tx } from "./store.js";
import { createScanRecord, createClientTicket, markInProgress, attachEvidence, closeTicket } from "./tickets.js";
import { generateInvoiceData, downloadInvoiceHtml, invoiceSummaryText } from "./billing.js";
import { visibleNotifications } from "./notifications.js";
import { healthClass, healthSummary, trendByDay } from "./health.js";
import { exportCsvReport, joinRecords } from "./reports.js";
import { slaState, resolutionTime } from "./sla.js";
import { buildEfficiencyModel, normalizeIssueType, ticketNo as efficiencyTicketNo, zoneOf } from "./efficiency.js";
import { applyBoqRowsToDb, baselineForSite, expectedServiceEventsForBaseline, expectedWaterForBaseline, parseBoqCsvOrSheet, validateBoqRows } from "./boq.js";
import { buildSustainabilityMetrics } from "./sustainability.js";
import { FRAMEWORKS, buildFrameworkView, frameworkPopupForMetric } from "./frameworks.js";
import { canExportSustainabilityReport, canUseFrameworkSwitcher, canViewMetricValues, defaultCoreEntitlement, getClientEntitlement, isTrialActive } from "./entitlements.js";
import { getPendingOfflineRecords, queueOfflineRecord, syncPendingRecords } from "./offlineSync.js";
import { getCurrentGps } from "./cameraProof.js";
import { $, $$, dataUrlToBase64, downloadFile, escapeHtml, fmtDate, imageToDataUrl, nowIso, option, toast, uid } from "./utils.js";

const savedUser = (() => { try { return JSON.parse(sessionStorage.getItem(APP.sessionUserKey) || "null"); } catch { return null; } })();

const state = {
  user: savedUser,
  loginRole: ROLES.MAINTENANCE,
  ownerViewRole: sessionStorage.getItem("greenops_owner_view") || ROLES.SUPERVISOR,
  tab: sessionStorage.getItem(APP.sessionTabKey) || "dashboard",
  scanImage: "",
  cameraOpen: false,
  clientTicketImage: "",
  qrText: "",
  batchImages: [],
  batchResults: [],
  batchRunning: false,
  diagnosisRunning: false,
  serviceLogSubmitting: false,
  scanDraft: {
    siteId: "",
    floor: "",
    placementBucket: "",
    boqLineId: "",
    plantCategory: "",
    zone: "",
    plantType: "",
    plantsServicedCount: 1,
    wateringDone: "true",
    wateredPlantCount: 1,
    replacementsCount: 0,
    deadPlantCount: 0,
    materialUsed: "organic",
    materialName: "",
    issueFound: "false",
    issueCategory: "other",
    disposalRoute: "not_applicable",
    note: "",
    voiceNoteText: "",
    gpsLat: "",
    gpsLng: "",
    gpsAccuracy: "",
    gpsCapturedAt: "",
    syncStatus: ""
  },
  scanCaptureSource: "",
  lastDiagnosis: null,
  boqDraft: { siteId: "", csv: "", fileName: "", rows: [], rejectedRows: [], acceptedRows: [], lastUploadId: "" },
  sustainabilityFramework: sessionStorage.getItem("greenops_sustainability_framework") || "brsr",
  frameworkModalMetricId: "",
  entitlementClientId: "",
  entitlementSiteId: "",
  filters: { clientId: "all", siteId: "all", city: "all", from: "", to: "" },
  efficiencyFilter: sessionStorage.getItem("greenops_efficiency_filter") || "action",
  clientAssuranceFilter: sessionStorage.getItem("greenops_client_assurance_filter") || "",
  assistantOpen: false,
  assistantInput: "",
  assistantLoading: false,
  assistantMessages: [],
  diagnosisLang: "en"
};

let activeCameraStream = null;

function defaultScanDraft() {
  return {
    siteId: "",
    floor: "",
    placementBucket: "",
    boqLineId: "",
    plantCategory: "",
    zone: "",
    plantType: "",
    plantsServicedCount: 1,
    wateringDone: "true",
    wateredPlantCount: 1,
    replacementsCount: 0,
    deadPlantCount: 0,
    materialUsed: "organic",
    materialName: "",
    issueFound: "false",
    issueCategory: "other",
    disposalRoute: "not_applicable",
    note: "",
    voiceNoteText: "",
    gpsLat: "",
    gpsLng: "",
    gpsAccuracy: "",
    gpsCapturedAt: "",
    syncStatus: ""
  };
}

const roleTabs = {
  [ROLES.MAINTENANCE]: ["dashboard", "scan", "my tickets", "history"],
  [ROLES.SUPERVISOR]: ["dashboard", "tickets", "sla breaches", "efficiency", "boq setup", "baseline", "sync monitor", "reports"],
  [ROLES.CLIENT]: ["overview", "raise ticket", "reports", "evidence", "invoices", "sustainability"],
  [ROLES.OWNER]: ["dashboard", "tickets", "sla breaches", "efficiency", "boq setup", "sustainability access", "sync monitor", "reports", "admin"]
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
  const credentialLabel = isClient ? "REGISTERED EMAIL" : isOwnerLogin ? "ADMIN PHONE OR EMAIL" : "REGISTERED PHONE NUMBER";
  const secretLabel = isClient ? "PASSWORD" : isOwnerLogin ? "PIN OR PASSWORD" : "PIN";

  return `<main class="login-shell ey-login-final">
    <img class="ey-bg-photo" src="${heroBg}" alt="" aria-hidden="true" decoding="async" />
    <div class="ey-login-overlay" aria-hidden="true"></div>

    <section class="ey-login-left" aria-label="OneScape identity">
      <img class="ey-login-wordmark" src="${logoWordmark}" alt="OneScape" />
      <div class="ey-login-statement">
        <span>Every Plant</span>
        <span>Every Facility</span>
        <span>Fully accounted for</span>
      </div>
    </section>

    <section class="ey-login-panel" aria-label="GreenOps ITSM sign in">
      <div class="ey-login-card">
        <div class="ey-product-identity">
          <span class="ey-product-icon-shell"><img src="${productIcon}" alt="" /></span>
          <div>
            <h1>GreenOps ITSM</h1>
            <p>Plant Health Service Management</p>
          </div>
        </div>

        <h2>Sign in to your workplace</h2>

        <div class="ey-role-grid">
          ${loginRoleButton(ROLES.MAINTENANCE, "Maintenance")}
          ${loginRoleButton(ROLES.SUPERVISOR, "Supervisor")}
          ${loginRoleButton(ROLES.CLIENT, "Client")}
          ${loginRoleButton(ROLES.OWNER, "Admin")}
        </div>

        <form id="loginForm" class="ey-login-form">
          <input type="hidden" name="role" value="${role}" />
          <div class="ey-login-field">
            <label>${credentialLabel}</label>
            <input name="identifier" autocomplete="username" placeholder="${isClient ? "Enter registered email" : "Enter registered phone number"}" required />
          </div>
          <div class="ey-login-field">
            <label>${secretLabel}</label>
            <input name="secret" type="password" autocomplete="current-password" placeholder="****" required />
          </div>
          <button class="ey-signin-btn" type="submit">Sign In</button>
        </form>
      </div>
    </section>
  </main>`;
}
function loginRoleButton(role, label) {
  return `<button type="button" class="ey-role-card ${state.loginRole === role ? "active" : ""}" data-login-role="${role}">${label}</button>`;
}

function authenticate(role, identifier, secret) {
  const id = String(identifier || "").trim().toLowerCase();
  const sec = String(secret || "").trim();
  return getDb().users.find(u => {
    if (u.role !== role) return false;
    const phoneOk = u.phone && String(u.phone).toLowerCase() === id;
    const emailOk = u.email && String(u.email).toLowerCase() === id;
    const aliasOk = (u.authAliases || []).some(alias =>
      String(alias.identifier || "").trim().toLowerCase() === id &&
      String(alias.secret || "").trim() === sec
    );
    if (role === ROLES.CLIENT) return emailOk && u.password === sec;
    if (role === ROLES.OWNER) return aliasOk || (phoneOk && u.pin === sec) || (emailOk && u.password === sec);
    return aliasOk || (phoneOk && u.pin === sec) || (emailOk && u.password === sec);
  });
}
function setLoggedIn(user) {
  state.user = { id: user.id, name: user.name, role: user.role };
  sessionStorage.setItem(APP.sessionUserKey, JSON.stringify(state.user));
  state.tab = firstTabFor(effectiveRole());
  sessionStorage.setItem(APP.sessionTabKey, state.tab);
  state.filters = { clientId: "all", siteId: "all", city: "all", from: "", to: "" };
  state.scanDraft = defaultScanDraft();
  state.scanImage = "";
  state.cameraOpen = false;
  state.scanCaptureSource = "";
  state.lastDiagnosis = null;
  state.boqDraft = { siteId: "", csv: "", fileName: "", rows: [], rejectedRows: [], acceptedRows: [], lastUploadId: "" };
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

function getStrapData() {
  const role = effectiveRole();
  const { scans, tickets } = visibleRecords();
  const hs = healthSummary(scans);
  const open = tickets.filter(t => t.status !== STATUS.CLOSED);
  const breached = open.filter(t => slaState(t).breached);
  
  if (role === ROLES.MAINTENANCE) {
    return {
      title: "Field Execution",
      subtitle: "Assigned sites & pending actions",
      metrics: [
        { label: "Open Tickets", value: open.length, color: "monitor" },
        { label: "Critical Plants", value: hs.critical, color: "critical" }
      ],
      action: { label: "Start Scan", event: "scan" }
    };
  } else if (role === ROLES.SUPERVISOR || role === ROLES.OWNER) {
    return {
      title: "Portfolio Command Center",
      subtitle: "Risk exposure & performance",
      metrics: [
        { label: "Health Score", value: hs.avg || "—", color: "good" },
        { label: "SLA Breaches", value: breached.length, color: "critical" }
      ],
      action: { label: "Export Report", event: "download-report" }
    };
  } else if (role === ROLES.CLIENT) {
    return {
      title: "Client Visibility",
      subtitle: "Site health & open issues",
      metrics: [
        { label: "Site Health", value: hs.avg || "—", color: "good" },
        { label: "Open Tickets", value: open.length, color: "monitor" }
      ],
      action: { label: "Raise Ticket", event: "raise ticket" }
    };
  }
  return null;
}

function layout(content, strap = null) {
  const role = effectiveRole();
  let tabs = isOwner() && state.ownerViewRole === ROLES.MAINTENANCE ? roleTabs[ROLES.MAINTENANCE] : isOwner() && state.ownerViewRole === ROLES.CLIENT ? roleTabs[ROLES.CLIENT] : isOwner() ? roleTabs[ROLES.OWNER] : roleTabs[role];
  if (role === ROLES.CLIENT && !clientSustainabilityTabVisible()) tabs = tabs.filter(t => t !== "sustainability");
  if (!tabs.includes(state.tab)) state.tab = tabs[0];
  const user = currentUser();
  
  const strapHtml = strap ? `
    <aside class="context-strap">
      <div class="strap-kicker">${escapeHtml(roleLabel())}</div>
      <div class="strap-title">${escapeHtml(strap.title)}</div>
      <div class="strap-subtitle">${escapeHtml(strap.subtitle)}</div>
      ${strap.metrics.map(m => `<div class="strap-metric"><span>${escapeHtml(m.label)}</span><strong class="${m.color}">${escapeHtml(m.value)}</strong></div>`).join("")}
      <button class="btn strap-action" data-action="${strap.action.event}">${escapeHtml(strap.action.label)}</button>
    </aside>
  ` : '';
  
  return `<div class="app-shell">
    <header class="topbar"><div class="top-inner">
      <div class="brand"><img class="brand-icon" src="${productIcon}" alt="GreenOps icon" /><div><h1>${APP.name}</h1><p>Plant Health Service Management</p></div></div>
      <div class="user-menu">
        ${isOwner() ? ownerModeSwitch() : ""}
        <span class="user-pill">Synced 3m ago</span>
        <span class="user-pill">${escapeHtml(user?.name)} · ${title(actualRole())}</span>
        <button class="logout-btn" data-action="logout">Logout</button>
      </div>
    </div></header>
    <div class="platform-shell">
      ${workspaceSidebar(tabs)}
      <main class="main">
        <div class="page-title-row">
          <div>
            <div class="eyebrow dark">${escapeHtml(roleLabel())}</div>
            <h2>${heroTitle()}</h2>
            <p>${heroSubtitle()}</p>
          </div>
          ${isOwner() ? adminQuickActions() : ""}
        </div>
        <nav class="tabs tab-bar" aria-label="Section tabs">${tabs.map(t => `<button class="tab-item ${state.tab === t ? "active" : ""}" data-tab="${t}">${title(t)}</button>`).join("")}</nav>
        <div class="page-layout">
          ${strapHtml}
          <section class="page-canvas">${content}</section>
        </div>
      </main>
    </div>
    ${clientAssistantWidget()}
  </div>`;
}
function workspaceSidebar(tabs = []) {
  const clients = allowedClients();
  const sites = allowedSites();
  const client = clients[0];
  const groupedSites = sites.reduce((acc, site) => {
    (acc[site.city] ||= []).push(site);
    return acc;
  }, {});
  return `<aside class="workspace-sidebar">
    <section class="workspace-block workspace-head">
      <span>Workspace</span>
      <strong>${escapeHtml(client?.name || "All Clients")}</strong>
      <small>${sites.length} site${sites.length === 1 ? "" : "s"} · ${Object.keys(groupedSites).length} cit${Object.keys(groupedSites).length === 1 ? "y" : "ies"}</small>
    </section>
    <section class="workspace-block">
      <span>Modules</span>
      <nav class="side-nav">${tabs.map(t => `<button class="${state.tab === t ? "active" : ""}" data-tab="${t}">${title(t)}</button>`).join("")}</nav>
    </section>
    <section class="workspace-block">
      <span>Site Tree</span>
      <div class="site-tree">${Object.entries(groupedSites).map(([city, citySites]) => `<div class="site-group"><strong>${escapeHtml(city)} · ${citySites.length}</strong>${citySites.map(site => `<button data-filter-site="${escapeHtml(site.id)}">${escapeHtml(site.name)}</button>`).join("")}</div>`).join("") || `<small>No assigned sites</small>`}</div>
    </section>
    <section class="workspace-block saved-view-list">
      <span>Saved Views</span>
      <button class="active">Executive Demo View</button>
      <button>Critical SLA Watch</button>
      <button>Monthly Evidence Pack</button>
    </section>
  </aside>`;
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
  return String(s).split(" ").map(w => ["sla", "boq", "esg"].includes(w.toLowerCase()) ? w.toUpperCase() : (w[0]?.toUpperCase() + w.slice(1))).join(" ");
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
  if (role === ROLES.CLIENT && state.tab === "sustainability" && !clientSustainabilityTabVisible()) {
    state.tab = firstTabFor(role);
    sessionStorage.setItem(APP.sessionTabKey, state.tab);
  }
  const body = role === ROLES.MAINTENANCE ? maintenanceView() : role === ROLES.CLIENT ? clientView() : supervisorView();
  const strap = getStrapData();
  $("#app").innerHTML = layout(body, strap);
  drawCharts();
}

function filterPanel({ client = true } = {}) {
  const { db } = dbx();
  const sitesAllowed = allowedSites(db);
  const clientsAllowed = allowedClients(db);
  const cities = [...new Set(sitesAllowed.map(s => s.city))].sort();
  const sites = sitesAllowed.filter(s => (state.filters.city === "all" || s.city === state.filters.city) && (state.filters.clientId === "all" || s.clientId === state.filters.clientId));
  const showClient = client && effectiveRole() !== ROLES.CLIENT;
  return `<div class="filters scope-bar">
    <div class="scope-fields">
      ${showClient ? `<label><span>Client</span><select class="select" data-filter="clientId">${option("all", "All clients", state.filters.clientId === "all")}${clientsAllowed.map(c => option(c.id, c.name, state.filters.clientId === c.id)).join("")}</select></label>` : ""}
      <label><span>City</span><select class="select" data-filter="city">${option("all", "All cities", state.filters.city === "all")}${cities.map(c => option(c, c, state.filters.city === c)).join("")}</select></label>
      <label><span>Site</span><select class="select" data-filter="siteId">${option("all", sitesAllowed.length === 1 ? sitesAllowed[0].name : "All assigned sites", state.filters.siteId === "all")}${sites.map(s => option(s.id, s.name, state.filters.siteId === s.id)).join("")}</select></label>
      <label><span>From</span><input class="input" type="date" data-filter="from" value="${escapeHtml(state.filters.from)}" /></label>
      <label><span>To</span><input class="input" type="date" data-filter="to" value="${escapeHtml(state.filters.to)}" /></label>
    </div>
    <div class="scope-actions"><button class="mini-btn" type="button">Refresh</button><span>Updated 3m ago</span></div>
  </div>`;
}

function metrics(scans, tickets) {
  const hs = healthSummary(scans);
  const open = tickets.filter(t => t.status !== STATUS.CLOSED);
  const breached = open.filter(t => slaState(t).breached);
  const avgHealth = hs.avg ? hs.avg : `<span style="font-size: 28px; font-weight: 700; color: var(--color-border-strong); letter-spacing: -1px;">—</span>`;
  return `<div class="kpi-strip"><div class="metric"><span>Avg Health</span><strong>${avgHealth}</strong></div><div class="metric good"><span>Healthy</span><strong>${hs.healthy}</strong></div><div class="metric monitor"><span>Monitor</span><strong>${hs.monitor}</strong></div><div class="metric critical"><span>Critical / SLA</span><strong>${hs.critical}/${breached.length}</strong></div></div>`;
}

function maintenanceView() {
  const { scans, tickets } = visibleRecords();
  const hs = healthSummary(scans);
  const open = tickets.filter(t => t.status !== STATUS.CLOSED);
  const breached = open.filter(t => slaState(t).breached);
  if (state.tab === "scan") return scanView();
  if (state.tab === "my tickets") return ticketBoard(tickets.filter(t => t.status !== STATUS.CLOSED), { scope: "maintenance" });
  if (state.tab === "history") return historyView(scans, tickets);
  
  // CSS Donut data (example: 60% good, 20% monitor, 20% critical)
  const donutBg = `conic-gradient(var(--color-good) 0% ${hs.healthy/hs.total*100}%, var(--color-warn) ${hs.healthy/hs.total*100}% ${(hs.healthy+hs.monitor)/hs.total*100}%, var(--color-critical) ${(hs.healthy+hs.monitor)/hs.total*100}% 100%)`;
  
  return `<div class="grid grid-2">
    <section class="card">
      <div class="card-title"><h3>Field Performance</h3></div>
      <div class="kpi-strip">
        <div class="metric ${hs.avg > 7 ? 'good' : 'monitor'}"><span>Health Score</span><strong>${hs.avg || "—"}</strong></div>
        <div class="metric monitor"><span>Open Tickets</span><strong>${open.length}</strong></div>
        <div class="metric critical"><span>SLA Breached</span><strong>${breached.length}</strong></div>
        <div class="metric good"><span>Scan Completion</span><strong>${scans.length}</strong></div>
      </div>
      <div class="card-title"><h3>Health Trend</h3></div>
      <canvas class="chart" data-chart='${JSON.stringify(trendByDay(scans))}'></canvas>
    </section>
    <section class="card">
      <div class="card-title"><h3>Ticket Mix</h3></div>
      <div class="donut-chart-wrapper">
        <div class="donut-chart" style="background: ${donutBg}">
          <div class="legend"><strong>${tickets.length}</strong><span>Total</span></div>
        </div>
      </div>
      <div class="table-wrap">
        <table><thead><tr><th>Status</th><th>Count</th></tr></thead>
        <tbody>
          <tr><td><span class="pill good">Healthy</span></td><td>${hs.healthy}</td></tr>
          <tr><td><span class="pill monitor">Monitor</span></td><td>${hs.monitor}</td></tr>
          <tr><td><span class="pill critical">Critical</span></td><td>${hs.critical}</td></tr>
        </tbody></table>
      </div>
    </section>
    <section class="card" style="grid-column: 1 / -1;">
      <div class="card-title"><h3>Work Queue</h3></div>
      ${ticketBoard(tickets.filter(t => t.status !== STATUS.CLOSED).slice(0, 5), { scope: "maintenance", compact: true })}
    </section>
  </div>`;
}

function scanView() {
  const sites = allowedSites();
  const draft = state.scanDraft;
  const selectedSite = draft.siteId || sites[0]?.id || "";
  const { db } = dbx();
  const baseline = baselineForSite(db, selectedSite);
  const selectedLine = baseline.find(line => line.id === draft.boqLineId);
  const floors = [...new Set([...baseline.map(line => line.floor), ...(db.sites.find(s => s.id === selectedSite)?.zones || [])].filter(Boolean))];
  const buckets = [...new Set([...baseline.filter(line => !draft.floor || line.floor === draft.floor).map(line => line.placementBucket), ...PLACEMENT_BUCKETS])];
  const gpsReady = draft.gpsLat && draft.gpsLng;
  const onlineLabel = navigator.onLine === false ? "Offline" : "Online";
  return `<div class="split scan-workbench"><section class="card scan-card"><div class="card-title"><div><h3>Maintenance Window / Field Service Capture</h3><p class="subtitle">Camera-first service proof, BOQ bucket mapping, GPS metadata, and offline-ready service logs.</p></div><span class="pill good">Field Capture</span></div><div class="form" id="scanPanel"><div class="grid grid-2"><div class="field"><label>Site</label><select class="select" data-scan-field="siteId">${sites.map(s => option(s.id, `${s.city} · ${s.name}`, selectedSite === s.id)).join("")}</select></div><div class="field"><label>Floor / Area</label><select class="select" data-scan-field="floor">${option("", "Select floor / area", !draft.floor)}${floors.map(f => option(f, f, draft.floor === f)).join("")}</select></div></div><div class="grid grid-2"><div class="field"><label>Placement Bucket</label><select class="select" data-scan-field="placementBucket">${option("", "Select placement bucket", !draft.placementBucket)}${buckets.map(bucketName => option(bucketName, bucketName, draft.placementBucket === bucketName)).join("")}</select></div><div class="field"><label>BOQ Baseline Line</label><select class="select" data-scan-field="boqLineId">${option("", baseline.length ? "Match by bucket" : "No active baseline yet", !draft.boqLineId)}${baseline.map(line => option(line.id, `${line.floor} · ${line.placementBucket} · ${line.quantity} plants`, draft.boqLineId === line.id)).join("")}</select></div></div><div class="grid grid-2"><div class="field"><label>Plant Category</label><select class="select" data-scan-field="plantCategory">${option("", "Select category", !draft.plantCategory && !selectedLine)}${PLANT_CATEGORIES.map(category => option(category.id, category.label, (draft.plantCategory || selectedLine?.plantCategory) === category.id)).join("")}</select></div><div class="field"><label>Expected plant variety, if known</label><input class="input" data-scan-field="plantType" value="${escapeHtml(draft.plantType || selectedLine?.plantSpecies || "")}" placeholder="Areca Palm / ZZ / Peace Lily" /></div></div><div class="grid grid-3"><div class="field"><label>Plants serviced count</label><input class="input" type="number" min="0" data-scan-field="plantsServicedCount" value="${escapeHtml(draft.plantsServicedCount)}" /></div><div class="field"><label>Watering done</label><select class="select" data-scan-field="wateringDone">${option("true", "Yes", String(draft.wateringDone) === "true")}${option("false", "No", String(draft.wateringDone) === "false")}</select></div><div class="field"><label>Watered plant count</label><input class="input" type="number" min="0" data-scan-field="wateredPlantCount" value="${escapeHtml(draft.wateredPlantCount)}" /></div></div><div class="grid grid-3"><div class="field"><label>Replacements count</label><input class="input" type="number" min="0" data-scan-field="replacementsCount" value="${escapeHtml(draft.replacementsCount)}" /></div><div class="field"><label>Dead plant count</label><input class="input" type="number" min="0" data-scan-field="deadPlantCount" value="${escapeHtml(draft.deadPlantCount)}" /></div><div class="field"><label>Disposal route</label><select class="select" data-scan-field="disposalRoute">${["composted", "reused", "discarded", "not_applicable"].map(value => option(value, title(value.replaceAll("_", " ")), draft.disposalRoute === value)).join("")}</select></div></div><div class="grid grid-2"><div class="field"><label>Material used</label><select class="select" data-scan-field="materialUsed">${["organic", "chemical", "none", "mixed"].map(value => option(value, title(value), draft.materialUsed === value)).join("")}</select></div><div class="field"><label>Material name</label><input class="input" data-scan-field="materialName" value="${escapeHtml(draft.materialName)}" placeholder="Neem oil / compost / none" /></div></div><div class="grid grid-2"><div class="field"><label>Issue found</label><select class="select" data-scan-field="issueFound">${option("true", "Yes", String(draft.issueFound) === "true")}${option("false", "No", String(draft.issueFound) === "false")}</select></div><div class="field"><label>Issue category</label><select class="select" data-scan-field="issueCategory">${["pest", "damage", "low_light", "water_leakage", "ac_draft", "other"].map(value => option(value, title(value.replaceAll("_", " ")), draft.issueCategory === value)).join("")}</select></div></div><div class="field"><label>Notes / voice text</label><textarea class="textarea" data-scan-field="note" placeholder="Add visible symptoms, work completed, client observation, or follow-up needed.">${escapeHtml(draft.note)}</textarea><div class="btn-row" style="justify-content:flex-start;margin-top:10px"><button class="mini-btn" type="button" data-action="voice-note">Add voice note</button><button class="mini-btn" type="button" data-action="capture-gps">Capture GPS</button><span class="offline-badge">${escapeHtml(onlineLabel)}</span><span class="offline-badge">${gpsReady ? `GPS ${Number(draft.gpsAccuracy || 0).toFixed(0)}m` : "GPS not captured"}</span></div></div><div class="filebox capture-box"><strong>Camera proof required</strong><br><span class="small muted">Use live camera or phone camera only. Gallery upload is disabled for maintenance proof.</span><div class="btn-row capture-actions" style="justify-content:center;margin-top:12px"><button class="mini-btn primary-capture" type="button" data-action="open-camera">Open live camera</button><label class="mini-btn">Phone camera<input class="hidden" type="file" accept="image/*" capture="environment" data-scan-camera /></label><button class="mini-btn danger ${state.scanImage ? "" : "hidden"}" type="button" data-action="clear-scan-image">Remove image</button></div><div id="scanImageState">${scanImageMarkup()}</div></div><div class="btn-row" style="justify-content:flex-start"><button class="btn ${state.scanImage ? "" : "secondary"}" id="runDiagnosisBtn" type="button" data-action="run-diagnosis" ${state.scanImage ? "" : "disabled"}>Run AI Diagnosis</button><button class="btn secondary" id="submitServiceLogBtn" type="button" data-action="submit-service-log">Submit Routine Service Log</button></div></div><div id="scanOutput"></div></section><section class="card soft scan-guidance"><h3>Field capture rules</h3><p class="subtitle">Maintenance users can only service assigned sites. BOQ upload and baseline editing stay with supervisors and admins.</p><div class="proof-stack"><div class="ticket-card"><div class="ticket-head"><strong>1. BOQ bucket</strong><span class="pill good">Required</span></div><p class="small muted">Map work to a floor and placement bucket. Active BOQ lines prefill category and expected counts where available.</p></div><div class="ticket-card"><div class="ticket-head"><strong>2. Camera proof</strong><span class="pill critical">Required</span></div><p class="small muted">Capture a live or phone-camera plant photo. AI rejection of non-plant images blocks online submission.</p></div><div class="ticket-card"><div class="ticket-head"><strong>3. Offline sync</strong><span class="pill monitor">${escapeHtml(onlineLabel)}</span></div><p class="small muted">Offline submissions are stored locally for 24-48 hours and appear in supervisor sync monitor until synced.</p></div></div></section></div>`;
}
function scanImageMarkup() { return state.scanImage ? `<div class="image-ready" style="margin-top:12px"><span class="pill good">Plant image ready</span><span class="pill">${escapeHtml(state.scanCaptureSource || "phone_camera")}</span></div><img src="${state.scanImage}" class="preview" alt="Plant preview" />` : `<div class="small muted" style="margin-top:12px">No camera proof captured yet.</div>`; }
function syncScanDraftFromDom() { const panel = document.querySelector("#scanPanel"); if (!panel) return; const next = { ...state.scanDraft }; panel.querySelectorAll("[data-scan-field]").forEach(el => { next[el.dataset.scanField] = el.value || ""; }); state.scanDraft = next; }
function updateScanImageUi() { const box = document.querySelector("#scanImageState"); if (box) box.innerHTML = scanImageMarkup(); const btn = document.querySelector("#runDiagnosisBtn"); if (btn) { btn.disabled = !state.scanImage; btn.classList.toggle("secondary", !state.scanImage); } const removeBtn = document.querySelector('[data-action="clear-scan-image"]'); if (removeBtn) removeBtn.classList.toggle("hidden", !state.scanImage); }
function normalizeHealthScore(value, fallback = 5) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const score = n > 10 && n <= 100 ? n / 10 : n;
  return Math.max(1, Math.min(10, Number(score.toFixed(1))));
}
function healthScoreLabel(value) {
  const score = normalizeHealthScore(value);
  return `${Number.isInteger(score) ? score : score.toFixed(1)}/10`;
}
function confidenceValue(data = {}) {
  const raw = data.plant_identification_confidence ?? data.identification_confidence ?? data.confidence;
  const value = Number(raw);
  if (Number.isFinite(value)) return value > 1 ? Math.min(1, value / 100) : Math.max(0, Math.min(1, value));
  return 0.65;
}
function confidenceLabel(data = {}) { return `${Math.round(confidenceValue(data) * 100)}%`; }
function confidenceClass(data = {}) { const v = confidenceValue(data); return v >= 0.82 ? "good" : v >= 0.65 ? "monitor" : "critical"; }
function possibleMatchesMarkup(data = {}) {
  const matches = Array.isArray(data.possible_matches) ? data.possible_matches.slice(0, 3) : [];
  return matches.length ? `<div class="match-list"><span class="small muted">Possible variety matches · confidence only</span>${matches.map(m => `<span class="pill">${escapeHtml(typeof m === "string" ? m : `${m.name || "Option"}${m.confidence ? ` · ${Math.round(confidenceValue({ confidence: m.confidence }) * 100)}%` : ""}`)}</span>`).join("")}</div>` : "";
}


function currentEfficiencyModel() {
  const { db } = dbx();
  const records = visibleRecords();
  return buildEfficiencyModel({ db, scans: records.scans, tickets: records.tickets, filters: state.filters, sites: allowedSites(db) });
}
function efficiencyView() {
  const model = currentEfficiencyModel();
  const active = state.efficiencyFilter || "action";
  return `<section class="card efficiency-panel"><div class="card-title"><div><h3>Efficiency Intelligence</h3><p class="subtitle">Derived from scans, tickets, SLA state, activity logs, and closure evidence. Every metric links back to source work items.</p></div></div>${filterPanel()}<div class="efficiency-grid">${model.cards.map(card => efficiencyCard(card, active)).join("")}</div><div style="height:16px"></div>${efficiencyWorkItems(model, active)}</section>`;
}
function efficiencyCard(card, active) {
  return `<button class="efficiency-card ${active === card.key ? "active" : ""}" type="button" data-efficiency-filter="${card.key}"><span>${escapeHtml(card.label)}</span><strong class="${card.status}">${escapeHtml(card.value)}</strong><small>${escapeHtml(card.sub)}</small></button>`;
}
function clientServiceAssurance(scans, tickets) {
  const model = currentEfficiencyModel();
  const freshnessValue = model.freshness.latestScan ? model.cards.find(c => c.key === "freshness")?.value || "—" : "—";
  const actionActive = state.clientAssuranceFilter === "action";
  return `<div class="service-assurance"><div class="service-assurance-title"><h3>Service Assurance</h3><span class="small muted">Coverage, freshness, and dependencies</span></div><div class="assurance-grid"><div class="assurance-card"><span>Scan Coverage</span><strong>${model.coverage.pct}%</strong><small>${model.coverage.completed}/${model.coverage.expected} checks completed</small></div><div class="assurance-card"><span>Last Checked</span><strong>${freshnessValue}</strong><small>Average freshness</small></div><button class="assurance-card clickable ${actionActive ? "active" : ""}" type="button" data-client-assurance-filter="action"><span>Action Required</span><strong>${model.action.count}</strong><small>Client / IFM input needed</small></button><div class="assurance-card"><span>Dependency Hold</span><strong>${model.blockers.count}</strong><small>Access / approval pending</small></div></div>${actionActive ? clientActionRequiredPanel(model.action.rows) : ""}</div>`;
}

function clientActionRequiredPanel(tickets = []) {
  return `<div class="client-action-panel"><div class="card-title"><div><h3>Action Required from Client / IFM</h3><p class="subtitle">Only work items where access, approval, or clarification is blocking closure.</p></div><span class="pill">${tickets.length} items</span></div><div class="table-wrap"><table><thead><tr><th>Ticket</th><th>Site / Zone</th><th>Action Required</th><th>Current Status</th></tr></thead><tbody>${tickets.map(t => { const s = slaState(t); return `<tr><td><strong>${escapeHtml(t.issue || normalizeIssueType(t))}</strong><br><span class="small muted">#${escapeHtml(efficiencyTicketNo(t))} · ${fmtDate(t.createdAt)}</span></td><td>${escapeHtml(t.site?.name)}<br><span class="small muted">${escapeHtml(zoneOf(t))}</span></td><td>${escapeHtml(t.actionRequiredNote || t.blockerReason || "Client / IFM input needed")}</td><td><span class="pill ${s.paused ? "monitor" : s.breached ? "critical" : "good"}">${escapeHtml(s.paused ? "Dependency Hold" : s.label)}</span><br><span class="small muted">${escapeHtml(t.status || "Open")}</span></td></tr>`; }).join("") || `<tr><td colspan="4"><div class="empty">No action required from your side.</div></td></tr>`}</tbody></table></div></div>`;
}
function efficiencyWorkItems(model, active) {
  if (active === "coverage") return coverageTable(model.coverage.rows);
  if (active === "freshness") return freshnessTable(model.freshness.rows);
  if (active === "avoided") return ticketsTable("Resolved Without FM Intervention", model.avoided.rows, "No FM/client activity before closure.");
  if (active === "recurring") return recurringTable(model.recurring.clusters);
  if (active === "reopen") return ticketsTable("Reopened / Repeat Closure Issues", model.reopen.rows, "Closed work that came back within the control window.");
  if (active === "action") return ticketsTable("Action Required from Client / IFM", model.action.rows, "Only tickets where client/IFM action is blocking closure.");
  if (active === "blockers") return ticketsTable("SLA Paused / Blocked Work Items", model.blockers.rows, "SLA is paused only when a dependency blocks execution.");
  if (active === "expert") return ticketsTable("Horticulture Expert Required", model.expert.rows, "L3 cases where routine field closure may not be enough.");
  return ticketsTable("Linked Work Items", [], "Select a metric above.");
}
function coverageTable(rows = []) {
  return `<div class="table-wrap"><table><thead><tr><th>Site</th><th>Zone</th><th>Expected</th><th>Completed</th><th>Coverage</th><th>Backlink Meaning</th></tr></thead><tbody>${rows.map(r => `<tr><td>${escapeHtml(r.site?.name)}</td><td>${escapeHtml(r.zone)}</td><td>${r.expected}</td><td>${r.completed}</td><td><span class="pill ${r.pct >= 85 ? "good" : r.pct >= 60 ? "monitor" : "critical"}">${r.pct}%</span></td><td><span class="small muted">Derived from scan records for this zone.</span></td></tr>`).join("") || `<tr><td colspan="6">No zones available.</td></tr>`}</tbody></table></div>`;
}
function freshnessTable(rows = []) {
  return `<div class="table-wrap"><table><thead><tr><th>Site</th><th>Zone</th><th>Last Checked</th><th>Status</th><th>Linked Scan</th></tr></thead><tbody>${rows.map(r => `<tr><td>${escapeHtml(r.site?.name)}</td><td>${escapeHtml(r.zone)}</td><td>${r.scan ? fmtDate(r.scan.createdAt) : "—"}</td><td><span class="pill ${r.status === "Fresh" ? "good" : r.status === "Acceptable" ? "monitor" : "critical"}">${escapeHtml(r.status)}</span></td><td>${r.scan ? `<span class="small muted">Scan ${escapeHtml(r.scan.id)}</span>` : `<span class="small muted">No scan record found</span>`}</td></tr>`).join("") || `<tr><td colspan="5">No zones available.</td></tr>`}</tbody></table></div>`;
}
function recurringTable(clusters = []) {
  return `<div class="table-wrap"><table><thead><tr><th>Pattern</th><th>Site / Zone</th><th>Count</th><th>Linked Tickets</th><th>Suggested Action</th></tr></thead><tbody>${clusters.map(c => `<tr><td><strong>${escapeHtml(c.issueType)}</strong></td><td>${escapeHtml(c.site?.name)}<br><span class="small muted">${escapeHtml(c.zone)}</span></td><td><span class="pill monitor">${c.count}</span></td><td>${c.relatedTickets.map(t => `<span class="pill">#${escapeHtml(efficiencyTicketNo(t))}</span>`).join(" ")}</td><td>${escapeHtml(c.suggestion)}</td></tr>`).join("") || `<tr><td colspan="5"><div class="empty">No recurring issue pattern for the selected filters.</div></td></tr>`}</tbody></table></div>`;
}
function ticketsTable(titleText, tickets = [], emptyText = "No linked work items.") {
  return `<div class="card soft linked-work-card"><div class="card-title"><div><h3>${escapeHtml(titleText)}</h3><p class="subtitle">Clicking cards above filters this table to the exact source work items.</p></div><span class="pill">${tickets.length} items</span></div><div class="table-wrap"><table><thead><tr><th>Ticket</th><th>Site / Zone</th><th>Status</th><th>SLA / Blocker</th><th>Source Link</th></tr></thead><tbody>${tickets.map(t => { const s = slaState(t); return `<tr><td><strong>${escapeHtml(t.issue || normalizeIssueType(t))}</strong><br><span class="small muted">#${escapeHtml(efficiencyTicketNo(t))} · ${fmtDate(t.createdAt)}</span></td><td>${escapeHtml(t.site?.name)}<br><span class="small muted">${escapeHtml(zoneOf(t))}</span></td><td><span class="pill ${t.status === STATUS.CLOSED ? "closed" : t.status === STATUS.IN_PROGRESS ? "progress" : t.status === STATUS.PAUSED ? "monitor" : "open"}">${escapeHtml(t.status)}</span>${t.expertRequired ? `<br><span class="pill monitor">L3 Expert</span>` : ""}</td><td><span class="pill ${s.paused ? "monitor" : s.breached ? "critical" : "good"}">${escapeHtml(s.label)}</span><br><span class="small muted">${escapeHtml(t.blockerReason || t.actionRequiredNote || t.expertReason || `Age ${s.ageLabel}`)}</span></td><td><span class="small muted">Source: ${escapeHtml(t.source || "Ticket")}</span><br><span class="small muted">Plant/scan: ${escapeHtml(t.plantId || t.linkedScanId || "general")}</span></td></tr>`; }).join("") || `<tr><td colspan="5"><div class="empty">${escapeHtml(emptyText)}</div></td></tr>`}</tbody></table></div></div>`;
}

function executiveSnapshot(scans, tickets, audience = "Leadership") {
  const hs = healthSummary(scans);
  const open = tickets.filter(t => t.status !== STATUS.CLOSED);
  const closed = tickets.filter(t => t.status === STATUS.CLOSED);
  const breached = open.filter(t => slaState(t).breached);
  const verified = closed.filter(t => t.closureEvidenceVerified || t.closureEvidence);
  const coverage = scans.length;
  const valueLine = audience === "Client"
    ? "Site visibility over health, issues, SLA movement, and closure evidence."
    : "Operational proof that green assets can be measured, tracked, and reported.";
  return `<section class="executive-snapshot"><div class="snapshot-copy"><span class="eyebrow dark">${escapeHtml(audience)} Snapshot</span><h3>Green asset visibility, not manual guesswork.</h3><p>${valueLine}</p></div><div class="snapshot-metrics"><div><span>Scans</span><strong>${coverage}</strong></div><div><span>Avg score</span><strong>${hs.avg || "—"}</strong></div><div><span>Open issues</span><strong>${open.length}</strong></div><div><span>SLA risk</span><strong>${breached.length}</strong></div><div><span>Verified closures</span><strong>${verified.length}</strong></div></div></section>`;
}
function proofOutcomeGrid(scans, tickets) {
  const hs = healthSummary(scans);
  const open = tickets.filter(t => t.status !== STATUS.CLOSED).length;
  const closed = tickets.filter(t => t.status === STATUS.CLOSED).length;
  return `<div class="proof-outcomes"><div><span>Baseline created</span><strong>${hs.total ? "Yes" : "Pending"}</strong><small>${hs.total} plant / zone records</small></div><div><span>Issue visibility</span><strong>${open}</strong><small>Open accountable work items</small></div><div><span>Evidence trail</span><strong>${closed}</strong><small>Closed items retained for reporting</small></div></div>`;
}

function canManageSite(siteId) {
  return isOwner() || allowedSiteIds().includes(siteId);
}
function selectedBoqSite() {
  const sites = allowedSites();
  const selected = state.boqDraft.siteId || sites[0]?.id || "";
  if (!state.boqDraft.siteId && selected) state.boqDraft.siteId = selected;
  return selected;
}
function boqTemplateCsv(site) {
  const client = getDb().clients.find(c => c.id === site?.clientId);
  return [
    "Client Name,Site Name,Floor / Area,Placement Bucket,Plant Category,Quantity,Water per Service,Watering Frequency,Maintenance Frequency,Plant Species,Planter Type,Ownership Type,Install Date,Notes",
    `${client?.name || "Client"},${site?.name || "Site"},Ground Floor,Reception / Lobby,Medium Indoor,12,300,3,4,Areca Palm,Ceramic,Client-owned,2026-05-01,Main lobby baseline`
  ].join("\n");
}
function previewBoqDraft() {
  const rows = parseBoqCsvOrSheet(state.boqDraft.csv);
  const validation = validateBoqRows(rows);
  state.boqDraft.rows = rows;
  state.boqDraft.acceptedRows = validation.acceptedRows;
  state.boqDraft.rejectedRows = validation.rejectedRows;
  return validation;
}
function saveBoqDraft({ activate = false } = {}) {
  const siteId = selectedBoqSite();
  if (!siteId || !canManageSite(siteId)) throw new Error("Select an assigned site for BOQ upload.");
  const validation = previewBoqDraft();
  if (!validation.acceptedRows.length) throw new Error("No accepted BOQ rows to save.");
  if (activate && validation.rejectedRows.length) throw new Error("Resolve rejected BOQ rows before activating the baseline.");
  const db = getDb();
  const result = applyBoqRowsToDb(db, state.boqDraft.rows, currentUser()?.id || "system", siteId);
  result.upload.fileName = state.boqDraft.fileName || "Pasted CSV";
  setDb(result.db);
  if (activate) activateBoqUpload(result.upload.id);
  state.boqDraft.lastUploadId = result.upload.id;
  return result;
}
function activateBoqUpload(uploadId) {
  const upload = getDb().boqUploads.find(item => item.id === uploadId);
  if (!upload || !canManageSite(upload.siteId)) throw new Error("BOQ upload is not available for your assigned sites.");
  tx(d => {
    (d.boqUploads || []).forEach(item => {
      if (item.siteId === upload.siteId && item.status === "active") item.status = "archived";
      if (item.id === uploadId) item.status = "active";
    });
    (d.boqLines || []).forEach(line => {
      if (line.siteId === upload.siteId) {
        line.active = line.sourceUploadId === uploadId;
        line.updatedAt = nowIso();
      }
    });
    return d;
  });
}
function archiveBoqUpload(uploadId) {
  const upload = getDb().boqUploads.find(item => item.id === uploadId);
  if (!upload || !isOwner()) throw new Error("Only admin can archive BOQ versions.");
  tx(d => {
    const item = (d.boqUploads || []).find(row => row.id === uploadId);
    if (item) item.status = "archived";
    (d.boqLines || []).filter(line => line.sourceUploadId === uploadId).forEach(line => { line.active = false; line.updatedAt = nowIso(); });
    return d;
  });
}
function boqPreviewTable() {
  const accepted = state.boqDraft.acceptedRows || [];
  const rejected = state.boqDraft.rejectedRows || [];
  if (!accepted.length && !rejected.length) return `<div class="empty">Paste or upload CSV, then preview rows.</div>`;
  const rows = [...accepted.map(row => ({ ...row, status: "Accepted" })), ...rejected.map(row => ({ ...row, status: "Rejected" }))];
  return `<div class="table-wrap"><table class="baseline-table"><thead><tr><th>Status</th><th>Floor</th><th>Bucket</th><th>Category</th><th>Qty</th><th>Water</th><th>Maintenance</th><th>Errors</th></tr></thead><tbody>${rows.slice(0, 30).map(row => `<tr><td><span class="pill ${row.status === "Accepted" ? "good" : "critical"}">${row.status}</span></td><td>${escapeHtml(row.floor)}</td><td>${escapeHtml(row.placementBucket)}</td><td>${escapeHtml(PLANT_CATEGORIES.find(c => c.id === row.plantCategory)?.label || row.plantCategory)}</td><td>${row.quantity}</td><td>${row.waterPerServiceMl} ml</td><td>${row.maintenanceFrequencyPerMonth}/mo</td><td>${escapeHtml((row.errors || []).join("; "))}</td></tr>`).join("")}</tbody></table></div><p class="footer-note">${accepted.length} accepted row(s), ${rejected.length} rejected row(s). Correct rejected rows before activation.</p>`;
}
function boqUploadHistory(siteId) {
  const { db, siteMap } = dbx();
  const uploads = (db.boqUploads || []).filter(upload => upload.siteId === siteId || (isOwner() && !siteId)).sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
  return `<div class="table-wrap"><table class="baseline-table"><thead><tr><th>Site</th><th>Version</th><th>Status</th><th>Rows</th><th>Uploaded</th><th>Actions</th></tr></thead><tbody>${uploads.map(upload => `<tr><td>${escapeHtml(siteMap[upload.siteId]?.name || upload.siteId)}</td><td>v${upload.version}</td><td><span class="pill ${upload.status === "active" ? "good" : upload.status === "archived" ? "closed" : "monitor"}">${escapeHtml(upload.status)}</span></td><td>${upload.acceptedRows}/${upload.rowCount}</td><td>${fmtDate(upload.uploadedAt)}</td><td><div class="actions">${upload.status !== "active" ? `<button class="mini-btn" data-action="activate-boq" data-id="${upload.id}">Activate</button>` : ""}${isOwner() && upload.status !== "archived" ? `<button class="mini-btn danger" data-action="archive-boq" data-id="${upload.id}">Archive</button>` : ""}</div></td></tr>`).join("") || `<tr><td colspan="6"><div class="empty">No BOQ uploads yet.</div></td></tr>`}</tbody></table></div>`;
}
function activeBaselineTable(siteId) {
  const lines = baselineForSite(getDb(), siteId);
  return `<div class="table-wrap"><table class="baseline-table"><thead><tr><th>Floor</th><th>Bucket</th><th>Category</th><th>Species</th><th>Qty</th><th>Water/Service</th><th>Service Freq</th></tr></thead><tbody>${lines.map(line => `<tr><td>${escapeHtml(line.floor)}</td><td>${escapeHtml(line.placementBucket)}</td><td>${escapeHtml(PLANT_CATEGORIES.find(c => c.id === line.plantCategory)?.label || line.plantCategory)}</td><td>${escapeHtml(line.plantSpecies || "Mapped category")}</td><td>${line.quantity}</td><td>${line.waterPerServiceMl} ml</td><td>${line.maintenanceFrequencyPerMonth}/mo</td></tr>`).join("") || `<tr><td colspan="7"><div class="empty">No active baseline for this site.</div></td></tr>`}</tbody></table></div>`;
}
function boqSetupView() {
  const sites = allowedSites();
  const siteId = selectedBoqSite();
  const site = getDb().sites.find(s => s.id === siteId);
  const template = boqTemplateCsv(site);
  return `<section class="card boq-upload-panel"><div class="card-title"><div><h3>BOQ Setup</h3><p class="subtitle">${isOwner() ? "Admin global baseline control across all sites." : "Supervisor BOQ upload and baseline activation for assigned sites only."}</p></div><span class="pill monitor">Draft -> Active -> Archived</span></div><div class="grid grid-2"><div class="field"><label>Site</label><select class="select" data-boq-site>${sites.map(s => option(s.id, `${s.city} · ${s.name}`, siteId === s.id)).join("")}</select></div><div class="field"><label>CSV upload</label><label class="mini-btn">Upload CSV<input class="hidden" type="file" accept=".csv,text/csv" data-boq-file /></label></div></div><div class="field"><label>Paste BOQ CSV</label><textarea class="textarea" data-boq-csv placeholder="${escapeHtml(template)}">${escapeHtml(state.boqDraft.csv)}</textarea></div><div class="btn-row" style="justify-content:flex-start"><button class="btn secondary" data-action="preview-boq">Preview Rows</button><button class="btn secondary" data-action="save-boq-draft">Save Draft</button><button class="btn" data-action="save-activate-boq">Save and Activate Baseline</button><button class="mini-btn" data-action="insert-boq-template">Insert Template</button></div><div style="height:16px"></div>${boqPreviewTable()}<div style="height:16px"></div><div class="grid grid-2"><section class="card soft"><h3>Active Baseline</h3>${activeBaselineTable(siteId)}</section><section class="card soft"><h3>Upload History</h3>${boqUploadHistory(siteId)}</section></div><p class="footer-note">Accepted buckets: ${PLACEMENT_BUCKETS.join(", ")}. Accepted categories: ${PLANT_CATEGORIES.map(c => c.label).join(", ")}.</p></section>`;
}
function baselineActualRows() {
  const db = getDb();
  const allowed = new Set(allowedSiteIds(db));
  const matchSite = site => allowed.has(site.id) &&
    (state.filters.siteId === "all" || site.id === state.filters.siteId) &&
    (state.filters.city === "all" || site.city === state.filters.city) &&
    (state.filters.clientId === "all" || site.clientId === state.filters.clientId);
  return db.sites.filter(matchSite).flatMap(site => {
    const lines = baselineForSite(db, site.id);
    const grouped = {};
    lines.forEach(line => {
      const key = `${line.floor}::${line.placementBucket}`;
      const row = grouped[key] ||= { site, floor: line.floor, placementBucket: line.placementBucket, lines: [], expectedPlants: 0, expectedWaterMl: 0, expectedServiceEvents: 0 };
      row.lines.push(line);
      row.expectedPlants += Number(line.quantity || 0);
      row.expectedWaterMl += expectedWaterForBaseline([line]) * 4.345;
      row.expectedServiceEvents += expectedServiceEventsForBaseline([line], "month");
    });
    const logs = (db.serviceLogs || []).filter(log => {
      const date = String(log.serverCreatedAt || log.localCreatedAt || "").slice(0, 10);
      return log.siteId === site.id && (!state.filters.from || date >= state.filters.from) && (!state.filters.to || date <= state.filters.to);
    });
    return Object.values(grouped).map(row => {
      const matchingLogs = logs.filter(log => log.floor === row.floor && log.placementBucket === row.placementBucket);
      const actualPlants = matchingLogs.reduce((sum, log) => sum + Number(log.plantsServicedCount || 0), 0);
      const actualWaterMl = matchingLogs.reduce((sum, log) => {
        if (!log.wateringDone) return sum;
        const line = row.lines.find(item => item.id === log.boqLineId) || row.lines[0];
        return sum + Number(log.wateredPlantCount || log.plantsServicedCount || 0) * Number(line?.waterPerServiceMl || 0);
      }, 0);
      const replacements = matchingLogs.reduce((sum, log) => sum + Number(log.replacementsCount || 0), 0);
      const coverage = Math.min(100, Math.round((actualPlants / Math.max(1, row.expectedPlants)) * 100));
      const waterVariance = row.expectedWaterMl ? Math.round(((actualWaterMl - row.expectedWaterMl) / row.expectedWaterMl) * 100) : 0;
      return {
        ...row,
        actualPlants,
        actualWaterMl,
        replacements,
        replacementRate: Math.round((replacements / Math.max(1, row.expectedPlants)) * 100),
        coverage,
        waterVariance,
        risk: !matchingLogs.length ? "Missed bucket" : coverage < 60 ? "Low coverage" : waterVariance > 30 ? "Water variance" : "On track"
      };
    });
  });
}
function baselineView() {
  const rows = baselineActualRows();
  const expectedPlants = rows.reduce((sum, row) => sum + row.expectedPlants, 0);
  const actualPlants = rows.reduce((sum, row) => sum + row.actualPlants, 0);
  const expectedWater = rows.reduce((sum, row) => sum + row.expectedWaterMl, 0) / 1000;
  const actualWater = rows.reduce((sum, row) => sum + row.actualWaterMl, 0) / 1000;
  const missed = rows.filter(row => row.risk === "Missed bucket").length;
  return `<section class="card"><div class="card-title"><div><h3>Baseline vs Actual</h3><p class="subtitle">Compares active BOQ baseline against structured service logs from the maintenance window.</p></div><span class="pill ${missed ? "critical" : "good"}">${missed} missed bucket(s)</span></div>${filterPanel()}<div class="kpi-strip"><div class="metric"><span>Expected Plants</span><strong>${expectedPlants}</strong></div><div class="metric good"><span>Actual Serviced</span><strong>${actualPlants}</strong></div><div class="metric monitor"><span>Expected Water</span><strong>${expectedWater.toFixed(1)} L</strong></div><div class="metric critical"><span>Actual Water</span><strong>${actualWater.toFixed(1)} L</strong></div></div><div class="table-wrap"><table class="baseline-table"><thead><tr><th>Site / Bucket</th><th>Expected Plants</th><th>Actual Serviced</th><th>Coverage</th><th>Expected Water</th><th>Actual Water</th><th>Replacements</th><th>Risk</th></tr></thead><tbody>${rows.map(row => `<tr><td><strong>${escapeHtml(row.site.name)}</strong><br><span class="small muted">${escapeHtml(row.floor)} · ${escapeHtml(row.placementBucket)}</span></td><td>${row.expectedPlants}</td><td>${row.actualPlants}</td><td><span class="pill ${row.coverage >= 80 ? "good" : row.coverage >= 50 ? "monitor" : "critical"}">${row.coverage}%</span></td><td>${(row.expectedWaterMl / 1000).toFixed(1)} L</td><td>${(row.actualWaterMl / 1000).toFixed(1)} L<br><span class="small muted">${row.waterVariance}% variance</span></td><td>${row.replacements}<br><span class="small muted">${row.replacementRate}% rate</span></td><td><span class="pill ${row.risk === "On track" ? "good" : row.risk === "Missed bucket" ? "critical" : "monitor"}">${escapeHtml(row.risk)}</span></td></tr>`).join("") || `<tr><td colspan="8"><div class="empty">No active BOQ baseline for the selected scope.</div></td></tr>`}</tbody></table></div></section>`;
}
function syncMonitorRows() {
  const db = getDb();
  const userMap = Object.fromEntries((db.users || []).map(user => [user.id, user]));
  const siteMap = Object.fromEntries((db.sites || []).map(site => [site.id, site]));
  const allowed = new Set(allowedSiteIds(db));
  const grouped = {};
  (db.serviceLogs || []).filter(log => allowed.has(log.siteId)).forEach(log => {
    const key = `${log.createdBy || "unknown"}::${log.siteId}`;
    const row = grouped[key] ||= { user: userMap[log.createdBy], site: siteMap[log.siteId], logs: [], pending: 0, failed: 0, gps: 0, aiPassed: 0, aiFailed: 0, lastSync: "" };
    row.logs.push(log);
    if (log.syncStatus === "pending") row.pending += 1;
    if (log.syncStatus === "failed") row.failed += 1;
    if (log.gpsLat && log.gpsLng) row.gps += 1;
    if (log.aiPlantDetected === true) row.aiPassed += 1;
    if (log.aiPlantDetected === false) row.aiFailed += 1;
    const syncTime = log.serverCreatedAt || log.localCreatedAt;
    if (!row.lastSync || new Date(syncTime) > new Date(row.lastSync)) row.lastSync = syncTime;
  });
  return Object.values(grouped);
}
function syncMonitorView() {
  const pending = getPendingOfflineRecords().filter(record => allowedSiteIds().includes(record.payload?.siteId));
  const rows = syncMonitorRows();
  return `<section class="card sync-status-card"><div class="card-title"><div><h3>Sync Monitor</h3><p class="subtitle">${isOwner() ? "All-site offline queue visibility." : "Assigned-site visibility for field team service logs."}</p></div><div class="btn-row"><span class="offline-badge">${navigator.onLine === false ? "Offline" : "Online"}</span><button class="btn secondary" data-action="sync-now">Sync Now</button></div></div><div class="kpi-strip"><div class="metric"><span>Pending queue</span><strong>${pending.length}</strong></div><div class="metric critical"><span>Failed logs</span><strong>${rows.reduce((sum, row) => sum + row.failed, 0)}</strong></div><div class="metric good"><span>GPS captured</span><strong>${rows.reduce((sum, row) => sum + row.gps, 0)}</strong></div><div class="metric monitor"><span>AI passed</span><strong>${rows.reduce((sum, row) => sum + row.aiPassed, 0)}</strong></div></div><div class="table-wrap"><table class="baseline-table"><thead><tr><th>Staff name</th><th>Site</th><th>Last sync time</th><th>Pending logs</th><th>Failed sync</th><th>GPS captured</th><th>AI validated</th></tr></thead><tbody>${rows.map(row => `<tr><td>${escapeHtml(row.user?.name || row.logs[0]?.createdBy || "Unknown")}</td><td>${escapeHtml(row.site?.name || "Unknown site")}</td><td>${fmtDate(row.lastSync)}</td><td><span class="pill ${row.pending ? "monitor" : "good"}">${row.pending}</span></td><td><span class="pill ${row.failed ? "critical" : "good"}">${row.failed}</span></td><td>${row.gps ? "Yes" : "No"}</td><td>${row.aiFailed ? "Failed" : row.aiPassed ? "Passed" : "Pending"}</td></tr>`).join("") || `<tr><td colspan="7"><div class="empty">No service logs yet.</div></td></tr>`}</tbody></table></div></section>`;
}
function clientSustainabilityTabVisible() {
  const db = getDb();
  const site = sustainabilityScopeSite();
  const clientId = site?.clientId || allowedClients(db)[0]?.id || "";
  return getClientEntitlement(db, clientId, site?.id || "").sustainabilityTabVisible !== false;
}
function sustainabilityScopeSite() {
  const sites = allowedSites();
  if (state.filters.siteId && state.filters.siteId !== "all") return sites.find(site => site.id === state.filters.siteId) || sites[0];
  return sites[0];
}
function sustainabilityEntitlement() {
  const site = sustainabilityScopeSite();
  const entitlement = getClientEntitlement(getDb(), site?.clientId || allowedClients()[0]?.id || "", site?.id || "");
  // Demo/platform rule: sustainability insights are part of the product, not a gated upsell.
  // Keep admin controls available elsewhere, but the main Sustainability window always shows data.
  return {
    ...entitlement,
    sustainabilityTabVisible: true,
    metricNamesVisible: true,
    metricValuesVisible: true,
    frameworkSwitcherEnabled: true,
    pdfExportEnabled: true,
    excelExportEnabled: true,
    historicalTrendsEnabled: true,
    trialExpired: false,
    subscriptionStatus: "active",
    planName: "sustainability"
  };
}
function formatDateInput(iso = "") {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso).slice(0, 10);
  return date.toISOString().slice(0, 10);
}
function dateIsoFromInput(value = "", endOfDay = false) {
  if (!value) return "";
  const suffix = endOfDay ? "T23:59:59" : "T00:00:00";
  const date = new Date(`${value}${suffix}`);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}
function entitlementContext() {
  const db = getDb();
  const clients = allowedClients(db);
  const clientId = state.entitlementClientId || clients[0]?.id || "";
  if (!state.entitlementClientId && clientId) state.entitlementClientId = clientId;
  const sites = allowedSites(db).filter(site => site.clientId === clientId);
  const siteId = sites.some(site => site.id === state.entitlementSiteId) ? state.entitlementSiteId : sites[0]?.id || "";
  if (state.entitlementSiteId !== siteId) state.entitlementSiteId = siteId;
  const site = sites.find(item => item.id === siteId) || null;
  const client = clients.find(item => item.id === clientId) || null;
  const entitlement = getClientEntitlement(db, clientId, siteId);
  return { db, clients, clientId, sites, siteId, site, client, entitlement };
}
function accessStatusLabel(entitlement) {
  if (entitlement.subscriptionStatus === "expired" || entitlement.trialExpired) return "EXPIRED";
  if (entitlement.subscriptionStatus === "active") return "PAID ACTIVE";
  if (entitlement.subscriptionStatus === "trial" && isTrialActive(entitlement)) return "TRIAL ACTIVE";
  if (entitlement.subscriptionStatus === "trial") return "TRIAL INACTIVE";
  return "CORE";
}
function accessStateCards(entitlement) {
  const trialText = isTrialActive(entitlement) ? `Active until ${formatDateInput(entitlement.trialEndDate)}` : "Not active";
  return `<div class="kpi-strip"><div class="metric"><span>Current Status</span><strong>${escapeHtml(accessStatusLabel(entitlement))}</strong></div><div class="metric ${canViewMetricValues(entitlement) ? "good" : "monitor"}"><span>Metric Values</span><strong>${canViewMetricValues(entitlement) ? "Visible" : "Locked"}</strong></div><div class="metric ${canUseFrameworkSwitcher(entitlement) ? "good" : "monitor"}"><span>Framework Switcher</span><strong>${canUseFrameworkSwitcher(entitlement) ? "Enabled" : "Locked"}</strong></div><div class="metric"><span>Trial</span><strong>${escapeHtml(trialText)}</strong></div></div>`;
}
const SUSTAINABILITY_SECTIONS = [
  { title: "Resource Use", subtitle: "Water estimates and routine watering discipline.", metricIds: ["estimated_water_use", "watering_compliance"] },
  { title: "Green Asset Performance", subtitle: "Maintained asset health, survival, and replacement pressure.", metricIds: ["green_asset_health_score", "plant_survival_rate", "replacement_rate"] },
  { title: "Waste and Circularity", subtitle: "Green waste estimates and routed disposal evidence.", metricIds: ["estimated_green_waste", "waste_disposal_route"] },
  { title: "Safer Operations", subtitle: "Chemical-light maintenance and safety-relevant field observations.", metricIds: ["chemical_free_maintenance_pct", "safety_issues"] },
  { title: "Service Governance", subtitle: "Closure discipline, repeat issues, and vendor service activity.", metricIds: ["issue_closure_rate", "repeat_issue_rate", "vendor_visit_count", "vendor_travel_estimate"] }
];
const SUMMARY_METRIC_IDS = ["green_asset_health_score", "estimated_water_use", "plant_survival_rate", "waste_disposal_route", "chemical_free_maintenance_pct", "issue_closure_rate"];
const METRIC_ICONS = {
  estimated_water_use: "H2O",
  watering_compliance: "%",
  plant_survival_rate: "PS",
  replacement_rate: "RR",
  estimated_green_waste: "GW",
  waste_disposal_route: "WR",
  chemical_free_maintenance_pct: "CF",
  vendor_visit_count: "VV",
  vendor_travel_estimate: "KM",
  green_asset_health_score: "HS",
  issue_closure_rate: "IC",
  repeat_issue_rate: "RI",
  safety_issues: "SI"
};
function selectedFrameworkLabel(framework = state.sustainabilityFramework) {
  return FRAMEWORKS.find(item => item.id === framework)?.label || "BRSR";
}
function frameworkSwitcher(entitlement) {
  if (!canUseFrameworkSwitcher(entitlement)) return `<span class="metric-value-locked">Framework switcher locked</span>`;
  return `<div class="framework-switcher" aria-label="Framework switcher">${FRAMEWORKS.map(fw => `<button class="framework-pill ${state.sustainabilityFramework === fw.id ? "active" : ""}" data-framework="${fw.id}">${escapeHtml(fw.label)}</button>`).join("")}</div>`;
}
function sustainabilityValue(metric, showValues) {
  return showValues ? `<strong>${escapeHtml(metric.formattedValue)}</strong>` : `<strong class="metric-value-locked">Locked</strong>`;
}
function metricNumericValue(metric) {
  const n = Number(metric?.value || 0);
  return Number.isFinite(n) ? n : 0;
}
function progressPct(metric) {
  if (metric?.unit === "%") return Math.max(0, Math.min(100, metricNumericValue(metric)));
  if (metric?.unit === "/100") return Math.max(0, Math.min(100, metricNumericValue(metric)));
  return 0;
}
function sustainabilityAccessNotice(entitlement) {
  return `<div class="btn-row" style="justify-content:flex-start;margin:8px 0 14px"><span class="offline-badge">Sustainability data: Visible</span><span class="offline-badge">Framework switcher: Enabled</span><span class="offline-badge">Boundary: Horticulture operations only</span></div>`;
}
function sustainabilityToolbar(entitlement) {
  return `<div class="sustainability-toolbar"><div><span class="eyebrow dark">Reporting lens</span><p class="subtitle">Switch the evidence view without changing source data.</p></div><div class="sustainability-toolbar-actions">${frameworkSwitcher(entitlement)}${canExportSustainabilityReport(entitlement) ? `<button class="mini-btn" data-action="download-sustainability">Export CSV</button><button class="mini-btn" data-action="download-sustainability">Export Report</button>` : `<span class="metric-value-locked">Exports locked</span>`}</div></div>`;
}
function metricCaption(metric) {
  const text = String(metric?.explanation || "");
  if (text.length <= 118) return text;
  return `${text.slice(0, 115).trim()}...`;
}
function summaryCard(metric, showValues) {
  if (!metric) return "";
  const pct = progressPct(metric);
  return `<article class="sustainability-summary-card ${showValues ? "" : "locked"}"><span>${escapeHtml(metric.name)}</span>${showValues ? `<strong>${escapeHtml(metric.formattedValue)}</strong>` : `<strong>Locked</strong>`}<small>${showValues ? `${escapeHtml(metric.dataQuality)} · Horticulture only` : "Unlock Sustainability Insights to view values"}</small>${pct ? `<div class="progress-bar"><i class="progress-fill" style="width:${pct}%"></i></div>` : `<div class="progress-bar muted"><i class="progress-fill" style="width:42%"></i></div>`}</article>`;
}
function sustainabilitySummary(metrics, showValues) {
  const byId = Object.fromEntries(metrics.map(metric => [metric.id, metric]));
  return `<div class="sustainability-summary-grid">${SUMMARY_METRIC_IDS.map(id => summaryCard(byId[id], showValues)).join("")}</div>`;
}
function metricEvidenceMarkup(metric) {
  const popup = metric.frameworkPopup || {};
  const coverage = popup.coverageStatus || metric.coverageStatus || "Supporting evidence";
  const support = popup.supports || metric.explanation || "Operational sustainability signal from horticulture service data.";
  const method = metric.formula || metric.explanation || "Calculated from BOQ baseline, AI scans, service logs, and ticket activity.";
  const boundary = popup.boundary || "Indoor/maintained horticulture assets only";
  return `<div class="metric-evidence-grid"><div><span>Framework signal</span><strong>${escapeHtml(coverage)}</strong><p>${escapeHtml(support)}</p></div><div><span>Calculation method</span><strong>${escapeHtml(metric.dataQuality || "Calculated")}</strong><p>${escapeHtml(method)}</p></div></div><p class="metric-boundary-line">${escapeHtml(boundary)}</p>`;
}
function metricCard(metric, showValues, showNames) {
  const label = showNames ? (metric.frameworkLabel || metric.name) : metric.name;
  const pct = progressPct(metric);
  const icon = METRIC_ICONS[metric.id] || "ESG";
  return `<article class="sustainability-kpi-card"><div class="sustainability-kpi-top"><span class="sustainability-kpi-icon">${escapeHtml(icon)}</span><h4>${escapeHtml(label)}</h4><span class="coverage-chip">${escapeHtml(metric.coverageStatus)}</span></div><div class="metric-value"><strong>${escapeHtml(metric.formattedValue)}</strong>${metric.unit && metric.unit !== "/100" && !String(metric.formattedValue).includes(metric.unit) ? `<span class="metric-unit">${escapeHtml(metric.unit)}</span>` : ""}</div><p class="metric-subtitle">${escapeHtml(metric.unit === "%" || metric.unit === "/100" ? "Current selected period" : "This selected reporting period")}</p>${pct ? `<div class="progress-bar"><i class="progress-fill" style="width:${pct}%"></i></div>` : `<div class="sustainability-mini-bars"><i></i><i></i><i></i><i></i><i></i></div>`}<p class="metric-subtitle">${escapeHtml(metricCaption(metric))}</p><div class="sustainability-chip-row"><span class="data-quality-chip">${escapeHtml(metric.dataQuality)}</span><span class="data-quality-chip muted">Horticulture contribution only</span></div>${metricEvidenceMarkup(metric)}</article>`;
}
function sustainabilitySections(metrics, showValues, showNames) {
  const byId = Object.fromEntries(metrics.map(metric => [metric.id, metric]));
  return SUSTAINABILITY_SECTIONS.map(section => {
    const cards = section.metricIds.map(id => byId[id]).filter(Boolean).map(metric => metricCard(metric, showValues, showNames)).join("");
    return `<section class="sustainability-section"><div class="sustainability-section-header"><div><h3>${escapeHtml(section.title)}</h3><p>${escapeHtml(section.subtitle)}</p></div><span>${section.metricIds.filter(id => byId[id]).length} metrics</span></div><div class="sustainability-kpi-grid">${cards}</div></section>`;
  }).join("");
}
function sustainabilityFrameworkModal(metrics, framework) {
  if (!state.frameworkModalMetricId) return "";
  const metric = metrics.find(item => item.id === state.frameworkModalMetricId);
  if (!metric) return "";
  const popup = frameworkPopupForMetric(metric, framework);
  return `<div class="framework-modal" data-framework-backdrop><aside class="framework-drawer" role="dialog" aria-label="Framework relevance"><div class="sustainability-section-header"><div><h3>${escapeHtml(popup.metric)}</h3><p>${escapeHtml(popup.selectedFramework)} framework-aligned view</p></div><button class="mini-btn" type="button" data-framework-close>Close</button></div><dl><div><dt>Supports / contributes to</dt><dd>${escapeHtml(popup.supports)}</dd></div><div><dt>Contribution type</dt><dd>${escapeHtml(popup.contributionType || "Horticulture operations only")}</dd></div><div><dt>Coverage status</dt><dd>${escapeHtml(popup.coverageStatus)}</dd></div><div><dt>Data quality</dt><dd>${escapeHtml(popup.dataQuality)}</dd></div><div><dt>Formula used</dt><dd>${escapeHtml(popup.formula)}</dd></div><div><dt>Boundary</dt><dd>${escapeHtml(popup.boundary)}</dd></div><div><dt>Limitation</dt><dd>${escapeHtml(popup.limitation)}</dd></div></dl><p class="footer-note">This view covers horticulture operations and maintained green assets only. It does not represent the client's complete ESG disclosure or full framework compliance.</p></aside></div>`;
}
function sustainabilityView() {
  const db = getDb();
  const entitlement = sustainabilityEntitlement();
  if (entitlement.sustainabilityTabVisible === false) return `<section class="sustainability-dashboard"><h3>Sustainability / ESG Insights</h3><div class="empty">This module is not visible for the selected client/site.</div></section>`;
  const showValues = canViewMetricValues(entitlement);
  const showNames = entitlement.metricNamesVisible !== false;
  const framework = canUseFrameworkSwitcher(entitlement) ? state.sustainabilityFramework : "brsr";
  const metricsList = buildSustainabilityMetrics({ db, filters: roleFilter(db), period: { from: state.filters.from, to: state.filters.to } });
  const frameworkMetrics = buildFrameworkView(metricsList, framework).flatMap(group => group.items);
  return `<section class="sustainability-dashboard"><div class="sustainability-hero"><div><span class="eyebrow dark">Enterprise sustainability cockpit</span><h2>Sustainability / ESG Insights</h2><p>Horticulture contribution view across water, waste, plant health, service governance, vendor activity, and maintained green assets.</p></div><div class="access-status-card"><span>Data: Unlocked</span><span>Framework: ${escapeHtml(selectedFrameworkLabel(framework))}</span><span>Boundary: Horticulture only</span><span>Use case: ESG-lite operations evidence</span></div></div>${filterPanel({ client: false })}${sustainabilityToolbar(entitlement)}${sustainabilityAccessNotice(entitlement)}${sustainabilitySummary(frameworkMetrics, showValues)}<p class="footer-note">This view covers horticulture operations and maintained green assets only. It does not represent the client's complete ESG disclosure or full framework compliance.</p>${sustainabilitySections(frameworkMetrics, showValues, showNames)}${sustainabilityFrameworkModal(frameworkMetrics, framework)}</section>`;
}
function checked(value) {
  return value ? "checked" : "";
}
function checkboxTile(name, label, value) {
  return `<label class="ticket-card"><input type="checkbox" name="${name}" ${checked(value)} /> ${escapeHtml(label)}</label>`;
}
function sustainabilityAccessView() {
  const { db, clients, clientId, sites, siteId, site, client, entitlement } = entitlementContext();
  const assumptions = Object.assign({ defaultRoundTripKm: 30, vehicleKmFactor: 1 }, ...(db.formulaAssumptions || []));
  return `<section class="card"><div class="card-title"><div><h3>Sustainability Access</h3><p class="subtitle">Admin control for trials, paid access, metric values, framework switcher, exports, trends, and demo data.</p></div><span class="pill ${canViewMetricValues(entitlement) ? "good" : "monitor"}">${escapeHtml(accessStatusLabel(entitlement))}</span></div>${accessStateCards(entitlement)}<form class="form" id="sustainabilityAccessForm"><div class="grid grid-2"><div class="field"><label>Client</label><select class="select" data-entitlement-client name="clientId">${clients.map(c => option(c.id, c.name, clientId === c.id)).join("")}</select></div><div class="field"><label>Site</label><select class="select" data-entitlement-site name="siteId">${sites.map(s => option(s.id, `${s.city} · ${s.name}`, siteId === s.id)).join("")}</select></div></div><div class="grid grid-2"><div class="field"><label>Subscription status</label><select class="select" name="subscriptionStatus">${["core", "trial", "active", "expired"].map(status => option(status, title(status), (entitlement.subscriptionStatus || "core") === status)).join("")}</select></div><div class="field"><label>Plan name</label><select class="select" name="planName">${["core", "trial", "sustainability", "sustainability_pro"].map(plan => option(plan, title(plan.replaceAll("_", " ")), (entitlement.planName || "core") === plan)).join("")}</select></div></div><div class="grid grid-3">${checkboxTile("sustainabilityTabVisible", "Sustainability tab visible", entitlement.sustainabilityTabVisible !== false)}${checkboxTile("metricNamesVisible", "Metric names visible", entitlement.metricNamesVisible !== false)}${checkboxTile("metricValuesVisible", "Metric values visible", entitlement.metricValuesVisible)}${checkboxTile("trialEnabled", "Trial enabled", entitlement.trialEnabled)}${checkboxTile("frameworkSwitcherEnabled", "Framework switcher enabled", entitlement.frameworkSwitcherEnabled)}${checkboxTile("pdfExportEnabled", "PDF export enabled", entitlement.pdfExportEnabled)}${checkboxTile("excelExportEnabled", "Excel export enabled", entitlement.excelExportEnabled)}${checkboxTile("historicalTrendsEnabled", "Historical trends enabled", entitlement.historicalTrendsEnabled)}</div><div class="grid grid-3"><div class="field"><label>Trial days</label><select class="select" name="trialDays">${[30, 60].map(days => option(days, `${days} days`, Number(entitlement.trialDays || 30) === days)).join("")}</select></div><div class="field"><label>Trial start date</label><input class="input" type="date" name="trialStartDate" value="${escapeHtml(formatDateInput(entitlement.trialStartDate))}" /></div><div class="field"><label>Trial end date</label><input class="input" type="date" name="trialEndDate" value="${escapeHtml(formatDateInput(entitlement.trialEndDate))}" /></div></div><div class="grid grid-2"><div class="field"><label>Default vendor round trip km</label><input class="input" type="number" min="0" step="1" name="defaultRoundTripKm" value="${escapeHtml(assumptions.defaultRoundTripKm)}" /></div><div class="field"><label>Vehicle distance factor</label><input class="input" type="number" min="0" step="0.1" name="vehicleKmFactor" value="${escapeHtml(assumptions.vehicleKmFactor)}" /></div></div><div class="btn-row" style="justify-content:flex-start"><button class="btn" type="submit">Save Access Settings</button><button class="mini-btn" type="button" data-action="enable-trial-30">Enable 30-Day Trial</button><button class="mini-btn" type="button" data-action="enable-trial-60">Enable 60-Day Trial</button><button class="mini-btn" type="button" data-action="activate-paid-access">Activate Paid Access</button><button class="mini-btn danger" type="button" data-action="expire-sustainability-access">Expire Access</button><button class="mini-btn" type="button" data-action="reset-sustainability-core">Reset to Core</button><button class="mini-btn primary-capture" type="button" data-action="seed-sustainability-demo">Seed Demo Sustainability Data</button><button class="mini-btn" type="button" data-action="open-client-demo-view">Open Client Demo View</button></div></form><p class="footer-note">Target: ${escapeHtml(client?.name || "Client")} · ${escapeHtml(site?.name || "Site")}. This view covers horticulture operations and maintained green assets only. It does not represent the client's complete ESG disclosure or full framework compliance.</p></section>`;
}
function upsertSustainabilityEntitlement(siteId, patch = {}) {
  const db = getDb();
  const site = db.sites.find(s => s.id === siteId);
  if (!site || !isOwner()) throw new Error("Only admin can update sustainability access.");
  tx(d => {
    d.sustainabilityEntitlements ||= [];
    let entitlement = d.sustainabilityEntitlements.find(item => item.clientId === site.clientId && item.siteId === site.id);
    if (!entitlement) {
      entitlement = { ...defaultCoreEntitlement(site.clientId, site.id), id: uid("ent") };
      d.sustainabilityEntitlements.push(entitlement);
    }
    Object.assign(entitlement, patch, {
      clientId: site.clientId,
      siteId: site.id,
      updatedBy: currentUser()?.id || "owner",
      updatedAt: nowIso()
    });
    return d;
  });
}
function saveSustainabilityAccess(form) {
  const fd = new FormData(form);
  const siteId = fd.get("siteId");
  const db = getDb();
  const site = db.sites.find(s => s.id === siteId);
  if (!site || !isOwner()) throw new Error("Only admin can update sustainability access.");
  const subscriptionStatus = String(fd.get("subscriptionStatus") || "core");
  const trialEnabled = fd.has("trialEnabled") || subscriptionStatus === "trial";
  const trialDays = Number(fd.get("trialDays") || 30);
  const start = trialEnabled ? (dateIsoFromInput(fd.get("trialStartDate")) || nowIso()) : "";
  const endDate = trialEnabled ? (dateIsoFromInput(fd.get("trialEndDate"), true) || new Date(Date.now() + trialDays * 86400000).toISOString()) : "";
  const trialExpired = subscriptionStatus === "expired" || (trialEnabled && endDate && new Date(endDate) < new Date());
  tx(d => {
    d.sustainabilityEntitlements ||= [];
    let entitlement = d.sustainabilityEntitlements.find(item => item.clientId === site.clientId && item.siteId === site.id);
    if (!entitlement) {
      entitlement = { ...defaultCoreEntitlement(site.clientId, site.id), id: uid("ent") };
      d.sustainabilityEntitlements.push(entitlement);
    }
    Object.assign(entitlement, {
      sustainabilityTabVisible: fd.has("sustainabilityTabVisible"),
      metricNamesVisible: fd.has("metricNamesVisible"),
      metricValuesVisible: fd.has("metricValuesVisible"),
      trialEnabled,
      trialDays,
      trialStartDate: start,
      trialEndDate: endDate,
      trialExpired,
      frameworkSwitcherEnabled: fd.has("frameworkSwitcherEnabled"),
      pdfExportEnabled: fd.has("pdfExportEnabled"),
      excelExportEnabled: fd.has("excelExportEnabled"),
      historicalTrendsEnabled: fd.has("historicalTrendsEnabled"),
      planName: String(fd.get("planName") || "core"),
      subscriptionStatus,
      updatedBy: currentUser()?.id || "owner",
      updatedAt: nowIso()
    });
    d.formulaAssumptions ||= [];
    const assumptions = d.formulaAssumptions[0] || { id: "assumption-defaults" };
    Object.assign(assumptions, {
      defaultRoundTripKm: Number(fd.get("defaultRoundTripKm") || 30),
      vehicleKmFactor: Number(fd.get("vehicleKmFactor") || 1),
      wasteBoundary: "Maintained horticulture assets only",
      updatedAt: nowIso()
    });
    if (!d.formulaAssumptions.length) d.formulaAssumptions.push(assumptions);
    return d;
  });
}
function trialPatch(days) {
  return {
    sustainabilityTabVisible: true,
    metricNamesVisible: true,
    metricValuesVisible: true,
    trialEnabled: true,
    trialDays: days,
    trialStartDate: nowIso(),
    trialEndDate: new Date(Date.now() + days * 86400000).toISOString(),
    trialExpired: false,
    frameworkSwitcherEnabled: true,
    pdfExportEnabled: false,
    excelExportEnabled: false,
    historicalTrendsEnabled: true,
    planName: "trial",
    subscriptionStatus: "trial"
  };
}
function applySustainabilityPreset(kind) {
  const { siteId } = entitlementContext();
  if (!siteId) throw new Error("Select a site first.");
  if (kind === "trial30") upsertSustainabilityEntitlement(siteId, trialPatch(30));
  if (kind === "trial60") upsertSustainabilityEntitlement(siteId, trialPatch(60));
  if (kind === "active") upsertSustainabilityEntitlement(siteId, {
    sustainabilityTabVisible: true,
    metricNamesVisible: true,
    metricValuesVisible: true,
    trialEnabled: false,
    trialDays: 0,
    trialStartDate: "",
    trialEndDate: "",
    trialExpired: false,
    frameworkSwitcherEnabled: true,
    pdfExportEnabled: true,
    excelExportEnabled: true,
    historicalTrendsEnabled: true,
    planName: "sustainability",
    subscriptionStatus: "active"
  });
  if (kind === "expired") upsertSustainabilityEntitlement(siteId, {
    sustainabilityTabVisible: true,
    metricNamesVisible: true,
    metricValuesVisible: false,
    trialEnabled: false,
    trialExpired: true,
    frameworkSwitcherEnabled: false,
    pdfExportEnabled: false,
    excelExportEnabled: false,
    historicalTrendsEnabled: false,
    subscriptionStatus: "expired"
  });
  if (kind === "core") {
    const core = defaultCoreEntitlement(entitlementContext().clientId, siteId);
    delete core.id;
    delete core.clientId;
    delete core.siteId;
    upsertSustainabilityEntitlement(siteId, core);
  }
}
function demoIso(daysAgo = 0) {
  return new Date(Date.now() - daysAgo * 86400000).toISOString();
}
function seedDemoSustainabilityData() {
  const { siteId } = entitlementContext();
  if (!siteId || !isOwner()) throw new Error("Only admin can seed sustainability demo data.");
  tx(d => {
    d.boqLines ||= [];
    d.boqUploads ||= [];
    d.serviceLogs ||= [];
    d.scans ||= [];
    d.tickets ||= [];
    d.plants ||= [];
    d.vendorSiteProfiles ||= [];
    d.formulaAssumptions ||= [];
    const site = d.sites.find(s => s.id === siteId);
    if (!site) return d;
    const uploadId = `demo-sus-upload-${siteId}`;
    if (!d.boqUploads.some(upload => upload.id === uploadId)) {
      d.boqUploads.push({
        id: uploadId,
        siteId,
        fileName: "Demo Sustainability Baseline",
        uploadedBy: currentUser()?.id || "owner",
        uploadedAt: nowIso(),
        version: 1,
        rowCount: 1,
        acceptedRows: 1,
        rejectedRows: 0,
        status: "active",
        notes: "Demo baseline for Sustainability / ESG Insights."
      });
    }
    let line = (d.boqLines || []).find(item => item.id === `demo-sus-boq-${siteId}`) ||
      (d.boqLines || []).find(item => item.siteId === siteId && item.active);
    if (!line) {
      line = {
        id: `demo-sus-boq-${siteId}`,
        clientId: site.clientId,
        siteId,
        floor: "Ground Floor",
        placementBucket: "Reception / Lobby",
        plantCategory: "large",
        plantSpecies: "Mixed Indoor Green Assets",
        quantity: 50,
        waterPerServiceMl: 700,
        wateringFrequencyPerWeek: 3,
        maintenanceFrequencyPerMonth: 13,
        planterType: "Mixed planters",
        ownershipType: "Client-owned",
        installDate: demoIso(120).slice(0, 10),
        notes: "Demo baseline seeded for ESG showcase.",
        sourceUploadId: uploadId,
        active: true,
        version: 1,
        createdBy: currentUser()?.id || "owner",
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
      d.boqLines.push(line);
    } else {
      Object.assign(line, { active: true, sourceUploadId: line.sourceUploadId || uploadId, updatedAt: nowIso() });
    }
    const plantId = `demo-sus-plant-${siteId}`;
    if (!d.plants.some(plant => plant.id === plantId)) {
      d.plants.push({
        id: plantId,
        siteId,
        type: line.plantSpecies || "Mixed Indoor Green Assets",
        zone: line.placementBucket,
        latestScore: 8.6,
        latestCategory: "Healthy",
        createdAt: nowIso()
      });
    }
    const materialPattern = ["organic", "organic", "organic", "chemical", "organic", "organic", "mixed", "organic", "chemical", "organic", "organic", "chemical"];
    const issuePattern = ["other", "other", "water_leakage", "other", "other", "other", "ac_draft", "other", "other", "other", "other", "other"];
    Array.from({ length: 12 }).forEach((_, index) => {
      const id = `demo-sus-svc-${siteId}-${index + 1}`;
      if (d.serviceLogs.some(log => log.id === id)) return;
      const createdAt = demoIso(22 - index * 2);
      d.serviceLogs.push({
        id,
        tempId: `demo-sus-temp-${siteId}-${index + 1}`,
        clientId: site.clientId,
        siteId,
        floor: line.floor,
        placementBucket: line.placementBucket,
        boqLineId: line.id,
        plantCategory: line.plantCategory,
        actionType: index === 4 || index === 9 ? "replacement" : issuePattern[index] !== "other" ? "issue" : "routine_service",
        plantsServicedCount: 50,
        wateringDone: true,
        wateredPlantCount: 50,
        replacementsCount: index === 4 || index === 9 ? 1 : 0,
        deadPlantCount: index === 3 || index === 8 ? 1 : 0,
        materialUsed: materialPattern[index],
        materialName: materialPattern[index] === "organic" ? "Neem oil / compost" : materialPattern[index] === "chemical" ? "Pest control spot treatment" : "Mixed inputs",
        issueFound: issuePattern[index] !== "other",
        issueCategory: issuePattern[index],
        disposalRoute: index === 4 || index === 9 ? "composted" : index === 3 || index === 8 ? "reused" : "not_applicable",
        notes: "Demo sustainability service log.",
        voiceNoteText: "",
        photoDataUrl: "",
        aiPlantDetected: true,
        aiHealthScore: [8.8, 8.5, 8.7, 8.2, 8.6, 8.9, 8.4, 8.7, 8.3, 8.6, 8.8, 8.5][index],
        aiIssueFlags: issuePattern[index] !== "other" ? [issuePattern[index]] : [],
        gpsLat: "12.9716",
        gpsLng: "77.5946",
        gpsAccuracy: 28,
        gpsCapturedAt: createdAt,
        captureSource: "phone_camera",
        offlineCreated: false,
        localCreatedAt: createdAt,
        serverCreatedAt: createdAt,
        syncStatus: "synced",
        syncAttempts: 1,
        createdBy: "u-maint-1"
      });
    });
    [8.6, 8.8, 8.4, 8.7].forEach((score, index) => {
      const id = `demo-sus-scan-${siteId}-${index + 1}`;
      if (!d.scans.some(scan => scan.id === id)) {
        d.scans.push({
          id,
          plantId,
          siteId,
          score,
          category: "Healthy",
          diagnosis: "Demo healthy green asset condition.",
          rootCause: "Routine maintenance records indicate stable condition.",
          instructions: ["Continue scheduled maintenance"],
          image: "",
          createdAt: demoIso(28 - index * 7),
          createdBy: "u-maint-1",
          note: "Demo sustainability health score."
        });
      }
    });
    Array.from({ length: 16 }).forEach((_, index) => {
      const id = `demo-sus-ticket-${siteId}-${index + 1}`;
      if (d.tickets.some(ticket => ticket.id === id)) return;
      d.tickets.push({
        id,
        ticketNo: String(780000 + index),
        plantId,
        siteId,
        priority: index < 2 ? "P2" : "P3",
        status: index === 15 ? STATUS.OPEN : STATUS.CLOSED,
        source: "Demo Sustainability Seed",
        issueType: index < 2 ? "Recurring low light" : "Routine horticulture issue",
        issue: index < 2 ? "Repeat low light observation" : "Routine green asset service issue",
        description: "Demo ticket for sustainability issue metrics.",
        assignedTo: "Maintenance Staff",
        createdAt: demoIso(40 - index),
        startedAt: demoIso(39 - index),
        closedAt: index === 15 ? null : demoIso(38 - index),
        closureEvidence: "",
        closureRemark: index === 15 ? "" : "Closed through routine service.",
        closureEvidenceVerified: index !== 15,
        closureVerification: null,
        clientEvidence: "",
        reopenCount: index === 1 ? 1 : 0,
        createdBy: "demo"
      });
    });
    const vendorProfile = d.vendorSiteProfiles.find(profile => profile.siteId === siteId);
    if (vendorProfile) Object.assign(vendorProfile, { roundTripKm: 24, vehicleType: "two_wheeler", updatedAt: nowIso() });
    else d.vendorSiteProfiles.push({ id: `demo-vendor-${siteId}`, siteId, vendorName: "OneScape Demo Crew", roundTripKm: 24, vehicleType: "two_wheeler", updatedAt: nowIso() });
    const assumptions = d.formulaAssumptions[0] || { id: "assumption-defaults" };
    Object.assign(assumptions, { defaultRoundTripKm: 24, vehicleKmFactor: 1, wasteBoundary: "Maintained horticulture assets only", updatedAt: nowIso() });
    if (!d.formulaAssumptions.length) d.formulaAssumptions.push(assumptions);
    return d;
  });
}
function downloadSustainabilityCsv() {
  const metricsList = buildSustainabilityMetrics({ db: getDb(), filters: roleFilter(getDb()), period: { from: state.filters.from, to: state.filters.to } });
  const rows = metricsList.map(metric => ({
    Metric: metric.name,
    Value: metric.formattedValue,
    "Data Quality": metric.dataQuality,
    Boundary: metric.boundary,
    Formula: metric.formula
  }));
  const csv = "\uFEFF" + ["Metric,Value,Data Quality,Boundary,Formula", ...rows.map(row => Object.values(row).map(value => `"${String(value).replaceAll('"', '""')}"`).join(","))].join("\n");
  downloadFile(`GreenOps-Sustainability-${new Date().toISOString().slice(0, 10)}.csv`, csv, "text/csv;charset=utf-8");
}
function supervisorView() {
  const { scans, tickets } = visibleRecords();
  const hs = healthSummary(scans);
  const open = tickets.filter(t => t.status !== STATUS.CLOSED);
  const breached = open.filter(t => slaState(t).breached);
  if (state.tab === "tickets") return `<section class="card">${filterPanel()}${ticketBoard(tickets, { scope: "supervisor" })}</section>`;
  if (state.tab === "sla breaches") return `<section class="card">${filterPanel()}${ticketBoard(tickets.filter(t => t.status !== STATUS.CLOSED && slaState(t).breached), { scope: "supervisor" })}</section>`;
  if (state.tab === "efficiency") return efficiencyView();
  if (state.tab === "boq setup") return boqSetupView();
  if (state.tab === "baseline") return baselineView();
  if (state.tab === "sync monitor") return syncMonitorView();
  if (state.tab === "sustainability access" && isOwner()) return sustainabilityAccessView();
  if (state.tab === "reports") return reportsView(true);
  if (state.tab === "admin" && isOwner()) return adminView();
  
  // Multi-series chart: Health Score + SLA Compliance (mock data or real)
  const trend = trendByDay(scans);
  const slaTrend = trend.map(d => ({ date: d.date, avg: Math.min(10, d.avg + 1.2) })); // Mock SLA compliance curve
  const chartData = JSON.stringify({ series: [{ label: "Health", data: trend }, { label: "SLA Compliance", data: slaTrend }] });
  
  return `
    <section class="card">
      <div class="card-title"><h3>Portfolio Command Center</h3></div>
      <div class="kpi-strip">
        <div class="metric good"><span>Portfolio Health</span><strong>${hs.avg || "—"}</strong></div>
        <div class="metric critical"><span>Open SLA Risk</span><strong>${breached.length}</strong></div>
        <div class="metric monitor"><span>Scan Coverage</span><strong>${scans.length}</strong></div>
        <div class="metric good"><span>Replacement Rate</span><strong>${(tickets.filter(t => /replace/i.test(t.issue)).length / Math.max(1, tickets.length) * 100).toFixed(0)}%</strong></div>
      </div>
      <canvas class="chart" data-chart='${chartData}'></canvas>
    </section>
    <section class="card">
      <div class="card-title"><h3>Site Performance Grid</h3></div>
      <div class="table-wrap">
        <table><thead><tr><th>Site</th><th>City</th><th>Health</th><th>Open Tickets</th><th>Breached</th></tr></thead>
        <tbody>
          ${allowedSites().map(s => {
            const siteScans = scans.filter(sc => sc.siteId === s.id);
            const siteTickets = tickets.filter(t => t.siteId === s.id);
            const siteHealth = siteScans.length ? (siteScans.reduce((a,b) => a + b.score, 0) / siteScans.length).toFixed(1) : "—";
            return `<tr><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.city)}</td><td><span class="pill ${siteHealth >= 7 ? 'good' : siteHealth > 5 ? 'monitor' : 'critical'}">${siteHealth}</span></td><td>${siteTickets.filter(t => t.status !== STATUS.CLOSED).length}</td><td>${siteTickets.filter(t => t.status !== STATUS.CLOSED && slaState(t).breached).length}</td></tr>`;
          }).join("")}
        </tbody></table>
      </div>
    </section>
  `;
}
function adminView() { return `<section class="card"><div class="card-title"><div><h3>Owner Admin Tools</h3><p class="subtitle">Visible only to the master owner account.</p></div></div><div class="grid grid-2"><button class="btn secondary" data-action="seed">Seed demo data</button><button class="btn ghost" data-action="reset">Reset local data</button></div><p class="footer-note">Normal maintenance, supervisor, and client users cannot see these controls.</p></section>`; }

function clientView() {
  const { scans, tickets } = visibleRecords();
  const hs = healthSummary(scans);
  const open = tickets.filter(t => t.status !== STATUS.CLOSED);
  if (state.tab === "raise ticket") return raiseTicketView();
  if (state.tab === "reports") return reportsView(false);
  if (state.tab === "evidence") return evidenceView(tickets);
  if (state.tab === "invoices") return invoiceView();
  if (state.tab === "sustainability") return sustainabilityView();
  
  const donutBg = `conic-gradient(var(--color-good) 0% ${(tickets.filter(t => t.status === STATUS.CLOSED).length / Math.max(1, tickets.length))*100}%, var(--color-warn) ${(tickets.filter(t => t.status === STATUS.CLOSED).length / Math.max(1, tickets.length))*100}% 100%)`;
  
  return `
    <div class="grid grid-2">
      <section class="card">
        <div class="card-title"><h3>Site Health</h3></div>
        <div class="kpi-strip">
          <div class="metric good"><span>Avg Health</span><strong>${hs.avg || "—"}</strong></div>
          <div class="metric monitor"><span>Open Tickets</span><strong>${open.length}</strong></div>
          <div class="metric good"><span>Reports Ready</span><strong>${scans.length}</strong></div>
          <div class="metric good"><span>Evidence Completion</span><strong>${tickets.filter(t => t.closureEvidence).length}</strong></div>
        </div>
        <canvas class="chart" data-chart='${JSON.stringify(trendByDay(scans))}'></canvas>
      </section>
      <section class="card">
        <div class="card-title"><h3>Ticket State</h3></div>
        <div class="donut-chart-wrapper">
          <div class="donut-chart" style="background: ${donutBg}">
            <div class="legend"><strong>${tickets.length}</strong><span>Total</span></div>
          </div>
        </div>
        <div class="table-wrap">
          <table><thead><tr><th>Status</th><th>Count</th></tr></thead>
          <tbody>
            <tr><td><span class="pill good">Closed</span></td><td>${tickets.filter(t => t.status === STATUS.CLOSED).length}</td></tr>
            <tr><td><span class="pill monitor">Open</span></td><td>${tickets.filter(t => t.status !== STATUS.CLOSED).length}</td></tr>
          </tbody></table>
        </div>
      </section>
    </div>
  `;
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

function currentInvoice() {
  return generateInvoiceData(getDb(), roleFilter(getDb()), new Date());
}
function moneyInline(value) {
  return `₹${Number(value || 0).toLocaleString("en-IN")}`;
}
function latestServiceText(scans = []) {
  const latest = scans.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  return latest ? fmtDate(latest.createdAt) : "No scan/service record available yet";
}
function recurringSummaryText() {
  const model = currentEfficiencyModel();
  if (!model.recurring.count) return "No recurring issue pattern is currently visible in the selected scope.";
  return model.recurring.clusters.slice(0, 3).map(c => `${c.site?.name || "Site"} / ${c.zone}: ${c.count} repeated ${c.issueType} ticket(s)`).join("; ");
}
function assistantAnswer(question = "") {
  const q = String(question || "").toLowerCase();
  const { scans, tickets } = visibleRecords();
  const hs = healthSummary(scans);
  const open = tickets.filter(t => t.status !== STATUS.CLOSED);
  const breached = open.filter(t => slaState(t).breached);
  const p1 = open.filter(t => t.priority === "P1");
  const invoice = currentInvoice();
  const notes = visibleNotifications(getDb(), allowedSiteIds(), "client");
  if (q.includes("invoice") || q.includes("billing") || q.includes("payable")) return invoiceSummaryText(invoice);
  if (q.includes("whatsapp") || q.includes("notification")) return notes.length ? `${notes.length} WhatsApp demo notification(s) are prepared. Latest: ${notes[0].title} — ${notes[0].providerStatus}.` : "No WhatsApp demo notifications are currently logged for your sites.";
  if (q.includes("recurring")) return recurringSummaryText();
  if (q.includes("last") || q.includes("serviced") || q.includes("visited")) return `Latest service/scan record: ${latestServiceText(scans)}.`;
  if (q.includes("ticket") || q.includes("pending") || q.includes("open")) return open.length ? `There are ${open.length} open ticket(s). P1: ${p1.length}. SLA risk: ${breached.length}. Latest open issue: ${open[0]?.issue || "Open issue"}.` : "There are no open tickets in the selected scope.";
  if (q.includes("sla") || q.includes("breach")) return breached.length ? `${breached.length} open item(s) are currently breaching SLA or at SLA risk.` : "No open SLA breach is visible in the selected scope.";
  if (q.includes("report")) return `Report summary: ${scans.length} scan record(s), ${tickets.length} ticket(s), average health ${hs.avg || "—"}, critical ${hs.critical}, open ${open.length}, SLA risk ${breached.length}.`;
  return `Current site status: ${scans.length} scan record(s), average health ${hs.avg || "—"}, ${open.length} open ticket(s), ${p1.length} P1 item(s), ${breached.length} SLA-risk item(s). Latest service: ${latestServiceText(scans)}.`;
}
function assistantQuickPrompts() {
  const prompts = [
    "Summarize my site status",
    "Show pending tickets",
    "Any SLA breach?",
    "Explain latest invoice",
    "Any recurring issues?",
    "When was the site last serviced?",
    "Give this month's report summary"
  ];
  return `<div style="display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 4px">${prompts.map(p => `<button class="mini-btn" type="button" data-assistant-prompt="${escapeHtml(p)}" style="font-size:12px;padding:8px 10px">${escapeHtml(p)}</button>`).join("")}</div>`;
}
function assistantContextPayload(question = "") {
  const { scans, tickets } = visibleRecords();
  const hs = healthSummary(scans);
  const open = tickets.filter(t => t.status !== STATUS.CLOSED);
  const breached = open.filter(t => slaState(t).breached);
  const p1 = open.filter(t => t.priority === "P1");
  const invoice = currentInvoice();
  return {
    question,
    role: effectiveRole(),
    user: currentUser()?.name || "Client",
    scope: filterSummaryLabel(),
    summary: {
      scans: scans.length,
      averageHealth: hs.avg || null,
      healthy: hs.healthy,
      monitor: hs.monitor,
      critical: hs.critical,
      openTickets: open.length,
      p1Tickets: p1.length,
      slaRisk: breached.length,
      latestService: latestServiceText(scans),
      recurringIssues: recurringSummaryText()
    },
    openTickets: open.slice(0, 8).map(t => ({
      ticketNo: ticketDisplayId(t),
      issue: t.issue,
      priority: t.priority,
      status: t.status,
      sla: slaState(t).label,
      createdAt: t.createdAt
    })),
    invoice: {
      invoiceNo: invoice.invoiceNo,
      periodLabel: invoice.periodLabel,
      creditRule: invoice.creditRule,
      formula: invoice.formula,
      totals: invoice.totals
    }
  };
}
async function askClientAssistant(question) {
  const clean = String(question || "").trim();
  if (!clean) return;
  state.assistantOpen = true;
  state.assistantLoading = true;
  state.assistantInput = "";
  state.assistantMessages = [...state.assistantMessages, { role: "user", text: clean }].slice(-8);
  render();
  let answer = "";
  try {
    const res = await fetch("/api/client-assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(assistantContextPayload(clean))
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Assistant failed");
    answer = data.answer || assistantAnswer(clean);
  } catch {
    answer = assistantAnswer(clean);
  }
  state.assistantMessages = [...state.assistantMessages, { role: "assistant", text: answer }].slice(-8);
  state.assistantLoading = false;
  render();
}
function clientAssistantWidget() {
  if (effectiveRole() !== ROLES.CLIENT) return "";
  const btnStyle = "position:fixed;right:22px;bottom:22px;z-index:9999;border:0;border-radius:999px;background:#0b3b2b;color:#fff;padding:14px 18px;font-weight:800;box-shadow:0 18px 45px rgba(0,0,0,.24);cursor:pointer";
  if (!state.assistantOpen) return `<button type="button" data-action="assistant-open" style="${btnStyle}">Ask GreenOps</button>`;
  const messages = state.assistantMessages.length ? state.assistantMessages : [{ role: "assistant", text: "Ask about site status, pending tickets, SLA breaches, invoices, reports, recurring issues, or last service." }];
  return `<aside role="dialog" aria-label="Ask GreenOps assistant" style="position:fixed;right:22px;bottom:22px;width:min(420px,calc(100vw - 32px));max-height:min(680px,calc(100vh - 44px));z-index:9999;background:#fff;border:1px solid #dbe5df;border-radius:24px;box-shadow:0 24px 70px rgba(0,0,0,.25);overflow:hidden;display:flex;flex-direction:column">
    <div style="background:#062d20;color:#fff;padding:16px 18px;display:flex;align-items:center;justify-content:space-between;gap:12px">
      <div><strong style="display:block;font-size:16px">Ask GreenOps</strong><span style="font-size:12px;opacity:.78">AI client operations assistant</span></div>
      <button type="button" data-action="assistant-close" aria-label="Close assistant" style="border:1px solid rgba(255,255,255,.35);background:transparent;color:#fff;border-radius:999px;width:32px;height:32px;cursor:pointer">×</button>
    </div>
    <div style="padding:14px 16px;overflow:auto;display:grid;gap:10px;max-height:360px;background:#f8fbf9">
      ${messages.map(m => `<div style="justify-self:${m.role === "user" ? "end" : "start"};max-width:92%;border-radius:16px;padding:10px 12px;background:${m.role === "user" ? "#0b3b2b" : "#fff"};color:${m.role === "user" ? "#fff" : "#10241d"};border:1px solid ${m.role === "user" ? "#0b3b2b" : "#dfe8e2"};font-size:14px;line-height:1.45">${escapeHtml(m.text)}</div>`).join("")}
      ${state.assistantLoading ? `<div style="justify-self:start;border-radius:16px;padding:10px 12px;background:#fff;border:1px solid #dfe8e2;font-size:14px">Thinking…</div>` : ""}
    </div>
    <form id="floatingAssistantForm" style="padding:12px 14px 14px;background:#fff;border-top:1px solid #e4ebe7">
      <input class="input" name="question" value="${escapeHtml(state.assistantInput)}" placeholder="Ask about tickets, invoice, SLA, report..." autocomplete="off" />
      <button class="btn" type="submit" style="width:100%;margin-top:10px">Ask</button>
      ${assistantQuickPrompts()}
    </form>
  </aside>`;
}
function invoiceView() {
  const invoice = currentInvoice();
  return `<section class="card"><div class="card-title"><div><h3>Invoices</h3><p class="subtitle">Fixed monthly AMC with SLA service credit. Current rule: ${escapeHtml(invoice.creditRule)}.</p></div><button class="btn" data-action="download-invoice">Download Invoice</button></div>${filterPanel({ client: false })}<div class="kpi-strip"><div class="metric"><span>Base AMC</span><strong>${moneyInline(invoice.totals.monthlyAmc)}</strong></div><div class="metric monitor"><span>SLA breaches</span><strong>${invoice.totals.breachedItems}</strong></div><div class="metric critical"><span>SLA credit</span><strong>${moneyInline(invoice.totals.slaCredit)}</strong></div><div class="metric good"><span>Net payable</span><strong>${moneyInline(invoice.totals.netPayable)}</strong></div></div><div class="table-wrap"><table><thead><tr><th>Site</th><th>City</th><th>Fixed AMC</th><th>SLA breach items</th><th>SLA credit</th><th>Net payable</th></tr></thead><tbody>${invoice.rows.map(row => `<tr><td>${escapeHtml(row.siteName)}</td><td>${escapeHtml(row.city)}</td><td>${moneyInline(row.monthlyAmc)}</td><td>${row.breachedItems}</td><td>${moneyInline(row.slaCredit)}</td><td>${moneyInline(row.netPayable)}</td></tr>`).join("") || `<tr><td colspan="6">No invoice rows available.</td></tr>`}</tbody></table></div><p class="footer-note">${escapeHtml(invoice.formula)}. Invoice is generated from platform SLA records.</p></section>`;
}
function updateNotificationStatus(notificationId, patch = {}) {
  const db = getDb();
  const note = (db.notifications || []).find(n => n.id === notificationId);
  if (!note) return;
  Object.assign(note, patch);
  setDb(db);
}
function recipientForNotification(note, ticket) {
  const db = getDb();
  const site = db.sites.find(s => s.id === (note.siteId || ticket?.siteId));
  const clientUser = currentUser();
  if (note.audience === "supervisor") {
    const supervisor = db.users.find(u => u.role === ROLES.SUPERVISOR && (u.cityAccess || []).includes(site?.city));
    return supervisor?.whatsappNumber || "+918799765307";
  }
  return clientUser?.whatsappNumber || "+918799765307";
}
async function dispatchWhatsAppNotifications(ticketId) {
  const db = getDb();
  const ticket = db.tickets.find(t => t.id === ticketId);
  const notes = (db.notifications || []).filter(n => n.ticketId === ticketId && !n.providerAttemptedAt);
  await Promise.all(notes.map(async note => {
    const to = recipientForNotification(note, ticket);
    updateNotificationStatus(note.id, { providerStatus: "Sending", providerAttemptedAt: new Date().toISOString(), sentTo: to });
    try {
      const res = await fetch(APP.whatsappEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, message: note.message, type: note.type, ticketId })
      });
      const data = await res.json().catch(() => ({}));
      updateNotificationStatus(note.id, {
        providerStatus: data.delivered ? "Sent automatically" : (data.mode === "provider_not_configured" ? "Simulated - provider not configured" : "Dispatch attempted"),
        providerResponse: data,
        delivered: Boolean(data.delivered),
        deliveredAt: data.delivered ? new Date().toISOString() : ""
      });
    } catch (error) {
      updateNotificationStatus(note.id, { providerStatus: "Failed", providerError: error?.message || "WhatsApp dispatch failed" });
    }
  }));
}

function reportsView(supervisor = true) {
  const { db } = dbx(); const { scans, tickets } = visibleRecords();
  return `${executiveSnapshot(scans, tickets, supervisor ? "Report" : "Client Report")}<section class="card report-card"><div class="card-title"><div><h3>Reports</h3><p class="subtitle">Board-friendly summary plus exportable service records by date range, city, and site.</p></div><div class="btn-row report-actions"><button class="btn secondary report-download-btn" data-action="download-report">Download CSV</button><button class="btn report-print-btn" data-action="print-report">Print / Save PDF</button></div></div>${filterPanel({ client: supervisor })}${metrics(scans, tickets)}<div class="table-wrap"><table><thead><tr><th>Type</th><th>Site</th><th>Details</th><th>Status</th><th>Date</th></tr></thead><tbody>${[...scans.slice(-8).map(s => reportRow(s, "scan", db)), ...tickets.slice(-8).map(t => reportRow(t, "ticket", db))].join("") || `<tr><td colspan="5">No records yet.</td></tr>`}</tbody></table></div></section>`;
}
function reportRow(r, type, db) { const site = db.sites.find(s => s.id === r.siteId); const plant = db.plants.find(p => p.id === r.plantId); if (type === "scan") return `<tr><td>Scan</td><td>${escapeHtml(site?.name)}</td><td>${escapeHtml(plant?.type)} · score ${r.score}</td><td><span class="pill ${healthClass(r.category)}">${r.category}</span></td><td>${fmtDate(r.createdAt)}</td></tr>`; return `<tr><td>Ticket</td><td>${escapeHtml(site?.name)}</td><td>${escapeHtml(r.issue)}</td><td><span class="pill ${r.status === STATUS.CLOSED ? "closed" : r.status === STATUS.IN_PROGRESS ? "progress" : "open"}">${r.status}</span></td><td>${fmtDate(r.createdAt)}</td></tr>`; }
function filterSummaryLabel() {
  const db = getDb();
  const site = state.filters.siteId !== "all" ? db.sites.find(s => s.id === state.filters.siteId) : null;
  const client = state.filters.clientId !== "all" ? db.clients.find(c => c.id === state.filters.clientId) : null;
  const parts = [];
  if (client) parts.push(client.name);
  if (state.filters.city !== "all") parts.push(state.filters.city);
  parts.push(site ? site.name : "All assigned sites");
  if (state.filters.from || state.filters.to) parts.push(`${state.filters.from || "Start"} to ${state.filters.to || "Today"}`);
  return parts.filter(Boolean).join(" · ");
}
function printableReportRows(scans, tickets, db) {
  const scanRows = scans.slice(-12).map(s => {
    const site = db.sites.find(x => x.id === s.siteId);
    const plant = db.plants.find(p => p.id === s.plantId);
    return `<tr><td>Scan</td><td>${escapeHtml(site?.name || "—")}</td><td>${escapeHtml(plant?.zone || s.zone || "General")}</td><td>${escapeHtml(plant?.type || s.plantType || "Plant")}</td><td>${escapeHtml(String(s.score ?? "—"))}</td><td>${escapeHtml(s.category || "—")}</td><td>${fmtDate(s.createdAt)}</td></tr>`;
  });
  const ticketRows = tickets.slice(-12).map(t => {
    const site = db.sites.find(x => x.id === t.siteId);
    const plant = db.plants.find(p => p.id === t.plantId);
    return `<tr><td>Ticket</td><td>${escapeHtml(site?.name || "—")}</td><td>${escapeHtml(plant?.zone || "General")}</td><td>${escapeHtml(t.issue || "Issue")}</td><td>${escapeHtml(t.priority || "—")}</td><td>${escapeHtml(t.status || "—")}</td><td>${fmtDate(t.createdAt)}</td></tr>`;
  });
  return [...scanRows, ...ticketRows
