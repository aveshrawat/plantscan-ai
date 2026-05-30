import { nowIso } from "./utils.js";

export function getCurrentGps() {
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      pos => resolve({
        gpsLat: pos.coords.latitude,
        gpsLng: pos.coords.longitude,
        gpsAccuracy: pos.coords.accuracy,
        gpsCapturedAt: nowIso()
      }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 7000, maximumAge: 60000 }
    );
  });
}

export function buildCaptureMetadata({ siteId, bucketId, source }) {
  return {
    siteId,
    bucketId,
    captureSource: source || "phone_camera",
    capturedAt: nowIso()
  };
}

export function validateAssignedSiteGps({ gps, site }) {
  return {
    accepted: Boolean(gps && site),
    reason: gps ? "GPS captured for audit metadata." : "GPS permission was not granted or unavailable."
  };
}
