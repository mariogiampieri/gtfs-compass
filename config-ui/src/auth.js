/**
 * Sign-in request (R1/R2 client half).
 *
 * The UI only ever posts an address and says "check your email". The link in
 * that email is redeemed by a separate Worker-served interstitial, not by this
 * SPA — that page is the security-critical one and needs a per-request CSP
 * nonce, which a static asset cannot carry.
 */

/**
 * Presence of this header is the CSRF defence for state-changing requests: a
 * cross-site form post cannot add a custom header without a preflight the
 * Worker will not grant. The value is irrelevant.
 */
export const CSRF_HEADER = "X-GC-CSRF";

/**
 * One message for every outcome the server distinguishes. `POST
 * /v1/auth/request` answers identically for an unknown address, a known
 * address, and a non-allowlisted address; the UI must not reintroduce the
 * account-existence oracle the server went to the trouble of removing.
 */
export const SIGN_IN_SENT_MESSAGE =
  "If that address can sign in, a link is on its way. Check your email — the link is single-use and expires shortly.";

export const SIGN_IN_INVALID_MESSAGE = "Enter an email address first.";
export const SIGN_IN_RATE_LIMITED_MESSAGE =
  "Too many sign-in requests from here. Wait a minute and try again.";
export const SIGN_IN_UNAVAILABLE_MESSAGE =
  "Sign-in is unavailable right now. Try again in a moment.";

/**
 * Deliberately loose: the server owns validation and normalization. This only
 * catches the empty box and the missing "@" so the user is not told to go
 * check an inbox for a message that was never addressable.
 *
 * @param {string} value
 */
export function normalizeEmail(value) {
  return String(value ?? "").trim();
}

/** @param {string} email */
export function looksLikeEmail(email) {
  const at = email.indexOf("@");
  return at > 0 && at < email.length - 1 && !/\s/.test(email);
}

/**
 * @param {string} rawEmail
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ok: boolean, message: string}>}
 */
export async function requestMagicLink(rawEmail, fetchImpl) {
  const email = normalizeEmail(rawEmail);
  if (!looksLikeEmail(email)) {
    return { ok: false, message: SIGN_IN_INVALID_MESSAGE };
  }
  const doFetch = fetchImpl ?? globalThis.fetch.bind(globalThis);
  let res;
  try {
    res = await doFetch("/v1/auth/request", {
      method: "POST",
      // Same origin as /v1/*, so the session cookie is first-party and there
      // is no CORS to configure — that is the whole point of R16.
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        [CSRF_HEADER]: "1",
      },
      body: JSON.stringify({ email }),
    });
  } catch {
    return { ok: false, message: SIGN_IN_UNAVAILABLE_MESSAGE };
  }
  if (res.status === 429) {
    return { ok: false, message: SIGN_IN_RATE_LIMITED_MESSAGE };
  }
  if (!res.ok) {
    // Never branch on 4xx-vs-5xx here: an error that varies by address is the
    // enumeration oracle R2 forbids. Transport failure is the only thing this
    // reports, and it is address-independent.
    return { ok: false, message: SIGN_IN_UNAVAILABLE_MESSAGE };
  }
  return { ok: true, message: SIGN_IN_SENT_MESSAGE };
}
