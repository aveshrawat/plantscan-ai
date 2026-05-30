import { getDb, tx } from "./store.js";
import { nowIso, uid } from "./utils.js";

function online() {
  return typeof navigator === "undefined" ? true : navigator.onLine !== false;
}

export function queueOfflineRecord(recordType, payload) {
  const tempId = payload?.tempId || uid("tmp");
  tx(d => {
    d.offlineQueue ||= [];
    d.offlineQueue.push({
      tempId,
      recordType,
      payload: { ...payload, tempId },
      status: "pending",
      attempts: 0,
      createdAt: nowIso(),
      lastAttemptAt: "",
      serverId: "",
      error: ""
    });
    return d;
  });
  return tempId;
}

export function getPendingOfflineRecords() {
  return (getDb().offlineQueue || []).filter(record => record.status === "pending" || record.status === "failed");
}

export function markRecordSynced(tempId, serverId) {
  tx(d => {
    const record = (d.offlineQueue || []).find(item => item.tempId === tempId);
    if (record) Object.assign(record, { status: "synced", serverId, error: "", lastAttemptAt: nowIso() });
    const log = (d.serviceLogs || []).find(item => item.tempId === tempId);
    if (log) Object.assign(log, { syncStatus: "synced", serverCreatedAt: nowIso(), syncAttempts: Number(log.syncAttempts || 0) + 1 });
    return d;
  });
}

export function markRecordFailed(tempId, error) {
  tx(d => {
    const record = (d.offlineQueue || []).find(item => item.tempId === tempId);
    if (record) Object.assign(record, { status: "failed", error: String(error || "Sync failed"), attempts: Number(record.attempts || 0) + 1, lastAttemptAt: nowIso() });
    const log = (d.serviceLogs || []).find(item => item.tempId === tempId);
    if (log) Object.assign(log, { syncStatus: "failed", syncAttempts: Number(log.syncAttempts || 0) + 1 });
    return d;
  });
}

export async function syncPendingRecords() {
  if (!online()) return { synced: 0, failed: 0, offline: true };
  const pending = getPendingOfflineRecords();
  pending.forEach(record => markRecordSynced(record.tempId, `local-${record.tempId}`));
  return { synced: pending.length, failed: 0, offline: false };
}

export function expireOldOfflineRecords(maxHours = 48) {
  const cutoff = Date.now() - Number(maxHours || 48) * 36e5;
  tx(d => {
    d.offlineQueue = (d.offlineQueue || []).filter(record => {
      if (record.status === "synced") return true;
      const createdAt = new Date(record.createdAt || 0).getTime();
      return !createdAt || createdAt >= cutoff;
    });
    (d.serviceLogs || []).forEach(log => {
      if (log.syncStatus !== "synced") {
        const localCreated = new Date(log.localCreatedAt || 0).getTime();
        if (localCreated && localCreated < cutoff) log.syncStatus = "failed";
      }
    });
    return d;
  });
}
