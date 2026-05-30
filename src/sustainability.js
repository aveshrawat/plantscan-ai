import { PLANT_CATEGORIES, STATUS } from "./config.js";
import { baselineForSite } from "./boq.js";

const BOUNDARY = "Horticulture contribution only";

function inScopeSiteIds(db, filters = {}) {
  const explicit = Array.isArray(filters.siteIds) && filters.siteIds.length ? filters.siteIds : db.sites.map(site => site.id);
  return new Set(explicit.filter(siteId => {
    const site = db.sites.find(s => s.id === siteId);
    return site &&
      (filters.siteId === "all" || !filters.siteId || site.id === filters.siteId) &&
      (filters.clientId === "all" || !filters.clientId || site.clientId === filters.clientId) &&
      (filters.city === "all" || !filters.city || site.city === filters.city);
  }));
}

function inPeriod(iso, period = {}) {
  const value = String(iso || "").slice(0, 10);
  if (!value) return true;
  return (!period.from || value >= period.from) && (!period.to || value <= period.to);
}

function formatNumber(value, digits = 1) {
  const n = Number(value || 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(digits);
}

function pct(numerator, denominator) {
  if (!denominator) return 0;
  return Math.max(0, Math.min(100, (Number(numerator || 0) / Number(denominator || 0)) * 100));
}

function categoryWeight(categoryId) {
  return PLANT_CATEGORIES.find(category => category.id === categoryId)?.defaultWeightKg || 3;
}

function metric({ id, name, explanation, value, unit = "", dataQuality = "Estimated", dataBasis = "Estimated", formula = "", limitation = "" }) {
  const formattedValue = unit === "%" ? `${formatNumber(value)}%` : unit ? `${formatNumber(value)} ${unit}` : formatNumber(value);
  return {
    id,
    name,
    explanation,
    value,
    unit,
    formattedValue,
    dataQuality,
    dataBasis,
    boundary: BOUNDARY,
    formula,
    limitation: limitation || "Does not represent the client's complete ESG disclosure or total company footprint."
  };
}

export function calculateWaterMetrics({ boqLines = [], serviceLogs = [] }) {
  const expectedLitres = boqLines.reduce((sum, line) =>
    sum + Number(line.quantity || 0) * Number(line.waterPerServiceMl || 0) * Number(line.wateringFrequencyPerWeek || 0) * 4.345 / 1000, 0);
  const lineMap = Object.fromEntries(boqLines.map(line => [line.id, line]));
  const actualLitres = serviceLogs.reduce((sum, log) => {
    if (!log.wateringDone) return sum;
    const line = lineMap[log.boqLineId] || boqLines.find(item => item.placementBucket === log.placementBucket && item.floor === log.floor);
    const waterMl = Number(line?.waterPerServiceMl || 0);
    return sum + Number(log.wateredPlantCount || log.plantsServicedCount || 0) * waterMl / 1000;
  }, 0);
  const expectedEvents = boqLines.reduce((sum, line) => sum + Number(line.maintenanceFrequencyPerMonth || 0), 0);
  const wateringLogs = serviceLogs.filter(log => log.wateringDone).length;
  return {
    expectedLitres,
    actualLitres,
    compliancePct: pct(wateringLogs, expectedEvents || boqLines.length)
  };
}

export function calculatePlantSurvival({ boqLines = [], scans = [], serviceLogs = [] }) {
  const baselineCount = boqLines.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
  const deadCount = serviceLogs.reduce((sum, log) => sum + Number(log.deadPlantCount || 0), 0);
  const avgHealth = scans.length ? scans.reduce((sum, scan) => sum + Number(scan.score || 0), 0) / scans.length : 0;
  return {
    baselineCount,
    deadCount,
    survivalPct: pct(Math.max(0, baselineCount - deadCount), baselineCount),
    avgHealth
  };
}

export function calculateReplacementMetrics({ boqLines = [], serviceLogs = [] }) {
  const baselineCount = boqLines.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
  const replacements = serviceLogs.reduce((sum, log) => sum + Number(log.replacementsCount || 0), 0);
  return {
    replacements,
    replacementRatePct: pct(replacements, baselineCount)
  };
}

export function calculateWasteMetrics({ serviceLogs = [], assumptions = {} }) {
  const wasteKg = serviceLogs.reduce((sum, log) => {
    const count = Number(log.replacementsCount || 0) + Number(log.deadPlantCount || 0);
    return sum + count * categoryWeight(log.plantCategory);
  }, 0);
  const routed = serviceLogs.filter(log => log.disposalRoute && log.disposalRoute !== "not_applicable");
  const preferred = routed.filter(log => ["composted", "reused"].includes(log.disposalRoute)).length;
  return {
    wasteKg,
    preferredDisposalPct: pct(preferred, routed.length),
    boundary: assumptions.wasteBoundary || BOUNDARY
  };
}

export function calculateChemicalFreePct({ serviceLogs = [] }) {
  const relevant = serviceLogs.filter(log => log.materialUsed && log.materialUsed !== "none");
  const chemicalFree = serviceLogs.filter(log => ["organic", "none"].includes(log.materialUsed)).length;
  return pct(chemicalFree, relevant.length || serviceLogs.length);
}

export function calculateVendorTravel({ visits = [], vendorProfiles = [], assumptions = {} }) {
  const defaultRoundTripKm = Number(assumptions.defaultRoundTripKm || 30);
  const totalKm = visits.reduce((sum, visit) => {
    const profile = vendorProfiles.find(item => item.siteId === visit.siteId);
    return sum + Number(profile?.roundTripKm || defaultRoundTripKm);
  }, 0);
  return {
    visitCount: visits.length,
    travelKm: totalKm * Number(assumptions.vehicleKmFactor || 1)
  };
}

export function calculateGreenAssetHealth({ scans = [], boqLines = [], serviceLogs = [] }) {
  const scanScores = scans.map(scan => Number(scan.score || 0)).filter(Boolean);
  const serviceScores = serviceLogs.map(log => Number(log.aiHealthScore || 0)).filter(Boolean);
  const scores = [...scanScores, ...serviceScores];
  const avg = scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0;
  const baselineCount = boqLines.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
  return {
    score: avg,
    coveredAssets: Math.min(baselineCount, scores.length),
    baselineCount
  };
}

export function metricQualityLabel(metricItem) {
  return metricItem?.dataQuality || metricItem?.dataBasis || "Estimated";
}

export function calculateIssueMetrics({ tickets = [], serviceLogs = [] }) {
  const closed = tickets.filter(ticket => ticket.status === STATUS.CLOSED).length;
  const repeat = tickets.filter(ticket => Number(ticket.reopenCount || 0) > 0 || /recurring|repeat/i.test(ticket.issueType || ticket.issue || "")).length;
  const safetyIssues = serviceLogs.filter(log => ["water_leakage", "ac_draft", "damage"].includes(log.issueCategory)).length;
  return {
    closureRatePct: pct(closed, tickets.length),
    repeatIssueRatePct: pct(repeat, tickets.length),
    safetyIssues
  };
}

export function buildSustainabilityMetrics({ db, filters = {}, period = {} }) {
  const siteIds = inScopeSiteIds(db, filters);
  const sites = db.sites.filter(site => siteIds.has(site.id));
  const boqLines = sites.flatMap(site => baselineForSite(db, site.id));
  const serviceLogs = (db.serviceLogs || []).filter(log => siteIds.has(log.siteId) && inPeriod(log.serverCreatedAt || log.localCreatedAt, period));
  const scans = (db.scans || []).filter(scan => siteIds.has(scan.siteId) && inPeriod(scan.createdAt, period));
  const tickets = (db.tickets || []).filter(ticket => siteIds.has(ticket.siteId) && inPeriod(ticket.createdAt, period));
  const assumptions = Object.assign({}, ...(db.formulaAssumptions || []));
  const visitsByKey = new Map();
  serviceLogs.forEach(log => {
    const key = `${log.siteId}:${log.createdBy}:${String(log.localCreatedAt || log.serverCreatedAt || "").slice(0, 10)}`;
    if (!visitsByKey.has(key)) visitsByKey.set(key, { siteId: log.siteId, createdBy: log.createdBy });
  });

  const water = calculateWaterMetrics({ boqLines, serviceLogs });
  const survival = calculatePlantSurvival({ boqLines, scans, serviceLogs });
  const replacement = calculateReplacementMetrics({ boqLines, serviceLogs });
  const waste = calculateWasteMetrics({ serviceLogs, assumptions });
  const travel = calculateVendorTravel({ visits: [...visitsByKey.values()], vendorProfiles: db.vendorSiteProfiles || [], assumptions });
  const health = calculateGreenAssetHealth({ scans, boqLines, serviceLogs });
  const issues = calculateIssueMetrics({ tickets, serviceLogs });

  return [
    metric({
      id: "estimated_water_use",
      name: "Estimated Water Use",
      explanation: "Tracks estimated water used for plant maintenance based on BOQ baseline and actual service logs.",
      value: water.actualLitres || water.expectedLitres,
      unit: "L",
      dataQuality: "Estimated",
      formula: "Plant count x water per service x actual logged watering events"
    }),
    metric({
      id: "watering_compliance",
      name: "Watering Compliance",
      explanation: "Compares logged watering activity against expected baseline watering frequency.",
      value: water.compliancePct,
      unit: "%",
      dataQuality: "Calculated/Estimated",
      formula: "Logged watering events divided by expected BOQ watering events"
    }),
    metric({
      id: "plant_survival_rate",
      name: "Plant Survival Rate",
      explanation: "Estimates how many baseline plants remain alive based on dead plant and replacement logs.",
      value: survival.survivalPct,
      unit: "%",
      dataQuality: "Calculated",
      formula: "(Baseline plant count minus dead plant count) divided by baseline plant count"
    }),
    metric({
      id: "replacement_rate",
      name: "Replacement Rate",
      explanation: "Shows replacement volume as a percentage of the active BOQ baseline.",
      value: replacement.replacementRatePct,
      unit: "%",
      dataQuality: "Calculated",
      formula: "Replacement count divided by baseline plant count"
    }),
    metric({
      id: "estimated_green_waste",
      name: "Estimated Green Waste",
      explanation: "Estimates green waste from dead and replaced plants using category-level default weights.",
      value: waste.wasteKg,
      unit: "kg",
      dataQuality: "Estimated",
      formula: "Replacement/dead count x plant category default weight"
    }),
    metric({
      id: "waste_disposal_route",
      name: "Waste Disposal Route",
      explanation: "Shows the share of logged green waste routed to composting or reuse.",
      value: waste.preferredDisposalPct,
      unit: "%",
      dataQuality: "Calculated",
      formula: "Composted or reused disposal logs divided by all disposal logs"
    }),
    metric({
      id: "chemical_free_maintenance_pct",
      name: "Chemical-Free Maintenance %",
      explanation: "Tracks service logs marked organic or none against all material-use logs.",
      value: calculateChemicalFreePct({ serviceLogs }),
      unit: "%",
      dataQuality: "Calculated",
      formula: "Organic or no-material logs divided by relevant material logs"
    }),
    metric({
      id: "vendor_visit_count",
      name: "Vendor Visit Count",
      explanation: "Counts unique field service visits logged by staff, site, and day.",
      value: travel.visitCount,
      dataQuality: "Calculated",
      formula: "Unique site, staff, and service-date combinations"
    }),
    metric({
      id: "vendor_travel_estimate",
      name: "Vendor Travel Estimate",
      explanation: "Estimates vendor travel distance using visit count and site-level or default round-trip distance.",
      value: travel.travelKm,
      unit: "km",
      dataQuality: "Estimated",
      formula: "Vendor visit count x round-trip distance assumption"
    }),
    metric({
      id: "green_asset_health_score",
      name: "Green Asset Health Score",
      explanation: "Averages AI or manually captured plant health scores for maintained green assets.",
      value: health.score,
      dataQuality: "Calculated",
      formula: "Average of AI scan and service log health scores"
    }),
    metric({
      id: "issue_closure_rate",
      name: "Issue Closure Rate",
      explanation: "Tracks how many operational tickets in the selected scope have been closed.",
      value: issues.closureRatePct,
      unit: "%",
      dataQuality: "Calculated",
      formula: "Closed tickets divided by total tickets"
    }),
    metric({
      id: "repeat_issue_rate",
      name: "Repeat Issue Rate",
      explanation: "Highlights repeated or reopened issue patterns from the ticket history.",
      value: issues.repeatIssueRatePct,
      unit: "%",
      dataQuality: "Calculated",
      formula: "Repeated or reopened tickets divided by total tickets"
    }),
    metric({
      id: "safety_issues",
      name: "Safety Issues",
      explanation: "Counts service logs that flagged water leakage, AC draft, or plant damage issues.",
      value: issues.safetyIssues,
      dataQuality: "Calculated",
      formula: "Count of safety-relevant issue categories from service logs"
    })
  ];
}
