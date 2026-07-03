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

function layout(content) {
  const role = effectiveRole();
  let tabs = isOwner() && state.ownerViewRole === ROLES.MAINTENANCE ? roleTabs[ROLES.MAINTENANCE] : isOwner() && state.ownerViewRole === ROLES.CLIENT ? roleTabs[ROLES.CLIENT] : isOwner() ? roleTabs[ROLES.OWNER] : roleTabs[role];
  if (role === ROLES.CLIENT && !clientSustainabilityTabVisible()) tabs = tabs.filter(t => t !== "sustainability");
  if (!tabs.includes(state.tab)) state.tab = tabs[0];
  const user = currentUser();
  return `<div class="app-shell">
    <header class="topbar"><div class="top-inner">
      <div class="brand"><img class="brand-icon" src="${productIcon}" alt="GreenOps icon" /><div><h1>${APP.name}</h1><p>Plant Health Service Management</p></div></div>
      <label class="top-search"><span>Search</span><input placeholder="Ticket, site, species, vendor" /></label>
      <div class="user-menu">
        ${isOwner() ? ownerModeSwitch() : ""}
        <span class="user-pill">Synced 3m ago</span>
        <span class="user-pill">${escapeHtml(user?.name)} · ${title(actualRole())}</span>
        <button class="logout-btn" data-action="logout">Logout</button>
      </div>
    </div></header>
    <div class="platform-shell">
      ${workspaceSidebar(tabs)}
      <main class="main product-main">
        <div class="platform-page">
          <aside class="context-strap" aria-label="Page context">
            <span class="strap-kicker">${escapeHtml(roleLabel())}</span>
            <strong>${escapeHtml(title(state.tab))}</strong>
            <small>${escapeHtml(role === ROLES.CLIENT ? "Client portal" : role === ROLES.MAINTENANCE ? "Field desk" : "Ops command")}</small>
          </aside>
          <section class="page-canvas">
            <div class="page-title-row">
              <div>
                <div class="eyebrow dark">${escapeHtml(roleLabel())}</div>
                <h2>${heroTitle()}</h2>
                <p>${heroSubtitle()}</p>
              </div>
              ${isOwner() ? adminQuickActions() : ""}
            </div>
            <nav class="tabs tab-bar" aria-label="Section tabs">${tabs.map(t => `<button class="tab-item ${state.tab === t ? "active" : ""}" data-tab="${t}">${title(t)}</button>`).join("")}</nav>
            ${content}
          </section>
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
  if (state.tab === "scan") return scanView();
  if (state.tab === "my tickets") return ticketBoard(tickets.filter(t => t.status !== STATUS.CLOSED), { scope: "maintenance" });
  if (state.tab === "history") return historyView(scans, tickets);
  return `<div class="grid grid-2"><section class="card">${metrics(scans, tickets)}<div class="grid grid-2"><button class="btn" data-tab="scan">Maintenance Window</button><button class="btn secondary" data-tab="my tickets">My Open Tasks</button></div><p class="footer-note">This view is restricted to assigned sites only.</p></section><section class="card"><div class="card-title"><h3>Critical assigned queue</h3><span class="pill critical">Action required</span></div>${ticketBoard(tickets.filter(t => t.status !== STATUS.CLOSED).slice(0, 5), { scope: "maintenance", compact: true })}</section></div>`;
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
  if (state.tab === "tickets") return `<section class="card">${filterPanel()}${ticketBoard(tickets, { scope: "supervisor" })}</section>`;
  if (state.tab === "sla breaches") return `<section class="card">${filterPanel()}${ticketBoard(tickets.filter(t => t.status !== STATUS.CLOSED && slaState(t).breached), { scope: "supervisor" })}</section>`;
  if (state.tab === "efficiency") return efficiencyView();
  if (state.tab === "boq setup") return boqSetupView();
  if (state.tab === "baseline") return baselineView();
  if (state.tab === "sync monitor") return syncMonitorView();
  if (state.tab === "sustainability access" && isOwner()) return sustainabilityAccessView();
  if (state.tab === "reports") return reportsView(true);
  if (state.tab === "admin" && isOwner()) return adminView();
  return `${executiveSnapshot(scans, tickets, isOwner() ? "Owner" : "Operations")}<section class="card command-card">${filterPanel()}${metrics(scans, tickets)}${proofOutcomeGrid(scans, tickets)}<div class="grid grid-2"><div>${healthBuckets(scans)}</div><div><h3>Health trend</h3><canvas class="chart" data-chart='${JSON.stringify(trendByDay(scans)).replaceAll("'", "&#39;")}'></canvas></div></div></section><div style="height:16px"></div><section class="card"><div class="card-title"><div><h3>Live ticket queue</h3><p class="subtitle">The items below are the operational proof trail behind the dashboard.</p></div><button class="btn secondary" data-tab="tickets">Open full board</button></div>${ticketBoard(tickets.slice(0, 8), { scope: "supervisor", compact: true })}</section>`;
}
function adminView() { return `<section class="card"><div class="card-title"><div><h3>Owner Admin Tools</h3><p class="subtitle">Visible only to the master owner account.</p></div></div><div class="grid grid-2"><button class="btn secondary" data-action="seed">Seed demo data</button><button class="btn ghost" data-action="reset">Reset local data</button></div><p class="footer-note">Normal maintenance, supervisor, and client users cannot see these controls.</p></section>`; }

function clientView() {
  const { scans, tickets } = visibleRecords();
  if (state.tab === "raise ticket") return raiseTicketView();
  if (state.tab === "reports") return reportsView(false);
  if (state.tab === "evidence") return evidenceView(tickets);
  if (state.tab === "invoices") return invoiceView();
  if (state.tab === "sustainability") return sustainabilityView();
  return `${executiveSnapshot(scans, tickets, "Client")}<section class="card command-card">${filterPanel({ client: false })}${metrics(scans, tickets)}${clientServiceAssurance(scans, tickets)}<div class="grid grid-2"><div><h3>Location health graph</h3><canvas class="chart" data-chart='${JSON.stringify(trendByDay(scans)).replaceAll("'", "&#39;")}'></canvas></div><div>${healthBuckets(scans)}</div></div></section><div style="height:16px"></div><section class="card"><div class="card-title"><div><h3>Your open tickets</h3><p class="subtitle">Priority items, closure evidence, and current operational state.</p></div><div class="btn-row"><button class="btn secondary" data-tab="invoices">Invoices</button></div></div><button class="btn client-raise-ticket-cta" data-tab="raise ticket">Raise Priority 1 Ticket</button><div style="height:14px"></div>${ticketBoard(tickets, { scope: "client", compact: true })}</section>`;
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
  return [...scanRows, ...ticketRows].join("") || `<tr><td colspan="7">No records available for the selected report filters.</td></tr>`;
}
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

function drawCharts() { $$("canvas[data-chart]").forEach(canvas => { const data = JSON.parse(canvas.dataset.chart || "[]"); const rect = canvas.getBoundingClientRect(); const ratio = window.devicePixelRatio || 1; canvas.width = rect.width * ratio; canvas.height = rect.height * ratio; const ctx = canvas.getContext("2d"); ctx.scale(ratio, ratio); const w = rect.width, h = rect.height, pad = 34; ctx.clearRect(0,0,w,h); ctx.strokeStyle = "#e4e0d7"; ctx.lineWidth = 1; for(let i=0;i<=4;i++){ const y = pad + (h-pad*2)*i/4; ctx.beginPath(); ctx.moveTo(pad,y); ctx.lineTo(w-pad,y); ctx.stroke(); } if (!data.length) { ctx.fillStyle = "#6d756f"; ctx.font = "13px Inter"; ctx.fillText("No scan data yet", pad, h/2); return; } const xs = i => pad + (w-pad*2)*(data.length===1?0.5:i/(data.length-1)); const ys = v => h-pad - (h-pad*2)*(v/10); ctx.strokeStyle = "#1c6048"; ctx.lineWidth = 3; ctx.beginPath(); data.forEach((d,i)=> i?ctx.lineTo(xs(i),ys(d.avg)):ctx.moveTo(xs(i),ys(d.avg))); ctx.stroke(); data.forEach((d,i)=>{ ctx.fillStyle="#0f2f24"; ctx.beginPath(); ctx.arc(xs(i),ys(d.avg),4,0,Math.PI*2); ctx.fill(); }); ctx.fillStyle = "#6d756f"; ctx.font = "12px Inter"; ctx.fillText("0", 10, h-pad); ctx.fillText("10", 8, pad+4); ctx.fillText("Avg health score", pad, 18); }); }


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
