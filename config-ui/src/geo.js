/**
 * Geolocation helpers (R17).
 *
 * Everything here is pure so the browser gotchas — secure context, the
 * permission-denied copy, the LAN-IP explainer — are testable without a DOM
 * and without a real device. `app.js` owns the only impure part: the
 * user-gesture-triggered `getCurrentPosition` call itself.
 */

/**
 * `maximumAge: 0` is non-negotiable: a cached fix from another app's earlier
 * request is worthless for "where am I standing right now", and the browser
 * will happily hand one back otherwise. `enableHighAccuracy` asks for GPS
 * rather than the coarse network estimate; the timeout keeps a phone that
 * cannot see the sky from hanging the button forever.
 */
export const GEO_OPTIONS = Object.freeze({
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 15_000,
});

/**
 * Walk-time routing is not allowed from a fix coarser than ~150 m (guiding
 * spec), and the API refuses to place you at all past LOCATE_MAX_ACCURACY_M
 * (default 500 m). Both thresholds are shown to the user so a bad reading
 * reads as "your phone is being vague", not "the app is broken".
 */
export const WALK_ROUTING_MAX_ACCURACY_M = 150;
export const LOCATE_MAX_ACCURACY_M = 500;

/**
 * Geolocation is secure-context-only. Opening the config UI on a LAN IP
 * (http://192.168.1.20:8787, the shape `wrangler dev` hands you) either hides
 * `navigator.geolocation` entirely or denies every call — with no browser UI
 * explaining why. That silent failure is the single most expensive gotcha in
 * this feature, so it gets its own explainer instead of the generic denial copy.
 *
 * @param {{protocol: string, host: string}} location
 * @param {boolean} isSecureContext
 * @param {boolean} hasGeolocationApi
 * @returns {string|null} explainer, or null when the page can ask for a fix
 */
export function insecureContextMessage(location, isSecureContext, hasGeolocationApi) {
  if (isSecureContext && hasGeolocationApi) return null;
  const origin = `${location.protocol}//${location.host}`;
  if (!isSecureContext) {
    return (
      `This page is loaded over ${origin}, which browsers treat as insecure. ` +
      `Location is only available over HTTPS (or on localhost), and on a LAN ` +
      `address it fails without any prompt. Open the deployed https:// address ` +
      `on this phone and try again.`
    );
  }
  return (
    `This browser does not expose the Geolocation API on ${origin}. ` +
    `Try the deployed https:// address in Safari or Chrome.`
  );
}

/**
 * Copy per failure mode. PERMISSION_DENIED gets specific recovery instructions
 * (R17) because it is the only one the user can actually fix, and because
 * "location unavailable" is what a denied permission looks like if you write
 * one generic message for all three.
 *
 * Codes are compared numerically: `GeolocationPositionError` is not defined in
 * a plain Node test environment, and the numeric values are fixed by the spec.
 *
 * @param {{code?: number, message?: string}} error
 */
export function geolocationErrorMessage(error) {
  switch (error?.code) {
    case 1: // PERMISSION_DENIED
      return (
        "Location permission is blocked for this site. On iOS: Settings → " +
        "Safari → Location, or the “aA” menu in the address bar → Website " +
        "Settings. On Android Chrome: tap the lock icon in the address bar → " +
        "Permissions → Location. Then tap the button again."
      );
    case 2: // POSITION_UNAVAILABLE
      return (
        "Your phone could not work out where it is. Underground or indoors " +
        "this is normal — step outside and try again."
      );
    case 3: // TIMEOUT
      return (
        `No fix within ${Math.round(GEO_OPTIONS.timeout / 1000)} seconds. ` +
        "The GPS may still be warming up; try once more."
      );
    default:
      return "Location failed, and the browser did not say why.";
  }
}

/**
 * What a given accuracy is actually good for. Never rounds the accuracy away:
 * the raw metres are what tells you whether to trust the answer.
 *
 * @param {number} accuracyM
 */
export function accuracyVerdict(accuracyM) {
  if (!Number.isFinite(accuracyM)) return "unknown — the browser reported no accuracy";
  if (accuracyM <= WALK_ROUTING_MAX_ACCURACY_M) {
    return `walk times and platform entrances (at or under ${WALK_ROUTING_MAX_ACCURACY_M} m)`;
  }
  if (accuracyM <= LOCATE_MAX_ACCURACY_M) {
    return (
      `finding nearby stops, but too coarse to route from ` +
      `(over ${WALK_ROUTING_MAX_ACCURACY_M} m)`
    );
  }
  return (
    `nothing — past ${LOCATE_MAX_ACCURACY_M} m the API reports an unknown ` +
    `position rather than a wrong one`
  );
}

/**
 * Turns a GeolocationPosition into display strings. Coordinates are shown to
 * 6 decimals (~0.1 m, finer than any fix this will ever see, so nothing is
 * hidden); accuracy is passed through unrounded.
 *
 * @param {{coords: {latitude: number, longitude: number, accuracy: number}, timestamp: number}} position
 */
export function formatFix(position) {
  const { latitude, longitude, accuracy } = position.coords;
  return {
    lat: latitude.toFixed(6),
    lon: longitude.toFixed(6),
    accuracy: `${accuracy} m`,
    accuracyM: accuracy,
    capturedAt: new Date(position.timestamp).toLocaleTimeString(),
    verdict: accuracyVerdict(accuracy),
  };
}
