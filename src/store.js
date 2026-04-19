import { APP, INITIAL_DB } from "./config.js";
import { uid, nowIso } from "./utils.js";

const clone = value => JSON.parse(JSON.stringify(value));
let db = load();

function load() {
  try {
    const stored = localStorage.getItem(APP.storageKey);
    return stored ? { ...clone(INITIAL_DB), ...JSON.parse(stored) } : clone(INITIAL_DB);
  } catch {
    return clone(INITIAL_DB);
  }
}
function save() { localStorage.setItem(APP.storageKey, JSON.stringify(db)); }
export const getDb = () => clone(db);
export const setDb = next => { db = clone(next); save(); return getDb(); };
export const tx = fn => { const draft = clone(db); const result = fn(draft) ?? draft; db = result; save(); window.dispatchEvent(new CustomEvent("db:changed")); return getDb(); };
export const resetDb = () => { db = clone(INITIAL_DB); save(); window.dispatchEvent(new CustomEvent("db:changed")); };

export function seedDemoData() {
  tx(d => {
    if (d.meta.seeded) return d;
    const siteIds = d.sites.map(s => s.id);
    const plantTypes = ["Areca Palm", "Money Plant", "Peace Lily", "ZZ Plant", "Ficus Lyrata", "Philodendron", "Aglaonema", "Dracaena"];
    const zones = ["Reception", "Cafe", "Boardroom", "Lift Lobby", "Workbay A", "Workbay B", "Drop-off", "Atrium"];
    const offsets = [22, 18, 14, 10, 7, 4, 2, 1];
    siteIds.forEach((siteId, sIndex) => {
      Array.from({ length: 10 }).forEach((_, i) => {
        const score = [8.4, 7.5, 6.6, 5.8, 5.1, 8.9, 6.2, 7.1, 4.4, 8.0][(i + sIndex) % 10];
        const plant = { id: uid("plt"), siteId, type: plantTypes[(i + sIndex) % plantTypes.length], zone: zones[i % zones.length], latestScore: score, latestCategory: score >= 7 ? "Healthy" : score >= 6 ? "Monitor" : "Critical", createdAt: nowIso() };
        d.plants.push(plant);
        const createdAt = new Date(Date.now() - offsets[(i + sIndex) % offsets.length] * 86400000).toISOString();
        d.scans.push({ id: uid("scn"), plantId: plant.id, siteId, score, category: plant.latestCategory, diagnosis: score < 6 ? "Visible stress and decline pattern detected" : score < 7 ? "Mild stress, monitor closely" : "Plant appears stable", rootCause: score < 6 ? "Likely watering/light imbalance" : "Routine observation", instructions: score < 6 ? ["Isolate from AC draft", "Check soil moisture", "Remove damaged leaves", "Recheck within 48 hours"] : ["Continue scheduled maintenance"], image: "", createdAt, createdBy: "u-maint-1" });
        if (score < 6) d.tickets.push({ id: uid("tkt"), plantId: plant.id, siteId, priority: score < 4.5 ? "P1" : "P2", status: i % 3 === 0 ? "In Progress" : "Open", source: "Auto Scan", issue: `Critical plant health: ${plant.type}`, assignedTo: "Maintenance Staff", createdAt, startedAt: i % 3 === 0 ? new Date(Date.now() - 18 * 36e5).toISOString() : null, closedAt: null, closureEvidence: "", closureRemark: "", createdBy: "system" });
      });
    });
    d.meta.seeded = true; return d;
  });
}
