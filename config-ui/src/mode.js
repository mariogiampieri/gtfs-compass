/**
 * Single-user-mode banner (R5).
 *
 * ASSUMPTION — the flag this reads does not exist yet. This unit ships the
 * banner and the fetch that would drive it; whichever unit implements
 * `AUTH_MODE` is expected to serve `GET /v1/auth/mode` returning
 * `{"auth_mode": "single" | "multi"}`. Until then the request 404s and the
 * banner stays hidden, which is the correct default: a warning that appears on
 * a normal multi-user deployment is noise, and R5 already says anything unset
 * or unrecognized fails closed to multi-user.
 */

export const AUTH_MODE_PATH = "/v1/auth/mode";

export const SINGLE_USER_BANNER =
  "Single-user mode: sign-in is bypassed on this deployment, so anything that can reach this hostname can read your saved locations, post fixes to your devices, and delete the account. Only run it behind a network-level control such as Cloudflare Access.";

/** @param {string} mode @returns {string|null} */
export function bannerForMode(mode) {
  return mode === "single" ? SINGLE_USER_BANNER : null;
}

/**
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<"single"|"multi">}
 */
export async function fetchAuthMode(fetchImpl) {
  const doFetch = fetchImpl ?? globalThis.fetch.bind(globalThis);
  try {
    const res = await doFetch(AUTH_MODE_PATH, { credentials: "same-origin" });
    if (!res.ok) return "multi";
    const body = await res.json();
    return body?.auth_mode === "single" ? "single" : "multi";
  } catch {
    return "multi";
  }
}
