export const APP = {
  name: "GreenOps ITSM",
  storageKey: "greenops_itsm_v2",
  sessionUserKey: "greenops_user_v2",
  sessionRoleKey: "greenops_role_v1",
  sessionTabKey: "greenops_tab_v1",
  diagnosisEndpoint: "/api/diagnose",
  verifyEvidenceEndpoint: "/api/verify-evidence"
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
    {
      id: "u-owner-1",
      name: "Avesh Rawat",
      role: ROLES.OWNER,
      phone: "9999999999",
      pin: "0000",
      email: "owner@greenops.demo",
      password: "owner123",
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
      cityAccess: ["Kolkata"]
    },
    {
      id: "u-client-marriott",
      name: "Marriott Admin",
      role: ROLES.CLIENT,
      email: "marriott@test.com",
      password: "demo123",
      clientAccess: ["client-marriott"],
      siteAccess: ["site-mar-blr"]
    },
    {
      id: "u-client-servicenow",
      name: "ServiceNow Admin",
      role: ROLES.CLIENT,
      email: "servicenow@test.com",
      password: "demo123",
      clientAccess: ["client-servicenow"],
      siteAccess: ["site-sn-blr", "site-sn-kol"]
    },
    {
      id: "u-client-mckinsey",
      name: "McKinsey Admin",
      role: ROLES.CLIENT,
      email: "mckinsey@test.com",
      password: "demo123",
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
    { id: "site-sn-blr", clientId: "client-servicenow", name: "ServiceNow Bangalore Campus", city: "Bangalore", zones: ["Reception", "Drop-off", "Lobby", "Workbay A"] },
    { id: "site-mck-blr", clientId: "client-mckinsey", name: "McKinsey RMZ Ecoworld", city: "Bangalore", zones: ["Reception", "Boardroom", "Cafe", "Lift Lobby"] },
    { id: "site-mar-blr", clientId: "client-marriott", name: "Marriott Bellandur", city: "Bangalore", zones: ["Entrance", "Drop-off", "Lobby", "Service Apartment"] },
    { id: "site-sn-kol", clientId: "client-servicenow", name: "ServiceNow Kolkata Office", city: "Kolkata", zones: ["Reception", "Atrium", "Cafe", "Workbay B"] }
  ],
  plants: [], scans: [], tickets: [], evidence: [], meta: { seeded: false, version: 2 }
};
