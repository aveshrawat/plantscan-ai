import { HEALTH } from "./config.js";
import { clamp } from "./utils.js";

export const healthCategory = score => {
  const s = clamp(score, 0, 10);
  if (s >= 7) return HEALTH.HEALTHY;
  if (s >= 6) return HEALTH.MONITOR;
  return HEALTH.CRITICAL;
};
export const healthClass = category => category === HEALTH.CRITICAL ? "critical" : category === HEALTH.MONITOR ? "monitor" : "good";
export const scorePct = score => Math.round(clamp(score, 0, 10) * 10);
export const healthSummary = scans => {
  const latestByPlant = new Map();
  scans.forEach(scan => latestByPlant.set(scan.plantId, scan));
  const latest = [...latestByPlant.values()];
  const avg = latest.length ? latest.reduce((sum, s) => sum + Number(s.score || 0), 0) / latest.length : 0;
  return {
    total: latest.length,
    avg: Number(avg.toFixed(1)),
    healthy: latest.filter(s => s.category === HEALTH.HEALTHY).length,
    monitor: latest.filter(s => s.category === HEALTH.MONITOR).length,
    critical: latest.filter(s => s.category === HEALTH.CRITICAL).length
  };
};
export const latestScanByPlant = scans => {
  const sorted = [...scans].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  return sorted.reduce((map, scan) => ({ ...map, [scan.plantId]: scan }), {});
};
export function trendByDay(scans, days = 30) {
  const since = Date.now() - days * 86400000;
  const buckets = scans.filter(s => new Date(s.createdAt).getTime() >= since).reduce((acc, s) => {
    const key = s.createdAt.slice(0, 10);
    acc[key] ||= []; acc[key].push(Number(s.score || 0)); return acc;
  }, {});
  return Object.entries(buckets).sort(([a], [b]) => a.localeCompare(b)).map(([date, values]) => ({ date, avg: +(values.reduce((a, b) => a + b, 0) / values.length).toFixed(1), count: values.length }));
}
