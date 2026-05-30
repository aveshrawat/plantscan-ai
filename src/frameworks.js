export const FRAMEWORKS = [
  { id: "brsr", label: "BRSR" },
  { id: "gri", label: "GRI" },
  { id: "issb", label: "ISSB / IFRS" },
  { id: "tcfd", label: "TCFD" },
  { id: "tnfd", label: "TNFD" }
];

const DEFAULT_MAPPING = {
  brsr: {
    section: "Resource use and operations",
    label: "Horticulture resource support metric",
    supports: "Operational resource-use evidence",
    contributionType: "Horticulture operations only",
    coverage: "Supporting evidence"
  },
  gri: {
    section: "Environmental topics",
    label: "Environmental operations support metric",
    supports: "Resource, waste, and supplier activity evidence",
    contributionType: "Supporting operational data",
    coverage: "Partially covered"
  },
  issb: {
    section: "Sustainability-related operational inputs",
    label: "Operational sustainability input",
    supports: "Sustainability-related risk and resource context",
    contributionType: "Supporting evidence",
    coverage: "Supporting evidence"
  },
  tcfd: {
    section: "Operational resilience indicators",
    label: "Climate-related operations support metric",
    supports: "Resource and vendor activity context",
    contributionType: "Limited supporting indicator",
    coverage: "Limited relevance"
  },
  tnfd: {
    section: "Nature-related asset condition indicators",
    label: "Maintained green asset support metric",
    supports: "Maintained green asset condition evidence",
    contributionType: "Indoor/maintained asset evidence",
    coverage: "Supporting evidence"
  }
};

export const FRAMEWORK_MAPPING = {
  estimated_water_use: {
    brsr: { section: "Water and resource use", label: "Estimated horticulture water use", supports: "Water footprint / resource use area", coverage: "Partially covered" },
    gri: { section: "GRI 303: Water", label: "Estimated plant-maintenance water withdrawal support", supports: "Water consumption context", coverage: "Supporting evidence" },
    issb: { section: "Resource dependency inputs", label: "Water-use operating input", supports: "Resource dependency and resilience context", coverage: "Supporting evidence" },
    tcfd: { section: "Operational resource exposure", label: "Water-use operating estimate", supports: "Resource sensitivity context", coverage: "Limited relevance" },
    tnfd: { section: "Nature-related resource interface", label: "Managed green-asset water input", supports: "Maintained asset dependency context", coverage: "Supporting evidence" }
  },
  watering_compliance: {
    brsr: { section: "Operations and service quality", label: "Watering schedule adherence", supports: "Responsible resource-use practice", coverage: "Supporting evidence" },
    gri: { section: "Environmental management approach", label: "Watering control evidence", supports: "Management approach evidence", coverage: "Supporting evidence" },
    issb: { section: "Controls and monitoring", label: "Resource control adherence", supports: "Operational control evidence", coverage: "Supporting evidence" },
    tcfd: { section: "Operational controls", label: "Maintenance control indicator", supports: "Resilience process evidence", coverage: "Limited relevance" },
    tnfd: { section: "Asset condition management", label: "Green asset care adherence", supports: "Asset condition evidence", coverage: "Supporting evidence" }
  },
  plant_survival_rate: {
    tnfd: { section: "Green asset condition", label: "Maintained plant survival rate", supports: "Condition of maintained green assets", coverage: "Partially covered" },
    gri: { section: "Environmental performance support", label: "Maintained plant survival indicator", supports: "Operational biodiversity-adjacent evidence", coverage: "Supporting evidence" }
  },
  replacement_rate: {
    brsr: { section: "Resource efficiency", label: "Plant replacement rate", supports: "Material efficiency and service quality", coverage: "Supporting evidence" },
    gri: { section: "Materials and waste support", label: "Replacement intensity", supports: "Material flow context", coverage: "Supporting evidence" },
    tnfd: { section: "Asset condition", label: "Maintained asset replacement pressure", supports: "Green asset condition evidence", coverage: "Supporting evidence" }
  },
  estimated_green_waste: {
    brsr: { section: "Waste and circularity", label: "Estimated horticulture green waste", supports: "Waste management area", coverage: "Partially covered" },
    gri: { section: "GRI 306: Waste", label: "Estimated plant-maintenance waste", supports: "Waste-generation context", coverage: "Supporting evidence" },
    tnfd: { section: "Nature-related material flow", label: "Managed green-asset waste estimate", supports: "Maintained asset material flow", coverage: "Supporting evidence" }
  },
  waste_disposal_route: {
    brsr: { section: "Waste and circularity", label: "Green waste route tracking", supports: "Circularity and disposal evidence", coverage: "Supporting evidence" },
    gri: { section: "GRI 306: Waste", label: "Disposal route evidence", supports: "Waste diversion context", coverage: "Supporting evidence" }
  },
  chemical_free_maintenance_pct: {
    brsr: { section: "Safe and responsible operations", label: "Chemical-free maintenance share", supports: "Safer operations evidence", coverage: "Supporting evidence" },
    gri: { section: "Environmental management approach", label: "Chemical-light horticulture maintenance", supports: "Pollution prevention context", coverage: "Supporting evidence" },
    tnfd: { section: "Nature pressure management", label: "Low-chemical care indicator", supports: "Nature-pressure reduction context", coverage: "Supporting evidence" }
  },
  vendor_visit_count: {
    brsr: { section: "Supplier and service operations", label: "Vendor visit count", supports: "Service activity evidence", coverage: "Supporting evidence" },
    gri: { section: "Supplier operations support", label: "Service visit activity", supports: "Supplier activity context", coverage: "Supporting evidence" },
    issb: { section: "Value-chain inputs", label: "Supplier service activity", supports: "Value-chain operating context", coverage: "Supporting evidence" }
  },
  vendor_travel_estimate: {
    brsr: { section: "Supplier and service operations", label: "Estimated vendor travel distance", supports: "Vendor activity footprint context", coverage: "Supporting evidence" },
    gri: { section: "Supplier environmental context", label: "Vendor travel estimate", supports: "Indirect operational activity context", coverage: "Supporting evidence" },
    issb: { section: "Value-chain inputs", label: "Vendor travel operating estimate", supports: "Value-chain operational input", coverage: "Supporting evidence" },
    tcfd: { section: "Value-chain activity", label: "Vendor travel activity estimate", supports: "Transition planning context", coverage: "Limited relevance" }
  },
  green_asset_health_score: {
    brsr: { section: "Asset condition and service quality", label: "Green asset health score", supports: "Maintained asset condition evidence", coverage: "Supporting evidence" },
    gri: { section: "Environmental performance support", label: "Maintained green asset health", supports: "Operational environmental condition context", coverage: "Supporting evidence" },
    tnfd: { section: "Nature-related asset condition", label: "Maintained green asset health", supports: "Green asset condition evidence", coverage: "Partially covered" }
  },
  issue_closure_rate: {
    brsr: { section: "Governance and operations", label: "Issue closure rate", supports: "Operational governance evidence", coverage: "Supporting evidence" },
    gri: { section: "Management approach", label: "Operational issue closure", supports: "Management approach evidence", coverage: "Supporting evidence" },
    issb: { section: "Controls and monitoring", label: "Issue closure control", supports: "Control effectiveness context", coverage: "Supporting evidence" }
  },
  repeat_issue_rate: {
    brsr: { section: "Service quality and risk", label: "Repeat issue rate", supports: "Operational risk evidence", coverage: "Supporting evidence" },
    issb: { section: "Risk monitoring", label: "Recurring issue indicator", supports: "Operational risk-monitoring context", coverage: "Supporting evidence" }
  },
  safety_issues: {
    brsr: { section: "Health and safety support", label: "Horticulture-linked safety issues", supports: "Workplace safety support evidence", coverage: "Supporting evidence" },
    gri: { section: "Occupational health and safety support", label: "Safety-relevant service issues", supports: "Safety issue context", coverage: "Supporting evidence" }
  }
};

function frameworkConfig(framework) {
  return FRAMEWORKS.some(item => item.id === framework) ? framework : "brsr";
}

function mappingFor(metricId, framework) {
  const fw = frameworkConfig(framework);
  return { ...DEFAULT_MAPPING[fw], ...(FRAMEWORK_MAPPING[metricId]?.[fw] || {}) };
}

export function frameworkLabelForMetric(metricId, framework) {
  return mappingFor(metricId, framework).label;
}

export function frameworkSectionForMetric(metricId, framework) {
  return mappingFor(metricId, framework).section;
}

export function coverageStatus(metric, framework) {
  return mappingFor(metric.id || metric, framework).coverage;
}

export function frameworkPopupForMetric(metric, framework) {
  const mapping = mappingFor(metric.id, framework);
  const selected = FRAMEWORKS.find(item => item.id === frameworkConfig(framework))?.label || "BRSR";
  return {
    metric: metric.name,
    selectedFramework: selected,
    supports: mapping.supports,
    contributionType: mapping.contributionType || DEFAULT_MAPPING[frameworkConfig(framework)].contributionType,
    dataQuality: metric.dataQuality,
    formula: metric.formula,
    boundary: "Indoor/maintained horticulture assets only",
    limitation: metric.limitation || "Does not represent total company environmental performance.",
    coverageStatus: mapping.coverage
  };
}

export function buildFrameworkView(metrics = [], framework = "brsr") {
  const grouped = {};
  metrics.forEach(metric => {
    const section = frameworkSectionForMetric(metric.id, framework);
    (grouped[section] ||= []).push({
      ...metric,
      frameworkLabel: frameworkLabelForMetric(metric.id, framework),
      frameworkPopup: frameworkPopupForMetric(metric, framework),
      coverageStatus: coverageStatus(metric, framework)
    });
  });
  return Object.entries(grouped).map(([section, items]) => ({ section, items }));
}
