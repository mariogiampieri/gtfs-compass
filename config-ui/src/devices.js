/**
 * Pairing entry and the device list — the network and copy half (U10; R8, R9,
 * R18).
 *
 * Everything decided lives here so it can be tested without a browser;
 * `devices-view.js` owns the DOM and `app.js` owns the wiring. Nothing in this
 * file touches `document`.
 *
 * The copy is part of the security design, not decoration. Two places say so
 * explicitly:
 *
 *   - **The confirm screen** (R8, RFC 8628 §5.4). Its job is to stop somebody
 *     being talked into typing a code read to them over the phone, so it says
 *     where a legitimate code comes from — a device you are physically holding
 *     — and it presents the device's name as a *claim the device made*, never
 *     as a fact this app checked.
 *
 *   - **The `read:fix` toggle** (R9/R11). It is not a third checkbox alongside
 *     two boring ones: granting it is the moment a board starts receiving the
 *     owner's live position, and revoking it deletes the position already
 *     delivered. The copy says that in those words, because a user who does not
 *     know what a grant does has not consented to it.
 */

import { CSRF_HEADER } from "./auth.js";

export const CLAIM_PATH = "/v1/pair/claim";
export const DEVICES_PATH = "/v1/config/devices";

/** RFC 8628 §6.1's consonant alphabet, and the length `pair.ts` mints. */
export const USER_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";
export const USER_CODE_LENGTH = 8;

/**
 * The scopes, in the order they are shown, with what each one actually means
 * for the person deciding.
 *
 * `read:fix` carries a `warning` the other two do not, and the difference is
 * the point: departures and configuration are what the board is *for*, and the
 * location grant is a separate decision with a separate consequence.
 */
export const SCOPES = Object.freeze([
  Object.freeze({
    id: "read:departures",
    label: "Arrival times",
    summary: "Read departures for your saved stops. This is what the board displays.",
  }),
  Object.freeze({
    id: "read:config",
    label: "Its own settings",
    summary: "Read its own stop list and walk times — this board's settings, not any other's.",
  }),
  Object.freeze({
    id: "read:fix",
    label: "Your phone's live position",
    summary:
      "Off unless you turn it on. Pairing never grants it: a board on a shelf has no reason to know where you are.",
    warning:
      "Turning this on means this device will receive your phone's live position, every time your phone sends one, until you turn it back off. Turning it off stops that and deletes the position already sent to this device.",
  }),
]);

/** Defense in depth: the server caps device text at rest, and this caps display. */
export const MAX_DISPLAY_NAME = 64;
export const MAX_DISPLAY_FW = 32;

/** What a device with no self-reported name is called in the list. */
export const UNNAMED_DEVICE = "Unnamed device";
export const UNKNOWN_FW = "not reported";

/** R8: the metadata is whatever the device said it was, and the UI says so. */
export const UNTRUSTED_NOTE = "as reported by the device — not verified";

/**
 * The anti-phishing line on the confirm screen (R8). Deliberately concrete
 * about the attack rather than a generic "are you sure?": the failure mode is a
 * code arriving by phone call or message, and naming that is what makes the
 * screen a control instead of a speed bump.
 */
export const CONFIRM_WARNING =
  "Only continue if this code came off the screen of a device you are holding. If someone sent it to you or read it out over the phone, stop — pairing it would attach their board to your account.";

export const SIGNED_OUT_MESSAGE = "Sign in first, then pair your device.";
export const OFFLINE_MESSAGE = "Could not reach the server. Try again in a moment.";
export const CODE_INVALID_MESSAGE =
  "That does not look like a pairing code. It is eight letters, shown on the device as BCDF-GHJK.";
export const CODE_UNKNOWN_MESSAGE =
  "No pending pairing request for that code. Codes last five minutes — ask the device for a fresh one.";
export const CLAIM_RATE_LIMITED_MESSAGE =
  "Too many pairing attempts. Wait a while before trying again.";
export const PAIRED_MESSAGE =
  "Paired. The device picks up its own credential the next time it checks in — it may take a few seconds to appear below.";
export const DEVICES_UNAVAILABLE_MESSAGE = "Could not load your devices. Try again in a moment.";
export const UNPAIRED_MESSAGE =
  "Unpaired. That board's credential stops working immediately, and any position it was sent has been deleted.";
export const SCOPE_CONFLICT_MESSAGE =
  "This device changed somewhere else. Reloading the list to show what it actually holds.";
export const SCOPE_FAILED_MESSAGE = "Could not change that permission. Nothing was changed.";

/**
 * Normalize what the human typed the way the server does: case and separators
 * are presentation. Returns null for anything that is not code-shaped.
 *
 * Only separators are stripped — never "every character not in the alphabet".
 * Dropping stray characters could silently re-align a typo into a *different
 * valid code*, which is a claim against a pairing request the user never
 * looked at. Same rule as `normalizeUserCode` in `api/src/routes/pair.ts`; a
 * miss is a miss.
 *
 * @param {string} raw
 * @returns {string|null}
 */
export function normalizeCode(raw) {
  const compact = String(raw ?? "")
    .replace(/[-\s‐-―−]/gu, "")
    .toUpperCase();
  if (compact.length !== USER_CODE_LENGTH) return null;
  for (const ch of compact) {
    if (!USER_CODE_ALPHABET.includes(ch)) return null;
  }
  return compact;
}

/** `BCDFGHJK` -> `BCDF-GHJK`, for reading back what the device shows. */
export function formatCode(compact) {
  const half = Math.ceil(USER_CODE_LENGTH / 2);
  return `${compact.slice(0, half)}-${compact.slice(half)}`;
}

/**
 * Relative time for `last_seen` and `paired_at`. Relative rather than a
 * timestamp because the question the field answers is "is this board still
 * calling home", and "4 minutes ago" answers it without the reader doing
 * timezone arithmetic. Locale-free by construction, so it is also testable.
 *
 * @param {number|null|undefined} epochS
 * @param {number} [nowMs]
 */
export function formatAge(epochS, nowMs = Date.now()) {
  if (typeof epochS !== "number" || !Number.isFinite(epochS)) return "never";
  const seconds = Math.floor(nowMs / 1000) - epochS;
  // A stamp in the future is clock skew, not the future; say the honest thing.
  if (seconds < 90) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

/** Length-cap for display, with a visible ellipsis rather than a silent cut. */
export function cap(text, limit) {
  const value = String(text ?? "");
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

function doFetch(fetchImpl) {
  return fetchImpl ?? globalThis.fetch.bind(globalThis);
}

/** Every state-changing call: same-origin credentials plus the CSRF header. */
function writeInit(method, body) {
  const init = {
    method,
    credentials: "same-origin",
    headers: { [CSRF_HEADER]: "1" },
  };
  if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  return init;
}

/* -------------------------------------------------------------------------- */
/* Claiming a code (R8)                                                        */
/* -------------------------------------------------------------------------- */

/**
 * One claim call. Without `confirm` the server previews the device and answers
 * 409; with it, the pairing is bound.
 *
 * The two calls are one function because they are one server route with one
 * failure vocabulary — and because keeping them together makes it structurally
 * obvious that the confirm step is not optional client-side politeness: a UI
 * that skipped the preview would still have to send `confirm: true`, and the
 * screen it skipped is the control.
 *
 * @param {string} rawCode
 * @param {{confirm?: boolean, fetchImpl?: typeof fetch}} [opts]
 * @returns {Promise<{state:"confirm"|"paired"|"error", code?: string, device?: object, message?: string}>}
 */
export async function claimCode(rawCode, opts = {}) {
  const code = normalizeCode(rawCode);
  // Refused before it is sent: the server charges a per-account daily attempt
  // budget for anything code-shaped, and a typo must not spend it.
  if (!code) return { state: "error", message: CODE_INVALID_MESSAGE };

  const body = opts.confirm ? { user_code: code, confirm: true } : { user_code: code };
  let res;
  try {
    res = await doFetch(opts.fetchImpl)(CLAIM_PATH, writeInit("POST", body));
  } catch {
    return { state: "error", message: OFFLINE_MESSAGE };
  }

  if (res.status === 409) {
    const payload = await readJson(res);
    return { state: "confirm", code, device: payload?.device ?? {} };
  }
  if (res.ok) {
    const payload = await readJson(res);
    return { state: "paired", code, device: payload?.device ?? {}, message: PAIRED_MESSAGE };
  }
  if (res.status === 401 || res.status === 403) {
    return { state: "error", message: SIGNED_OUT_MESSAGE };
  }
  if (res.status === 429) return { state: "error", message: CLAIM_RATE_LIMITED_MESSAGE };
  if (res.status === 404) return { state: "error", message: CODE_UNKNOWN_MESSAGE };
  if (res.status === 400) return { state: "error", message: CODE_INVALID_MESSAGE };
  return { state: "error", message: OFFLINE_MESSAGE };
}

/* -------------------------------------------------------------------------- */
/* The device list (R18)                                                       */
/* -------------------------------------------------------------------------- */

/**
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{state:"ok"|"signed-out"|"error", devices?: object[], message?: string}>}
 */
export async function fetchDevices(fetchImpl) {
  let res;
  try {
    res = await doFetch(fetchImpl)(DEVICES_PATH, { credentials: "same-origin" });
  } catch {
    return { state: "error", message: OFFLINE_MESSAGE };
  }
  // Signed-out is a state, not an error: the whole page is useless without a
  // session, and "could not load your devices" would send the user looking for
  // a fault that is not there.
  if (res.status === 401) return { state: "signed-out", message: SIGNED_OUT_MESSAGE };
  if (!res.ok) return { state: "error", message: DEVICES_UNAVAILABLE_MESSAGE };
  const payload = await readJson(res);
  return { state: "ok", devices: Array.isArray(payload?.devices) ? payload.devices : [] };
}

/**
 * Grant or revoke one scope. One scope per call, mirroring the server: a
 * whole-list write would let a stale tab restore a `read:fix` grant the user
 * had just turned off.
 *
 * @returns {Promise<{state:"ok"|"signed-out"|"conflict"|"error", device?: object, message?: string}>}
 */
export async function setScope(deviceId, scope, granted, fetchImpl) {
  let res;
  try {
    res = await doFetch(fetchImpl)(
      `${DEVICES_PATH}/${encodeURIComponent(deviceId)}`,
      writeInit("PATCH", { scope, granted }),
    );
  } catch {
    return { state: "error", message: OFFLINE_MESSAGE };
  }
  if (res.status === 401) return { state: "signed-out", message: SIGNED_OUT_MESSAGE };
  if (res.status === 409) return { state: "conflict", message: SCOPE_CONFLICT_MESSAGE };
  if (!res.ok) return { state: "error", message: SCOPE_FAILED_MESSAGE };
  return { state: "ok", device: await readJson(res) };
}

/**
 * Unpair. Named `unpairDevice` rather than `deleteDevice` because that is what
 * it does: the credential is revoked and the stored position cleared, and the
 * row itself survives so the board's token keeps answering the same 401 a
 * token that never existed gets.
 *
 * @returns {Promise<{state:"ok"|"signed-out"|"error", message: string}>}
 */
export async function unpairDevice(deviceId, fetchImpl) {
  let res;
  try {
    res = await doFetch(fetchImpl)(
      `${DEVICES_PATH}/${encodeURIComponent(deviceId)}`,
      writeInit("DELETE"),
    );
  } catch {
    return { state: "error", message: OFFLINE_MESSAGE };
  }
  if (res.status === 401) return { state: "signed-out", message: SIGNED_OUT_MESSAGE };
  if (!res.ok) return { state: "error", message: DEVICES_UNAVAILABLE_MESSAGE };
  return { state: "ok", message: UNPAIRED_MESSAGE };
}

/** A body that is not JSON is not a reason to throw at the caller. */
async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
