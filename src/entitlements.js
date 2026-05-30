function defaultEntitlement(clientId = "", siteId = "") {
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
  if (!entitlement?.trialEnabled || !entitlement.trialStartDate || !entitlement.trialEndDate) return false;
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
  return exact || clientWide || defaultEntitlement(clientId, siteId);
}

export function canViewMetricValues(entitlement) {
  if (!entitlement?.sustainabilityTabVisible) return false;
  if (entitlement.metricValuesVisible && ["active", "trial"].includes(entitlement.subscriptionStatus)) return true;
  return isTrialActive(entitlement);
}

export function canUseFrameworkSwitcher(entitlement) {
  return canViewMetricValues(entitlement) && Boolean(entitlement.frameworkSwitcherEnabled);
}

export function canExportSustainabilityReport(entitlement) {
  return canViewMetricValues(entitlement) && Boolean(entitlement.pdfExportEnabled || entitlement.excelExportEnabled);
}
