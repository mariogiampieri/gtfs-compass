/**
 * /v1/auth/* — magic-link sign-in (Phase 5 plan, U4; requirements R1, R2, R4,
 * R4b, R19; acceptance AE1, AE2, AE3).
 *
 * Four surfaces, three of them security-critical:
 *
 *   GET  /v1/auth/mode      the single-user-mode banner's flag (R5)
 *   POST /v1/auth/request   ask for a link — one response for every input (R2)
 *   GET  /v1/auth/callback  the Worker-served interstitial, nonce'd CSP (R19)
 *   POST /v1/auth/redeem    the single-use conditional UPDATE (R1) + CSRF (R3)
 *   POST /v1/auth/signout   revoke this session and clear the cookie
 *
 * Properties this module exists to guarantee structurally, not by remembering:
 *
 *  1. **The inline path does not branch on account existence.** `/v1/auth/request`
 *     issues the same statements in the same order for a known address, an
 *     unknown one, and one the allowlist refuses; the response is a fixed byte
 *     string with a fixed header set. The only per-request variation is the
 *     random nonce cookie value, which is random for everybody. What varies is
 *     whether writes happen at all, and that leaks two things, both accepted
 *     deliberately (see the KTD note on `handleRequest`):
 *
 *       - **Allowlist membership.** R4b requires "no row created" for a refused
 *         address, so a refusal skips the `magic_tokens` insert. The residual
 *         signal is the timing of one D1 write.
 *       - **Account existence, but only once a global slice is exhausted.**
 *         R4's reserved-slice split is what makes this unavoidable: the whole
 *         point is that known and unknown addresses are refused *at different
 *         thresholds*, so an attacker who spends the unknown slice can then
 *         distinguish the two classes by whether the request still writes.
 *         R2 and R4 are in genuine tension here and R4 wins — a spraying
 *         attacker locking every existing user out of sign-in is a worse
 *         outcome than a timing oracle that costs the attacker the whole
 *         unknown slice to open and closes again at 00:00 UTC. Collapsing the
 *         slices into one counter would close the oracle and reopen the
 *         lockout.
 *
 *  2. **The emailed secret is never in a URL path, query string, referrer, or
 *     server log.** It rides in the fragment (R1), which no HTTP request
 *     carries; the interstitial strips it from the address bar before anything
 *     else runs, and ships under `Referrer-Policy: no-referrer`.
 *
 *  3. **A GET can never burn a token.** Mail gateways prefetch links with GETs
 *     and no JavaScript; the only consumer is `POST /v1/auth/redeem` (AE2). A
 *     scanner that *does* run JavaScript still cannot burn it: it holds no
 *     `__Host-` nonce cookie, so it lands on the confirm interstitial and the
 *     token stays redeemable.
 *
 * Everything credential-shaped comes from `../auth` and everything mail-shaped
 * from `../email`. This file mints no hashes, builds no cookies, and writes no
 * second CSRF check of its own.
 */

import {
  authorize,
  checkAmbientCsrf,
  clearedNonceCookie,
  clearedSessionCookie,
  hashToken,
  isSingleUserMode,
  mintSession,
  nonceCookie,
  randomToken,
  readNonceCookie,
  readSessionCookie,
  revokeSession,
  rotateSession,
} from "../auth";
import {
  EmailConfigError,
  chargeSendBudget,
  deliver,
  isAllowedRecipient,
  magicLinkMessage,
  normalizeEmail,
  parseAllowlist,
  selectSender,
  type EmailDeps,
} from "../email";

/** ASVS 6.5.5: a sign-in link is good for ten minutes and no longer. */
export const MAGIC_TOKEN_TTL_S = 600;

/**
 * How many un-redeemed links one address may hold at once.
 *
 * The number exists because the obvious alternative — rewriting the live row's
 * `token_hash` on a repeat — hands any unauthenticated caller a way to destroy
 * the link already sitting in a named user's inbox, and to do it as often as
 * they like. Minting alongside instead means a repeat is *additive*: the
 * mailed link a user is holding always stays redeemable. Three is enough for
 * "it did not arrive, send another" across two devices and small enough that
 * the row is not a mail-bomb amplifier; past it a repeat is free and mints
 * nothing, so a third party cannot spend a victim's daily send budget either.
 */
export const MAX_LIVE_TOKENS_PER_ADDRESS = 3;

/**
 * The interstitial's path. Under `/v1/` on purpose: `wrangler.jsonc` already
 * routes `/v1/*` to the Worker ahead of the static-asset router
 * (`run_worker_first`, covered by test/unit/asset-routing.test.ts), so the most
 * security-critical page in the app cannot be shadowed by an asset or answered
 * by the SPA fallback — which would serve it without its per-request CSP nonce.
 */
export const CALLBACK_PATH = "/v1/auth/callback";

/** RFC 5321's cap on a whole address; anything longer is not an address. */
const MAX_EMAIL_LENGTH = 254;

/**
 * The single response `/v1/auth/request` gives to every well-formed address
 * (R2). A fixed string rather than a re-serialized object so no code path can
 * drift into a body that differs by a key order or a space.
 */
const SIGN_IN_ACK_BODY = '{"ok":true}';

function nowS(): number {
  return Math.floor(Date.now() / 1000);
}

function noStoreJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/**
 * One message for every way a link can fail: unknown token, replayed token,
 * expired token, a race lost to a concurrent redeem, an address the allowlist
 * no longer admits. Distinguishing them would tell a token-guesser which of
 * their guesses had once been real.
 */
function invalidLink(): Response {
  return noStoreJson({ error: "invalid or expired sign-in link" }, 400);
}

/**
 * Deliberately loose: normalization and the account decision are the server's,
 * but a string with no `@`, whitespace in it, or 300 characters of nonsense was
 * never addressable, and telling the caller so leaks nothing — syntax is
 * something they already know. Only *semantic* answers (does this address have
 * an account, is it on the allowlist) are hidden behind the identical 200.
 */
function looksLikeAddress(email: string): boolean {
  return email.length > 0 && email.length <= MAX_EMAIL_LENGTH && /^[^\s@]+@[^\s@]+$/.test(email);
}

/**
 * Where the emailed link points. `AUTH_PUBLIC_ORIGIN` exists because the
 * fallback — the origin of the request that asked for the link — is derived
 * from the `Host` header, and a deployment reachable under more than one
 * hostname would otherwise mail a link built from whichever name the requester
 * used. Set it and the link is pinned to the real front door.
 */
function publicOrigin(request: Request, env: Env): string {
  const configured = (env.AUTH_PUBLIC_ORIGIN ?? "").trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      console.warn("[auth] AUTH_PUBLIC_ORIGIN is not a valid URL; falling back to the request origin");
    }
  }
  return new URL(request.url).origin;
}

/* -------------------------------------------------------------------------- */
/* GET /v1/auth/mode (R5)                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The flag behind config-ui's single-user warning banner. Unauthenticated by
 * necessity — the banner has to render before anyone can sign in — and it
 * discloses only a deployment posture the operator chose, never a fact about
 * any account. `isSingleUserMode` is the single parser, so this cannot drift
 * from what `resolveCredential` actually does.
 */
function handleMode(env: Env): Response {
  return noStoreJson({ auth_mode: isSingleUserMode(env) ? "single" : "multi" });
}

/* -------------------------------------------------------------------------- */
/* POST /v1/auth/request (R1, R2, R4, R4b)                                     */
/* -------------------------------------------------------------------------- */

/** The identical acknowledgement, plus the nonce cookie that pairs this browser
 * with the link about to be mailed. Set unconditionally: a `Set-Cookie` that
 * appeared only for addresses that got mail would be the oracle R2 forbids. */
function acknowledged(nonce: string): Response {
  return new Response(SIGN_IN_ACK_BODY, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Set-Cookie": nonceCookie(nonce),
    },
  });
}

/** How many un-redeemed, unexpired links this address is holding right now. */
async function countLiveTokens(env: Env, email: string, now: number): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM magic_tokens WHERE email = ?1 AND used_at IS NULL AND expires_at > ?2",
  )
    .bind(email, now)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * Mint the link secret and park its hash on a row of its own.
 *
 * R4 asks that a repeat inside the window "resend the existing token". R1's
 * hash-at-rest makes the literal reading impossible — we destroyed the
 * plaintext on purpose and cannot mail back a secret we no longer hold — so
 * what is preserved is the property the requirement is protecting: **a bounded
 * number of live links per address, none of whose expiries slide.** Every row
 * carries its own `created_at`/`expires_at` and is never rewritten, so no
 * amount of clicking "resend" walks a link past ten minutes and no request can
 * invalidate a link somebody else is holding. `MAX_LIVE_TOKENS_PER_ADDRESS` is
 * the bound; the caller checks it before spending any budget.
 */
async function issueMagicToken(
  env: Env,
  email: string,
  nonce: string,
  now: number,
): Promise<string> {
  const token = randomToken(); // 16 bytes = the >=128 bits R1 requires
  await env.DB.prepare(
    `INSERT INTO magic_tokens (id, token_hash, email, nonce_hash, created_at, expires_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  )
    .bind(
      `mgt_${randomToken(12)}`,
      await hashToken(token),
      email,
      await hashToken(nonce),
      now,
      now + MAGIC_TOKEN_TTL_S,
    )
    .run();
  return token;
}

/**
 * Ask for a sign-in link.
 *
 * Order is the whole design, and it is:
 *
 *   1. CSRF gate — this route sets an ambient `__Host-` cookie and spends a
 *      mail budget, so a cross-site page must not be able to drive it.
 *   2. Syntax. 400 here is not an oracle (see `looksLikeAddress`).
 *   3. `selectSender` — inline, **before** anything is minted, so a
 *      misconfigured provider leaves no orphan `magic_tokens` row (U3's KTD).
 *   4. Account lookup and the live-link count — both inline, both issuing the
 *      same statements in the same order whatever they find (R2/R4).
 *   5. The two decisions that say whether mail is going out at all: the
 *      allowlist (R4b) and the live-link cap. They are made *before* the
 *      budget, because a request that was never going to be mailed must not
 *      spend a slice that gates real sign-ins — twenty throwaway addresses
 *      would otherwise block every new registration until 00:00 UTC. A refused
 *      request charges the parallel `:refused` counters instead, so the
 *      statement shape is unchanged.
 *   6. `chargeSendBudget` — inline, before the response (R4).
 *   7. The send, in `waitUntil`, after the response has gone out.
 *
 * KTD — the one residual signal. Steps 1-6 are identical for every well-formed
 * address; step 7 skips a D1 insert for an address the allowlist refuses,
 * because R4b requires that no row be created for it. That leaves a timing
 * difference of one insert which discloses *allowlist membership*, not account
 * existence, and only to an attacker who can measure a few milliseconds across
 * the network. The alternative — writing the row and not sending — would break
 * the requirement outright, so the timing residual is the accepted cost.
 */
async function handleRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  deps: EmailDeps,
): Promise<Response> {
  const denial = checkAmbientCsrf(request);
  if (denial) return denial;

  let body: Record<string, unknown>;
  try {
    body = ((await request.json()) as Record<string, unknown>) ?? {};
  } catch {
    return noStoreJson({ error: "invalid JSON body" }, 400);
  }
  const email = normalizeEmail(typeof body.email === "string" ? body.email : "");
  if (!looksLikeAddress(email)) {
    return noStoreJson({ error: "email required" }, 400);
  }

  let sender;
  try {
    sender = selectSender(env);
  } catch (err) {
    if (err instanceof EmailConfigError) {
      // Address-independent by construction: this fires for every caller or
      // none, so it cannot become an enumeration signal.
      console.error(`[auth] sign-in is unavailable: ${err.message}`);
      return noStoreJson({ error: "sign-in is unavailable" }, 503);
    }
    throw err;
  }

  const nonce = randomToken();
  const now = nowS();
  const account = await env.DB.prepare("SELECT id FROM users WHERE email = ?1")
    .bind(email)
    .first<{ id: string }>();
  const live = await countLiveTokens(env, email, now);
  // Settled before the charge, so the budget only ever pays for a link that is
  // actually going out. Both inputs are address-independent in *shape*: the
  // allowlist test touches no storage and the count is the same query for
  // everybody.
  const deliverable = isAllowedRecipient(env, email) && live < MAX_LIVE_TOKENS_PER_ADDRESS;
  const budget = await chargeSendBudget(env, email, { known: account !== null, deliverable });

  if (deliverable && budget.allowed) {
    const token = await issueMagicToken(env, email, nonce, now);
    const url = `${publicOrigin(request, env)}${CALLBACK_PATH}#${token}`;
    // After the response, never before it: a provider that hangs for ten
    // seconds must not hold the caller, and a caller who times the response
    // must not learn whether mail went out.
    ctx.waitUntil(deliver(sender, env, magicLinkMessage(email, url), deps));
  } else if (deliverable) {
    // The address itself never reaches a log line; the slice and the control
    // that refused are what an operator needs to see a cap being hit. Only a
    // charge against a live slice is worth a line — the `:refused` counters
    // filling up is the design working, not a cap being hit.
    console.warn(`[auth] send budget refused slice=${budget.slice} by=${budget.refusedBy}`);
  }

  return acknowledged(nonce);
}

/* -------------------------------------------------------------------------- */
/* GET /v1/auth/callback — the interstitial (R1, R19)                          */
/* -------------------------------------------------------------------------- */

/**
 * The page the emailed link opens. It is served by the Worker, not by the
 * static-asset tree, for exactly one reason: it needs a **per-request CSP
 * nonce**, and an asset that never enters the Worker can never carry one. Its
 * inline script is allowed by that nonce alone — no `unsafe-inline`, no hash
 * that a second inline script could reuse — and everything else is denied by
 * `default-src 'none'`.
 *
 * `Referrer-Policy: no-referrer` matters here more than anywhere else in the
 * app: the URL that opened this page carries a live sign-in secret in its
 * fragment, and while fragments are not sent in a `Referer` header, the page
 * also makes a request of its own and this removes the whole question.
 */
function handleCallback(): Response {
  const cspNonce = randomToken(); // base64url — safe unquoted inside a CSP source
  return new Response(interstitialHtml(cspNonce), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": [
        "default-src 'none'",
        `script-src 'nonce-${cspNonce}'`,
        `style-src 'nonce-${cspNonce}'`,
        "connect-src 'self'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
      ].join("; "),
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      // A cached interstitial on a shared machine is a cached sign-in attempt.
      "Cache-Control": "no-store",
    },
  });
}

/**
 * The interstitial's markup. The only value interpolated into it is the nonce,
 * which this Worker generated — no request data reaches the HTML. The address
 * on the confirm screen arrives as JSON and is written with `textContent`, so
 * an address containing markup is text and nothing else (R8's escaping rule,
 * applied here because `magic_tokens.email` is caller-supplied).
 */
function interstitialHtml(nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Signing in — gtfs-compass</title>
<style nonce="${nonce}">
  :root { color-scheme: dark light; }
  body { margin: 0; padding: 2rem 1.25rem; font: 16px/1.5 system-ui, sans-serif;
         background: #0f1419; color: #e7edf3; }
  main { max-width: 32rem; margin: 0 auto; }
  h1 { font-size: 1.25rem; margin: 0 0 1rem; }
  p { margin: 0 0 1rem; }
  .muted { color: #9fb0c0; }
  strong { word-break: break-all; }
  button { font: inherit; padding: 0.6rem 1rem; border: 0; border-radius: 0.4rem;
           background: #2f81f7; color: #fff; cursor: pointer; }
  button[disabled] { opacity: 0.6; cursor: default; }
</style>
</head>
<body>
<main>
<h1>gtfs-compass</h1>
<p id="status" role="status">Finishing sign-in&hellip;</p>
<div id="confirm" hidden>
  <p>This link signs in as <strong id="confirm-email"></strong>.</p>
  <p class="muted">
    Your browser did not ask for this link, which is normal if you opened it on
    a different device or from a mail app. Continue only if that address is
    yours.
  </p>
  <button id="confirm-button" type="button">Sign in as this address</button>
</div>
</main>
<script nonce="${nonce}">
(function () {
  var token = location.hash.slice(1);
  // Strip the secret from the address bar and this history entry before
  // anything else can read it: the fragment kept it off the wire, and this
  // keeps it off the screen and out of the back button.
  try { history.replaceState(null, "", location.pathname); } catch (e) {}
  var status = document.getElementById("status");
  var box = document.getElementById("confirm");
  var who = document.getElementById("confirm-email");
  var button = document.getElementById("confirm-button");
  var EXPIRED = "This sign-in link is no longer valid. Ask for a new one.";

  if (!token) {
    status.textContent = "This link is missing its sign-in code. Ask for a new one.";
    return;
  }

  function post(confirm) {
    return fetch("/v1/auth/redeem", {
      method: "POST",
      // Same-origin by design (R16), so the nonce cookie rides along and there
      // is no CORS in the picture.
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-GC-CSRF": "1" },
      body: JSON.stringify({ token: token, confirm: confirm === true })
    });
  }

  function fail() { status.textContent = "Sign-in could not be completed. Try again."; }

  function handle(res) {
    if (res.status === 409) {
      return res.json().then(function (body) {
        who.textContent = (body && body.email) || "an unknown address";
        status.textContent = "Confirm this sign-in.";
        box.hidden = false;
      }, fail);
    }
    if (!res.ok) { status.textContent = EXPIRED; return; }
    status.textContent = "Signed in. Taking you to your settings\\u2026";
    location.replace("/");
  }

  button.addEventListener("click", function () {
    button.disabled = true;
    box.hidden = true;
    status.textContent = "Finishing sign-in\\u2026";
    post(true).then(handle, fail);
  });

  post(false).then(handle, fail);
})();
</script>
</body>
</html>
`;
}

/* -------------------------------------------------------------------------- */
/* POST /v1/auth/redeem (R1, R3; AE2, AE3)                                     */
/* -------------------------------------------------------------------------- */

/**
 * Create the account on first successful redemption, or return the existing
 * one. The allowlist is re-checked here, and only for a *new* account: R4b
 * gates registration, so an operator who removes an address from the list
 * between the send and the click must not get a new account out of it, while an
 * existing user whose address was removed keeps signing in.
 *
 * Returns null when registration is refused.
 */
async function resolveAccount(env: Env, email: string): Promise<string | null> {
  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?1")
    .bind(email)
    .first<{ id: string }>();
  if (existing) return existing.id;
  if (!isAllowedRecipient(env, email)) return null;

  if (parseAllowlist(env).length === 0) {
    // R4b's open-registration mode is a deliberate opt-in, but it is also what
    // an accidentally-cleared variable looks like, and the two are
    // indistinguishable from the outside. Say so on every account it creates.
    console.warn(
      "[auth] AUTH_ALLOWED_EMAILS is empty — registration is OPEN and this request created an " +
        "account for an address nobody vouched for",
    );
  }

  const id = `usr_${randomToken(12)}`;
  await env.DB.prepare(
    `INSERT INTO users (id, email, created_at) VALUES (?1, ?2, ?3)
     ON CONFLICT (email) DO NOTHING`,
  )
    .bind(id, email, nowS())
    .run();
  // Re-read rather than trusting the insert: a concurrent redemption of a
  // second link for the same address may have won, and both must land on the
  // same account rather than one of them failing.
  const row = await env.DB.prepare("SELECT id FROM users WHERE email = ?1")
    .bind(email)
    .first<{ id: string }>();
  return row?.id ?? null;
}

/**
 * Consume a link and sign the browser in.
 *
 * The CSRF gate is first and is the difference between a working sign-in and
 * AE3: without it, a page the victim visits can `fetch()` this route with the
 * attacker's token and silently sign the victim into the attacker's account,
 * where everything they subsequently save belongs to the attacker.
 *
 * The `nonce` cookie is matched, not required. `SameSite=Lax` means it is
 * simply absent whenever the link is opened in a different browser or a mail
 * app's webview — the common case, not an attack — so a mismatch routes to the
 * confirm interstitial that names the address, and **leaves the token
 * unburned**. That is also what stops a JavaScript-executing mail scanner from
 * consuming a link: it holds no nonce and never clicks the button.
 */
async function handleRedeem(request: Request, env: Env): Promise<Response> {
  const denial = checkAmbientCsrf(request);
  if (denial) return denial;

  let body: Record<string, unknown>;
  try {
    body = ((await request.json()) as Record<string, unknown>) ?? {};
  } catch {
    return noStoreJson({ error: "invalid JSON body" }, 400);
  }
  const token = typeof body.token === "string" ? body.token.trim() : "";
  const confirmed = body.confirm === true;
  if (!token) return invalidLink();

  const now = nowS();
  const row = await env.DB.prepare(
    "SELECT id, email, nonce_hash, expires_at, used_at FROM magic_tokens WHERE token_hash = ?1",
  )
    .bind(await hashToken(token))
    .first<{
      id: string;
      email: string;
      nonce_hash: string | null;
      expires_at: number;
      used_at: number | null;
    }>();
  if (!row || row.used_at !== null || row.expires_at <= now) return invalidLink();

  const cookie = readNonceCookie(request);
  const nonceMatches =
    row.nonce_hash !== null && cookie !== null && (await hashToken(cookie)) === row.nonce_hash;
  if (!nonceMatches && !confirmed) {
    // Naming the address is the point: it lets someone who was forwarded — or
    // phished with — a link that is not theirs recognize it before it signs
    // them in as somebody else. Only the holder of a live token can reach this,
    // and they already have the far more sensitive thing.
    return noStoreJson({ status: "confirm", email: row.email }, 409);
  }

  // The single-use latch (R1). Conditional UPDATE plus a rows-affected check,
  // never a read-then-write: two clicks that both passed the SELECT above
  // arrive here together, and exactly one of them changes a row.
  const claimed = await env.DB.prepare(
    "UPDATE magic_tokens SET used_at = ?1 WHERE id = ?2 AND used_at IS NULL AND expires_at > ?1",
  )
    .bind(now, row.id)
    .run();
  if ((claimed.meta?.changes ?? 0) !== 1) return invalidLink();

  const userId = await resolveAccount(env, row.email);
  if (!userId) return invalidLink();

  // R3: authentication rotates. Any session already sitting in this browser is
  // destroyed rather than left live alongside the new one, so a token planted
  // before sign-in is worthless afterwards.
  //
  // Which of the two shapes applies depends on *whose* session is present, and
  // that is the whole distinction: a live session for this same account is a
  // continuing session, so `rotateSession` replaces it in one batch (the old
  // token cannot survive a half-failed write) and carries `created_at`
  // forward, which is what stops repeated sign-ins from walking a session past
  // the 180-day cap. Anything else — a stranger's session, an expired one,
  // garbage — is not a rotation: it is revoked and the new account gets its own
  // anchor rather than inheriting somebody else's.
  const presented = readSessionCookie(request);
  let minted = presented ? await rotateSession(env, presented, { userId }) : null;
  if (!minted) {
    if (presented) await revokeSession(env, presented);
    minted = await mintSession(env, userId);
  }

  const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store" });
  headers.append("Set-Cookie", minted.cookie);
  headers.append("Set-Cookie", clearedNonceCookie()); // consumed; nothing left to match
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

/* -------------------------------------------------------------------------- */
/* POST /v1/auth/signout                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Revoke this session server-side and clear the cookie. Goes through
 * `authorize()` like any other state-changing session route, so the CSRF gate
 * applies: a cross-site page must not be able to log people out at will.
 */
async function handleSignOut(request: Request, env: Env): Promise<Response> {
  const auth = await authorize(request, env);
  if (auth instanceof Response) return auth;

  const token = readSessionCookie(request);
  if (token) await revokeSession(env, token);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Set-Cookie": clearedSessionCookie(),
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Dispatch                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * `deps` is the test seam U3 established: the workers pool stubs `fetch`
 * globally, so the send's network call and log sinks are parameters. Production
 * passes nothing.
 */
export async function routeAuth(
  request: Request,
  env: Env,
  url: URL,
  ctx: ExecutionContext,
  deps: EmailDeps = {},
): Promise<Response> {
  if (url.pathname === "/v1/auth/mode" && request.method === "GET") {
    return handleMode(env);
  }
  if (url.pathname === "/v1/auth/request" && request.method === "POST") {
    return handleRequest(request, env, ctx, deps);
  }
  if (url.pathname === CALLBACK_PATH && request.method === "GET") {
    return handleCallback();
  }
  if (url.pathname === "/v1/auth/redeem" && request.method === "POST") {
    return handleRedeem(request, env);
  }
  if (url.pathname === "/v1/auth/signout" && request.method === "POST") {
    return handleSignOut(request, env);
  }
  return noStoreJson({ error: "not found" }, 404);
}
