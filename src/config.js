export const APP = {
  name: "GreenOps ITSM",
  storageKey: "greenops_itsm_v2",
  sessionUserKey: "greenops_user_v2",
  sessionRoleKey: "greenops_role_v1",
  sessionTabKey: "greenops_tab_v1",
  diagnosisEndpoint: "/api/diagnose",
  verifyEvidenceEndpoint: "/api/verify-evidence",
  whatsappEndpoint: "/api/notify-whatsapp"
};

export const ROLES = {
  OWNER: "owner",
  MAINTENANCE: "maintenance",
  SUPERVISOR: "supervisor",
  CLIENT: "client"
};

export const HEALTH = {
  HEALTHY: "Healthy",
  MONITOR: "Monitor",
  CRITICAL: "Critical"
};

export const STATUS = {
  OPEN: "Open",
  IN_PROGRESS: "In Progress",
  CLOSED: "Closed",
  PAUSED: "Paused"
};

export const PRIORITY = {
  P1: "P1",
  P2: "P2",
  P3: "P3"
};

export const SLA_RULES = {
  P1: { responseHours: 4, closureHours: 24, label: "Critical / client raised" },
  P2: { responseHours: 24, closureHours: 48, label: "Critical plant" },
  P3: { responseHours: 72, closureHours: 120, label: "Monitor / planned" }
};

export const PLACEMENT_BUCKETS = [
  "Reception / Lobby",
  "Workstations / Open Office",
  "Meeting Rooms / Cabins",
  "Cafeteria / Breakout",
  "Corridors / Common Areas",
  "Feature Zone"
];

export const PLANT_CATEGORIES = [
  { id: "small", label: "Small Tabletop", defaultWaterMl: 150, defaultWeightKg: 0.8 },
  { id: "medium", label: "Medium Indoor", defaultWaterMl: 300, defaultWeightKg: 3 },
  { id: "large", label: "Large Floor Plant", defaultWaterMl: 700, defaultWeightKg: 7 },
  { id: "vertical_garden", label: "Vertical Garden", defaultWaterMl: 250, defaultWeightKg: 2, unit: "sqft_or_panel" },
  { id: "planter_bed", label: "Planter Bed", defaultWaterMl: 400, defaultWeightKg: 4, unit: "sqft_or_bed" }
];

export const INITIAL_DB = {
  users: [
    {
      id: "u-owner-1",
      name: "Avesh Rawat",
      role: ROLES.OWNER,
      phone: "9000000000",
      pin: "1234",
      email: "owner@onescape.in",
      password: "owner123",
      authAliases: [
        { identifier: "9000000000", secret: "1234" },
        { identifier: "owner@onescape.in", secret: "owner123" },
        { identifier: "9999999999", secret: "0000" },
        { identifier: "owner@greenops.demo", secret: "owner123" }
      ],
      cityAccess: ["Bangalore", "Kolkata"],
      clientAccess: ["client-servicenow", "client-mckinsey", "client-marriott"],
      siteAccess: ["site-sn-blr", "site-mck-blr", "site-mar-blr", "site-sn-kol"]
    },
    {
      id: "u-maint-1",
      name: "Ramesh",
      role: ROLES.MAINTENANCE,
      phone: "9876543210",
      pin: "1234",
      cityAccess: ["Bangalore"],
      siteAccess: ["site-sn-blr"]
    },
    {
      id: "u-maint-2",
      name: "Suresh",
      role: ROLES.MAINTENANCE,
      phone: "9876543211",
      pin: "1234",
      cityAccess: ["Bangalore"],
      siteAccess: ["site-mar-blr"]
    },
    {
      id: "u-super-1",
      name: "Bangalore Supervisor",
      role: ROLES.SUPERVISOR,
      phone: "9999999991",
      pin: "4321",
      email: "blr.supervisor@greenops.demo",
      password: "super123",
      notificationEmail: "blr.supervisor@greenops.demo",
      whatsappNumber: "+918799765307",
      notifyOnP1: true,
      notifyOnSLABreach: true,
      notifyOnEscalation: true,
      cityAccess: ["Bangalore"]
    },
    {
      id: "u-super-2",
      name: "Kolkata Supervisor",
      role: ROLES.SUPERVISOR,
      phone: "9999999992",
      pin: "4321",
      email: "kol.supervisor@greenops.demo",
      password: "super123",
      notificationEmail: "kol.supervisor@greenops.demo",
      whatsappNumber: "+918799765307",
      notifyOnP1: true,
      notifyOnSLABreach: true,
      notifyOnEscalation: true,
      cityAccess: ["Kolkata"]
    },
    {
      id: "u-client-marriott",
      name: "Marriott Admin",
      role: ROLES.CLIENT,
      email: "marriott@test.com",
      password: "demo123",
      whatsappNumber: "+918799765307",
      notifyOnWhatsApp: true,
      clientAccess: ["client-marriott"],
      siteAccess: ["site-mar-blr"]
    },
    {
      id: "u-client-servicenow",
      name: "ServiceNow Admin",
      role: ROLES.CLIENT,
      email: "servicenow@test.com",
      password: "demo123",
      whatsappNumber: "+918799765307",
      notifyOnWhatsApp: true,
      clientAccess: ["client-servicenow"],
      siteAccess: ["site-sn-blr", "site-sn-kol"]
    },
    {
      id: "u-client-mckinsey",
      name: "McKinsey Admin",
      role: ROLES.CLIENT,
      email: "mckinsey@test.com",
      password: "demo123",
      whatsappNumber: "+918799765307",
      notifyOnWhatsApp: true,
      clientAccess: ["client-mckinsey"],
      siteAccess: ["site-mck-blr"]
    }
  ],
  clients: [
    { id: "client-servicenow", name: "ServiceNow" },
    { id: "client-mckinsey", name: "McKinsey" },
    { id: "client-marriott", name: "Marriott" }
  ],
  sites: [
    { id: "site-sn-blr", clientId: "client-servicenow", name: "ServiceNow Bangalore Campus", city: "Bangalore", zones: ["Reception", "Drop-off", "Lobby", "Workbay A"], billing: { monthlyAmc: 50000 }, expected_visits_per_month: 4 },
    { id: "site-mck-blr", clientId: "client-mckinsey", name: "McKinsey RMZ Ecoworld", city: "Bangalore", zones: ["Reception", "Boardroom", "Cafe", "Lift Lobby"], billing: { monthlyAmc: 50000 }, expected_visits_per_month: 4 },
    { id: "site-mar-blr", clientId: "client-marriott", name: "Marriott Bellandur", city: "Bangalore", zones: ["Entrance", "Drop-off", "Lobby", "Service Apartment"], billing: { monthlyAmc: 50000 }, expected_visits_per_month: 4 },
    { id: "site-sn-kol", clientId: "client-servicenow", name: "ServiceNow Kolkata Office", city: "Kolkata", zones: ["Reception", "Atrium", "Cafe", "Workbay B"], billing: { monthlyAmc: 50000 }, expected_visits_per_month: 4 }
  ],
  plants: [], scans: [], tickets: [], evidence: [], activityLog: [], notifications: [], invoices: [],
  boqLines: [],
  boqUploads: [],
  serviceLogs: [],
  sustainabilityEntitlements: [],
  formulaAssumptions: [
    { id: "assumption-defaults", defaultRoundTripKm: 30, vehicleKmFactor: 1, wasteBoundary: "Maintained horticulture assets only", updatedAt: "" }
  ],
  frameworkMetricMappings: [],
  vendorSiteProfiles: [],
  offlineQueue: [],
  billingDefaults: { fixedMonthlyAmc: 50000, slaCreditPerBreach: 50 },
  meta: { seeded: false, version: 5 }
};
