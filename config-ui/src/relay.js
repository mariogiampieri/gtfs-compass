/**
 * Sending this phone's position to the account's devices (U14; R11, R17).
 *
 * The network and copy half only — nothing here touches `document`, so every
 * decision this file makes is testable without a browser. `app.js` owns the
 * button and the one impure call (`getCurrentPosition`).
 *
 * Three things are worth reading as design rather than plumbing:
 *
 *  - **The request names no device.** The session says whose position this is
 *    and the server's grant list says which boards receive it, so there is no
 *    device selector on this screen and no id for a client to get wrong. That
 *    is R11, and it is why the body below has three fields and no fourth.
 *
 *  - **Batching is the client's job.** The server budget is a backstop, not the
 *    mechanism: `shouldPost` holds the wearable convention of no more than
 *    about one post a minute, so a user leaning on the button spends their own
 *    patience rather than the account's daily cap.
 *
 *  - **The success copy says how many boards received it, including zero, and
 *    how many actually took it.** "Sent" with the grant switched off everywhere
 *    would be true about the request and false about what the user was actually
 *    asking for; "each keeps this position" when the server kept a more
 *    accurate one it already had would be false about the boards.
 */

import { CSRF_HEADER } from "./auth.js";

export const RELAY_PATH = "/v1/locate/ref";

/** The wearable convention (plan): no more than about one post a minute. */
export const MIN_POST_INTERVAL_MS = 60_000;

/**
 * How far off "now" a `GeolocationPosition.timestamp` may be before this drops
 * it and lets the server stamp its own receipt time.
 *
 * The value is supposed to be wall-clock milliseconds, and mostly is — but a
 * browser handing back a monotonic clock reading instead would produce a
 * capture time in 1970, and a phone whose clock is minutes fast would produce
 * one in the future. Both are refused by the server (deliberately: silently
 * clamping a millisecond value would file a fix from the year 58000 as
 * "captured just now"), so the client drops what it cannot vouch for rather
 * than turning a good fix into a 400. Matches the server's skew tolerance.
 */
export const MAX_TIMESTAMP_DRIFT_S = 60;

export const RELAY_SIGNED_OUT_MESSAGE =
  "Sign in first. Your position goes to your own devices, so the server has to know whose they are.";
export const RELAY_OFFLINE_MESSAGE = "Could not reach the server. Nothing was sent.";
export const RELAY_RATE_LIMITED_MESSAGE =
  "That is more position updates than this account is allowed today. Nothing was sent — try again later.";
export const RELAY_FAILED_MESSAGE = "Could not send your position. Nothing was sent.";
export const RELAY_THROTTLED_MESSAGE =
  "Sent less than a minute ago — your devices already have that position. Wait a moment before sending a fresher one.";
/**
 * Zero recipients is a success the user still needs told about: the fix was
 * accepted and went nowhere, because no board holds the grant. Naming the
 * toggle is what makes the message actionable.
 */
export const RELAY_NO_DEVICES_MESSAGE =
  "Sent, but no device is set to receive it. Turn on “Your phone's live position” for a board under Your devices.";

/**
 * Every board was targeted and none took the fix: each already holds a more
 * accurate position from the last couple of minutes, and the server keeps the
 * better one. Saying "sent" and nothing else would be false about the sentence
 * that follows it — the boards are showing an *older* reading, on purpose.
 */
export const RELAY_KEPT_BETTER_MESSAGE =
  "Sent, but your devices are keeping a more accurate position they already had. This reading was less precise, so nothing changed on them.";

/**
 * What the send actually did.
 *
 * Two numbers, because the server reports two: how many boards were targeted,
 * and how many took this position. They differ when the refinement fires — a
 * board holding a strictly more accurate recent fix keeps it — and that is
 * exactly the case where "each keeps this position until a newer one arrives"
 * would be a lie about a board still showing where the phone was three streets
 * ago.
 *
 * `stored` defaults to `devices` so a server that does not report it (or a body
 * that did not parse) reads as a plain delivery rather than as a suppression.
 *
 * @param {number} devices
 * @param {number} [stored]
 */
export function relayedMessage(devices, stored = devices) {
  if (!devices) return RELAY_NO_DEVICES_MESSAGE;
  const noun = devices === 1 ? "1 device" : `${devices} devices`;
  if (stored >= devices) {
    return `Sent to ${noun}. Each keeps this position until a newer one arrives, and loses it the moment you turn the permission off.`;
  }
  if (stored <= 0) return RELAY_KEPT_BETTER_MESSAGE;
  const took = stored === 1 ? "1 took it" : `${stored} took it`;
  return `Sent to ${noun}; ${took}. The rest are keeping a more accurate position they already had.`;
}

/**
 * Is the cadence budget spent? `null`/absent means nothing has been sent yet.
 *
 * @param {number|null|undefined} lastPostedAtMs
 * @param {number} [nowMs]
 */
export function shouldPost(lastPostedAtMs, nowMs = Date.now()) {
  if (typeof lastPostedAtMs !== "number" || !Number.isFinite(lastPostedAtMs)) return true;
  // A clock that jumped backwards must not lock the button out for the length
  // of the jump: anything not plausibly in the past is treated as "send now".
  if (lastPostedAtMs > nowMs) return true;
  return nowMs - lastPostedAtMs >= MIN_POST_INTERVAL_MS;
}

/**
 * Epoch **seconds** for the capture time, or null when the browser's timestamp
 * cannot be vouched for (see `MAX_TIMESTAMP_DRIFT_S`).
 *
 * @param {number} timestampMs
 * @param {number} [nowMs]
 */
export function capturedAtSeconds(timestampMs, nowMs = Date.now()) {
  if (typeof timestampMs !== "number" || !Number.isFinite(timestampMs)) return null;
  const seconds = Math.floor(timestampMs / 1000);
  const nowS = Math.floor(nowMs / 1000);
  if (Math.abs(seconds - nowS) > MAX_TIMESTAMP_DRIFT_S) return null;
  return seconds;
}

/**
 * The request body for one relay post. `accuracy` is sent raw and ungated —
 * the API stores whatever the phone reports and gates it at read time, so a
 * coarse fix is the server's decision to skip, never the client's to hide.
 *
 * @param {{coords: {latitude: number, longitude: number, accuracy: number}, timestamp: number}} position
 * @param {number} [nowMs]
 */
export function fixBody(position, nowMs = Date.now()) {
  const { latitude, longitude, accuracy } = position.coords;
  const body = { relay: true, lat: latitude, lon: longitude };
  if (Number.isFinite(accuracy)) body.accuracy = accuracy;
  const capturedAt = capturedAtSeconds(position.timestamp, nowMs);
  if (capturedAt !== null) body.captured_at = capturedAt;
  return body;
}

/**
 * Post one fix. Every outcome is a state plus the sentence to show — the
 * caller never inspects a status code.
 *
 * @param {{coords: object, timestamp: number}} position
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{state:"sent"|"signed-out"|"rate-limited"|"error", devices?: number, stored?: number, message: string}>}
 */
export async function postFix(position, fetchImpl) {
  const doFetch = fetchImpl ?? globalThis.fetch.bind(globalThis);
  let res;
  try {
    res = await doFetch(RELAY_PATH, {
      method: "POST",
      // Same origin as /v1/*, so the session cookie is first-party (R16).
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", [CSRF_HEADER]: "1" },
      body: JSON.stringify(fixBody(position)),
    });
  } catch {
    return { state: "error", message: RELAY_OFFLINE_MESSAGE };
  }
  if (res.status === 401) return { state: "signed-out", message: RELAY_SIGNED_OUT_MESSAGE };
  if (res.status === 429) return { state: "rate-limited", message: RELAY_RATE_LIMITED_MESSAGE };
  if (!res.ok) return { state: "error", message: RELAY_FAILED_MESSAGE };

  let devices = 0;
  let stored = 0;
  try {
    const payload = await res.json();
    devices = Number(payload?.relayed?.devices) || 0;
    const written = Number(payload?.relayed?.stored);
    // Absent rather than zero: a server that does not report the distinction
    // has not told us the fix was suppressed, so the honest reading is "all of
    // them", not "none of them".
    stored = Number.isFinite(written) ? written : devices;
  } catch {
    // A 200 whose body did not parse still relayed the fix; the counts are the
    // only thing lost, and reporting "sent to 0 devices" would be a lie about
    // the grant rather than about the parse.
    return { state: "sent", devices: 0, stored: 0, message: "Sent." };
  }
  return { state: "sent", devices, stored, message: relayedMessage(devices, stored) };
}
