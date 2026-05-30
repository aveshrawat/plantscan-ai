export function defaultCoreEntitlement(clientId = "", siteId = "") {
  return {
    id: "",
    clientId,
    siteId,
    sustainabilityTabVisible: true,
    metricNamesVisible: true,
    metricValuesVisible: false,
    trialEnabled: false,
    trialDays: 0,
    trialStartDate: "",
    trialEndDate: "",
    trialExpired: false,
    frameworkSwitcherEnabled: false,
    pdfExportEnabled: false,
    excelExportEnabled: false,
    historicalTrendsEnabled: false,
    planName: "core",
    subscriptionStatus: "core",
    updatedBy: "",
    updatedAt: ""
  };
}

export function isTrialActive(entitlement, now = new Date()) {
  if (!entitlement?.trialEnabled || entitlement.trialExpired || entitlement.subscriptionStatus === "expired") return false;
  if (!entitlement.trialStartDate || !entitlement.trialEndDate) return entitlement.subscriptionStatus === "trial";
  const current = now instanceof Date ? now : new Date(now);
  const start = new Date(entitlement.trialStartDate);
  const end = new Date(entitlement.trialEndDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
  return current >= start && current <= end && !entitlement.trialExpired;
}

export function getClientEntitlement(db, clientId, siteId) {
  const entitlements = db.sustainabilityEntitlements || [];
  const exact = entitlements.find(item => item.clientId === clientId && item.siteId === siteId);
  const clientWide = entitlements.find(item => item.clientId === clientId && !item.siteId);
  return exact || clientWide || defaultCoreEntitlement(clientId, siteId);
}

export function canViewMetricValues(entitlement) {
  if (!entitlement?.sustainabilityTabVisible) return false;
  if (entitlement.subscriptionStatus === "expired" || entitlement.trialExpired) return false;
  if (entitlement.subscriptionStatus === "active") return true;
  if (entitlement.subscriptionStatus === "trial") return isTrialActive(entitlement);
  return Boolean(entitlement.metricValuesVisible);
}

export function canUseFrameworkSwitcher(entitlement) {
  return canViewMetricValues(entitlement) && Boolean(entitlement.frameworkSwitcherEnabled);
}

export function canExportSustainabilityReport(entitlement) {
  return canViewMetricValues(entitlement) && Boolean(entitlement.pdfExportEnabled || entitlement.excelExportEnabled);
}
