import { PLACEMENT_BUCKETS, PLANT_CATEGORIES } from "./config.js";
import { nowIso, uid } from "./utils.js";

const REQUIRED_COLUMNS = [
  "clientName",
  "siteName",
  "floor",
  "placementBucket",
  "plantCategory",
  "quantity",
  "waterPerServiceMl",
  "wateringFrequencyPerWeek",
  "maintenanceFrequencyPerMonth"
];

const HEADER_ALIASES = {
  clientName: ["client name", "client", "customer"],
  siteName: ["site name", "site", "location"],
  floor: ["floor / area", "floor", "area", "zone", "floor area"],
  placementBucket: ["placement bucket", "bucket", "placement", "placement zone"],
  plantCategory: ["plant category", "category", "plant type category"],
  quantity: ["quantity", "qty", "count", "plants"],
  waterPerServiceMl: ["water per service", "water per service ml", "water/service", "water ml"],
  wateringFrequencyPerWeek: ["watering frequency", "watering frequency per week", "watering/week", "waterings per week"],
  maintenanceFrequencyPerMonth: ["maintenance frequency", "maintenance frequency per month", "maintenance/month", "services per month"],
  plantSpecies: ["plant species", "species", "plant variety", "plant name"],
  planterType: ["planter type", "planter"],
  ownershipType: ["ownership type", "ownership"],
  installDate: ["install date", "installation date"],
  notes: ["notes", "note", "remarks"]
};

function normalizeHeader(value = "") {
  return String(value).trim().toLowerCase().replace(/\s+/g, " ");
}

function splitCsvLine(line = "") {
  const cells = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && quoted && next === '"') {
      value += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(value.trim());
      value = "";
    } else {
      value += char;
    }
  }
  cells.push(value.trim());
  return cells;
}

function parseCsvText(text = "") {
  const lines = String(text).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  const headers = splitCsvLine(lines[0]).map(normalizeHeader);
  return lines.slice(1).map(line => {
    const cells = splitCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
  });
}

function rowsFromInput(rows) {
  if (typeof rows === "string") return parseCsvText(rows);
  if (!Array.isArray(rows)) return [];
  if (!rows.length) return [];
  if (Array.isArray(rows[0])) {
    const headers = rows[0].map(normalizeHeader);
    return rows.slice(1).map(row => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
  }
  return rows;
}

function valueFor(row, key) {
  const aliases = HEADER_ALIASES[key] || [key];
  const direct = row[key];
  if (direct !== undefined) return direct;
  const normalizedRow = Object.fromEntries(Object.entries(row).map(([k, v]) => [normalizeHeader(k), v]));
  for (const alias of aliases) {
    const found = normalizedRow[normalizeHeader(alias)];
    if (found !== undefined) return found;
  }
  return "";
}

function numberValue(value, fallback = 0) {
  const n = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : fallback;
}

function resolvePlacementBucket(value = "") {
  const clean = String(value).trim();
  const match = PLACEMENT_BUCKETS.find(bucket => bucket.toLowerCase() === clean.toLowerCase());
  return match || clean;
}

function resolvePlantCategory(value = "") {
  const clean = String(value).trim().toLowerCase();
  const match = PLANT_CATEGORIES.find(category => category.id === clean || category.label.toLowerCase() === clean);
  return match?.id || clean.replace(/\s+/g, "_");
}

function categoryDefaults(categoryId) {
  return PLANT_CATEGORIES.find(category => category.id === categoryId) || PLANT_CATEGORIES[1];
}

export function parseBoqCsvOrSheet(rows) {
  return rowsFromInput(rows).map(normalizeBoqRow);
}

export function normalizeBoqRow(row = {}) {
  const plantCategory = resolvePlantCategory(valueFor(row, "plantCategory"));
  const defaults = categoryDefaults(plantCategory);
  return {
    clientName: String(valueFor(row, "clientName") || "").trim(),
    siteName: String(valueFor(row, "siteName") || "").trim(),
    floor: String(valueFor(row, "floor") || "").trim(),
    placementBucket: resolvePlacementBucket(valueFor(row, "placementBucket")),
    plantCategory,
    plantSpecies: String(valueFor(row, "plantSpecies") || "").trim(),
    quantity: numberValue(valueFor(row, "quantity"), 0),
    waterPerServiceMl: numberValue(valueFor(row, "waterPerServiceMl"), defaults?.defaultWaterMl || 300),
    wateringFrequencyPerWeek: numberValue(valueFor(row, "wateringFrequencyPerWeek"), 1),
    maintenanceFrequencyPerMonth: numberValue(valueFor(row, "maintenanceFrequencyPerMonth"), 4),
    planterType: String(valueFor(row, "planterType") || "").trim(),
    ownershipType: String(valueFor(row, "ownershipType") || "").trim(),
    installDate: String(valueFor(row, "installDate") || "").trim(),
    notes: String(valueFor(row, "notes") || "").trim()
  };
}

export function validateBoqRows(rows = []) {
  const acceptedRows = [];
  const rejectedRows = [];
  rows.forEach((row, index) => {
    const normalized = normalizeBoqRow(row);
    const errors = [];
    REQUIRED_COLUMNS.forEach(key => {
      if (["quantity", "waterPerServiceMl", "wateringFrequencyPerWeek", "maintenanceFrequencyPerMonth"].includes(key)) {
        if (Number(normalized[key]) <= 0) errors.push(`${key} must be greater than 0`);
      } else if (!String(normalized[key] || "").trim()) {
        errors.push(`${key} is required`);
      }
    });
    if (!PLACEMENT_BUCKETS.includes(normalized.placementBucket)) errors.push("placementBucket must match a configured bucket");
    if (!PLANT_CATEGORIES.some(category => category.id === normalized.plantCategory)) errors.push("plantCategory must match a configured category");
    const wrapped = { ...normalized, rowNumber: index + 1, errors };
    if (errors.length) rejectedRows.push(wrapped);
    else acceptedRows.push(wrapped);
  });
  return { acceptedRows, rejectedRows };
}

export function applyBoqRowsToDb(db, rows, uploadedBy, siteId) {
  db.boqLines ||= [];
  db.boqUploads ||= [];
  const site = db.sites?.find(s => s.id === siteId);
  const normalizedRows = rows.map(normalizeBoqRow);
  const { acceptedRows, rejectedRows } = validateBoqRows(normalizedRows);
  const previousVersions = (db.boqUploads || []).filter(upload => upload.siteId === siteId).map(upload => Number(upload.version || 0));
  const version = (Math.max(0, ...previousVersions) || 0) + 1;
  const upload = {
    id: uid("boq"),
    siteId,
    fileName: "Pasted CSV",
    uploadedBy,
    uploadedAt: nowIso(),
    version,
    rowCount: normalizedRows.length,
    acceptedRows: acceptedRows.length,
    rejectedRows: rejectedRows.length,
    status: "draft",
    notes: rejectedRows.length ? `${rejectedRows.length} rejected row(s) need correction.` : "Ready to activate."
  };
  db.boqUploads.push(upload);
  acceptedRows.forEach(row => {
    db.boqLines.push({
      id: uid("boq-line"),
      clientId: site?.clientId || "",
      siteId,
      floor: row.floor,
      placementBucket: row.placementBucket,
      plantCategory: row.plantCategory,
      plantSpecies: row.plantSpecies,
      quantity: row.quantity,
      waterPerServiceMl: row.waterPerServiceMl,
      wateringFrequencyPerWeek: row.wateringFrequencyPerWeek,
      maintenanceFrequencyPerMonth: row.maintenanceFrequencyPerMonth,
      planterType: row.planterType,
      ownershipType: row.ownershipType,
      installDate: row.installDate,
      notes: row.notes,
      sourceUploadId: upload.id,
      active: false,
      version,
      createdBy: uploadedBy,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
  });
  return { db, upload, acceptedRows, rejectedRows };
}

export function baselineForSite(db, siteId) {
  return (db.boqLines || []).filter(line => line.siteId === siteId && line.active);
}

export function baselineForBucket(db, siteId, floor, placementBucket) {
  return baselineForSite(db, siteId).filter(line =>
    (!floor || line.floor === floor) &&
    (!placementBucket || line.placementBucket === placementBucket)
  );
}

export function expectedWaterForBaseline(rows = []) {
  return rows.reduce((sum, row) =>
    sum + Number(row.quantity || 0) * Number(row.waterPerServiceMl || 0) * Number(row.wateringFrequencyPerWeek || 0), 0);
}

export function expectedServiceEventsForBaseline(rows = [], period = "month") {
  const multiplier = period === "week" ? 0.25 : period === "quarter" ? 3 : 1;
  return rows.reduce((sum, row) => sum + Number(row.quantity || 0) * Number(row.maintenanceFrequencyPerMonth || 0) * multiplier, 0);
}
