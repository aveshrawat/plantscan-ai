export const APP = {
  name: "GreenOps ITSM",
  storageKey: "greenops_itsm_v1",
  sessionRoleKey: "greenops_role_v1",
  sessionTabKey: "greenops_tab_v1",
  diagnosisEndpoint: "/api/diagnose"
};

export const ROLES = {
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
  CLOSED: "Closed"
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

export const INITIAL_DB = {
  users: [
    { id: "u-maint-1", name: "Maintenance Staff", role: ROLES.MAINTENANCE, cityAccess: ["Bangalore", "Kolkata", "Hyderabad"] },
    { id: "u-super-1", name: "Operations Manager", role: ROLES.SUPERVISOR, cityAccess: ["Bangalore", "Kolkata", "Hyderabad"] },
    { id: "u-client-1", name: "Client Viewer", role: ROLES.CLIENT, clientAccess: ["client-servicenow", "client-mckinsey", "client-marriott"] }
  ],
  clients: [
    { id: "client-servicenow", name: "ServiceNow" },
    { id: "client-mckinsey", name: "McKinsey" },
    { id: "client-marriott", name: "Marriott" }
  ],
  sites: [
    { id: "site-sn-blr", clientId: "client-servicenow", name: "ServiceNow Bangalore Campus", city: "Bangalore" },
    { id: "site-mck-blr", clientId: "client-mckinsey", name: "McKinsey RMZ Ecoworld", city: "Bangalore" },
    { id: "site-mar-blr", clientId: "client-marriott", name: "Marriott Bellandur", city: "Bangalore" },
    { id: "site-sn-kol", clientId: "client-servicenow", name: "ServiceNow Kolkata Office", city: "Kolkata" }
  ],
  plants: [], scans: [], tickets: [], evidence: [], meta: { seeded: false, version: 1 }
};
