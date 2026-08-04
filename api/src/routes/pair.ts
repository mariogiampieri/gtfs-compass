/**
 * /v1/device/pair/* and /v1/pair/claim — RFC 8628 device pairing (Phase 5 plan,
 * U5; requirements R6, R7, R8; acceptance AE4, AE5).
 *
 * Three surfaces, each with a different caller and a different threat model:
 *
 *   POST /v1/device/pair/start   the device, unauthenticated — mints the pair
 *   POST /v1/device/pair/poll    the device, bearer `device_code`
 *   POST /v1/pair/claim          the browser, session + CSRF + confirm (R8)
 *
 * Properties this module exists to guarantee structurally rather than by
 * remembering them at each call site:
 *
 *  1. **The short code authenticates nothing.** `user_code` is ~34.5 bits and
 *     is read aloud off a screen; all it does is *name* a pending request. The
 *     credential that collects the token is the 256-bit `device_code`, which
 *     never leaves the device, is stored hashed, and is presented as a Bearer
 *     header — never a query parameter, where it would land in access logs and
 *     `Referer` headers (the poll route rejects one outright).
 *
 *  2. **The claiming browser never sees the device token.** Claim binds
 *     `pairing_codes.claimed_by` and nothing else; the token is minted on the
 *     device's *next poll* and returned only to the holder of the device code.
 *     A compromised or phished browser session therefore cannot walk away with
 *     a credential — it can only attach a board it does not hold to its own
 *     account, which is the confirm screen's problem (R8), not the token's.
 *
 *  3. **The token is issued exactly once.** The poll's issuance is one D1
 *     `batch()` — an `INSERT ... SELECT` guarded on the pairing row plus the
 *     `DELETE` of that row — so two concurrent polls run as two serialized
 *     transactions and the second one's `SELECT` finds nothing. Rows-affected
 *     on the insert is the latch (the pattern from
 *     `docs/solutions/design-patterns/d1-http-api-idempotent-bulk-sync.md`),
 *     never a read-then-write.
 *
 *  4. **Writes are bounded before they happen.** `pair/start` is
 *     unauthenticated and inserts a row; `pair/claim` writes a counter keyed by
 *     the caller's network. Both keys are attacker-chosen with unbounded
 *     cardinality, so each charge reads every counter it might charge *before*
 *     it writes any of them — the same ordering `chargeSendBudget()` uses in
 *     `email.ts`, and for the same reason: a cap that is charged after the
 *     write it is supposed to bound, bounds nothing.
 *
 *  5. **No deployment-wide cap is a switch one caller can flip.** A single
 *     global counter over an uncredentialed route is an off switch for
 *     everybody: spend it and every honest device 429s until 00:00 UTC. So the
 *     caller key is a *network* (`networkKey`), not an address, and the global
 *     cap is **split into two slices** exactly as `email.ts` splits
 *     `SEND_GLOBAL_KNOWN`/`UNKNOWN` — the traffic that is cheap to manufacture
 *     (many charges from one key) draws on its own smaller pool and cannot
 *     starve the pool an honest first-of-the-day request draws on. A slice that
 *     does refuse lands on a durable counter, not only in the log tail.
 *
 * The `user_code` collision ruling lives on `mintUnusedUserCode` and
 * `handleClaim`; the attempt-counter ruling on `chargeCodeAttempt`. Everything
 * credential-shaped comes from `../auth` and every counter from `../email`;
 * this file implements neither.
 */

import {
  DEVICE_TOKEN_PREFIX,
  authorize,
  formatScopes,
  hashToken,
  randomToken,
  type Scope,
} from "../auth";
import { budgetVar, incrementBudget, readBudget } from "../email";
import { publicOrigin } from "./auth";

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * RFC 8628 §6.1's confusion-free alphabet: consonants only, so there is no
 * O/0, I/1, or S/5 to mistype off a small screen, and no vowel to spell a word
 * with. Twenty characters over eight positions is 20^8 ≈ 2.56e10 ≈ **34.5
 * bits** — which is exactly why the claim path is budgeted rather than trusted.
 */
export const USER_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";

/** R7: eight characters, rendered `XXXX-XXXX` for the human. */
export const USER_CODE_LENGTH = 8;

/** R7: a pending pairing request lives five minutes. */
export const PAIRING_CODE_TTL_S = 300;

/**
 * How long a *claimed* code stays collectable. Claiming rewrites `expires_at`
 * to this window rather than leaving the original five minutes, which does two
 * things: a user who claims at 4:59 does not lose the pairing to an expiry two
 * seconds later, and a grant nobody collects lapses in two minutes instead of
 * sitting there for the remainder of the original window. The device polls
 * every `POLL_INTERVAL_S`, so the honest case needs seconds.
 */
export const PAIR_DELIVERY_TTL_S = 120;

/**
 * R7: five failed attempts against a code destroy it.
 *
 * "An attempt against this code" is a claim request that resolved *to this row*
 * and did not bind it — in practice the confirm-screen preview, which is the
 * information-disclosing half of a claim (it hands the device's self-reported
 * name to whoever typed the code). Capping it means a sprayer who lands on a
 * live code by luck gets at most five looks before the code dies; an honest
 * user spends exactly one.
 *
 * A claim naming a code that does not exist has no row to charge, which is the
 * whole reason R7 also demands the per-claimer and per-network budgets below:
 * a per-code counter is no defense at all against spraying the live-code space.
 */
export const MAX_CODE_ATTEMPTS = 5;

/** RFC 8628 `interval`: the minimum seconds between polls, advertised at start. */
export const POLL_INTERVAL_S = 5;

/** R6: 256 bits of CSPRNG for the credential the device actually holds. */
export const DEVICE_CODE_BYTES = 32;

/** R9: the device token is the same 256 bits behind the `gtfsc_dev_` prefix. */
export const DEVICE_TOKEN_BYTES = 32;

/**
 * Caps on the device's self-reported metadata (R8). Device-supplied text is
 * attacker-controlled and is rendered on the confirm screen and the device
 * list, so it is capped and stripped of control characters *at rest* — a
 * consumer that forgets to cap it still cannot be handed a megabyte of
 * right-to-left overrides.
 */
export const MAX_DEVICE_NAME_LENGTH = 64;
export const MAX_FW_VERSION_LENGTH = 32;

/**
 * R9: a freshly paired device never receives a position. `read:fix` is granted
 * later, deliberately, from the device list (U10) — never implied by pairing.
 * Mirrors the `devices.scopes` column default; bound explicitly so the rule is
 * visible in the code that issues the credential, not only in the migration.
 */
export const DEFAULT_DEVICE_SCOPES: readonly Scope[] = ["read:departures", "read:config"];

/** Where the human is told to go. The config UI's pairing screen (U10). */
export const PAIR_VERIFICATION_PATH = "/pair";

/* `auth_budgets.scope` values this module owns (R7). ------------------------ */

/**
 * Starts per client **network** per UTC day — the counter that does the
 * enforcing. Keyed by `networkKey`, not by the address (see that function).
 */
export const PAIR_START_IP_SCOPE = "pair:start:ip";
/** Deployment-wide starts from keys still inside their `FRESH_SLICE_CHARGES`. */
export const PAIR_START_FRESH_SCOPE = "pair:start:global:fresh";
/** Deployment-wide starts from a key that has already spent its fresh allowance. */
export const PAIR_START_REPEAT_SCOPE = "pair:start:global:repeat";
/** Claim attempts per authenticated claimer per UTC day, hits and misses alike. */
export const PAIR_CLAIMER_SCOPE = "pair:claimer";
/** Claim attempts per client network per UTC day — one account per IP is not a bound. */
export const PAIR_CLAIM_IP_SCOPE = "pair:claim:ip";
/** As `PAIR_START_FRESH_SCOPE`, for claims; the slice is chosen by the claimer's count. */
export const PAIR_CLAIM_FRESH_SCOPE = "pair:claim:global:fresh";
/** As `PAIR_START_REPEAT_SCOPE`, for claims. */
export const PAIR_CLAIM_REPEAT_SCOPE = "pair:claim:global:repeat";
/**
 * Requests a spent global slice turned away, keyed by slice. The operator's
 * view of the one refusal in this module that is nobody's fault — see
 * `noteGlobalRefusal`.
 */
export const PAIR_START_REFUSED_SCOPE = "pair:start:refused";
export const PAIR_CLAIM_REFUSED_SCOPE = "pair:claim:refused";

const DEFAULT_START_IP_BUDGET = 20;
const DEFAULT_CLAIMER_BUDGET = 10;
const DEFAULT_CLAIM_IP_BUDGET = 20;
/**
 * Both surfaces' global caps still total the 500/day they always did; what
 * changed is that four fifths of it is reserved for the traffic class an
 * abuser cannot manufacture cheaply. Same split, and the same arithmetic, as
 * `DEFAULT_GLOBAL_KNOWN_BUDGET`/`UNKNOWN` in `email.ts`.
 */
const DEFAULT_START_FRESH_BUDGET = 400;
const DEFAULT_START_REPEAT_BUDGET = 100;
const DEFAULT_CLAIM_FRESH_BUDGET = 400;
const DEFAULT_CLAIM_REPEAT_BUDGET = 100;

/**
 * How many of a key's charges in a UTC day draw on the `fresh` slice.
 *
 * The honest shapes are small and known: a device starts pairing once, twice
 * if the code expired while the human went to find a browser; a claim costs
 * two attempts (the confirm screen is the first), three or four if the code
 * was mistyped once. Four covers both with room to spare, and everything past
 * it — a key charging over and over — is the shape only a retry storm or an
 * abuser has.
 */
const FRESH_SLICE_CHARGES = 4;

/** Which global slice a charge draws on. Operator-facing only — never a response. */
type GlobalSlice = "fresh" | "repeat";

/** How many re-rolls a start spends trying to avoid a live `user_code`. */
const USER_CODE_MINT_ATTEMPTS = 5;

function nowS(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Every response this module returns.
 *
 * `nosniff` is not decoration here: the claim response carries device-supplied
 * text (R8), and the one way a JSON body becomes executable markup is a browser
 * that sniffs it as HTML. With this header and `application/json` it is data,
 * whatever the device called itself. Escaping proper is the renderer's job —
 * the UI writes it with `textContent` (U10) — and this route deliberately emits
 * no HTML of its own for it to escape into.
 */
function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extra,
    },
  });
}

/** Read a JSON object body, tolerating an absent one. `null` means malformed. */
async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  const raw = (await request.text()).trim();
  // Firmware that has nothing optional to say sends no body at all; that is a
  // well-formed request, not a malformed one.
  if (raw === "") return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null) return {};
    return typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * The caller's address, which `networkKey` then truncates into the key the
 * per-caller budgets are charged against. `CF-Connecting-IP` is set by the edge
 * and cannot be spoofed by the client; behind anything else every caller shares
 * the `unknown` bucket, which fails safe (one shared, tighter budget) rather
 * than open.
 */
function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
}

/**
 * The key the per-caller budgets are charged against: the caller's *network*,
 * never the caller's address.
 *
 * A budget keyed on the exact address is not a budget. The smallest IPv6
 * allocation anybody is handed is a /64 — 2^64 addresses — so a per-address cap
 * of N is a per-subscriber cap of N × 2^64, and any deployment-wide counter
 * sitting behind it becomes a switch a single subscriber can flip. Truncating
 * to the /24 (IPv4) and the /64 (IPv6) makes the unit of the budget the unit an
 * attacker has to actually acquire.
 *
 * The cost is collateral: everyone behind one CGNAT /24, or one subscriber /64,
 * shares a budget. That is the right direction to be wrong in on a route a
 * board calls a handful of times in its life, and it is why the global caps are
 * sliced rather than raised — a shared key must not be able to lock the
 * deployment.
 *
 * Anything that does not parse as either family — `unknown` when
 * `CF-Connecting-IP` is absent, or a form the edge does not emit — becomes one
 * shared key, which fails safe: those callers share one tight budget rather
 * than each getting their own.
 */
export function networkKey(ip: string): string {
  if (ip.includes(":")) {
    const hextets = expandIpv6Head(ip);
    return hextets ? `${hextets.join(":")}::/64` : ip;
  }
  const octets = ip.split(".");
  if (
    octets.length === 4 &&
    octets.every((o) => /^\d{1,3}$/.test(o) && Number(o) <= 255)
  ) {
    return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
  }
  return ip;
}

/**
 * The first four hextets of an IPv6 address — its /64 — or null if the text is
 * not an IPv6 literal.
 *
 * Only the head has to be expanded: a `::` run stands for the zeros between the
 * groups written on either side of it, so whatever is missing from the first
 * four positions is zero by definition, wherever the tail happens to land.
 */
function expandIpv6Head(ip: string): string[] | null {
  // A zone index (`%eth0`) is a local scope, never part of the prefix.
  const halves = ip.split("%")[0].split("::");
  if (halves.length > 2) return null;
  const head = halves[0] === "" ? [] : halves[0].split(":");
  if (halves.length === 1 && head.length !== 8) return null;
  if (!head.every((h) => /^[0-9A-Fa-f]{1,4}$/.test(h))) return null;
  const out = head.slice(0, 4);
  while (out.length < 4) out.push("0");
  return out.map((h) => h.toLowerCase().replace(/^0+(?=.)/, ""));
}

/* -------------------------------------------------------------------------- */
/* The user code (R7)                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Eight characters of CSPRNG over the consonant alphabet, **rejection-sampled**.
 * 256 is not a multiple of 20, so `byte % 20` would make the first sixteen
 * letters of the alphabet ~6% likelier than the last four and cost real entropy
 * off a code that only has 34.5 bits to begin with. Bytes at or above the
 * largest multiple of the alphabet length are discarded, never folded.
 */
export function mintUserCode(): string {
  const n = USER_CODE_ALPHABET.length;
  const limit = 256 - (256 % n);
  let out = "";
  while (out.length < USER_CODE_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(USER_CODE_LENGTH))) {
      if (byte >= limit) continue;
      out += USER_CODE_ALPHABET[byte % n];
      if (out.length === USER_CODE_LENGTH) break;
    }
  }
  return out;
}

/** `BCDFGHJK` -> `BCDF-GHJK`. Display only; storage is always the compact form. */
export function formatUserCode(code: string): string {
  const half = Math.ceil(USER_CODE_LENGTH / 2);
  return `${code.slice(0, half)}-${code.slice(half)}`;
}

/**
 * Server-side normalization (R7). Case and the separator are presentation, so
 * `bcdf-ghjk`, `BCDF GHJK` and `BCDFGHJK` are one code.
 *
 * Only separators are stripped — never "any character not in the alphabet".
 * Dropping stray characters would silently re-align a typo into a *different
 * valid code* (`BCDFO-GHJK` becoming `BCDFGHJK`), which is a claim against a
 * pairing request the user never looked at. An unrecognizable code is a miss,
 * and a miss is the caller's to fix.
 */
export function normalizeUserCode(raw: string): string | null {
  // ASCII hyphen, any whitespace, the Unicode dashes a phone keyboard or a
  // copy-paste from a rendered page can substitute, and the minus sign.
  const compact = raw.replace(/[-\s‐-―−]/gu, "").toUpperCase();
  if (compact.length !== USER_CODE_LENGTH) return null;
  for (const ch of compact) {
    if (!USER_CODE_ALPHABET.includes(ch)) return null;
  }
  return compact;
}

/**
 * Mint a `user_code` that no *live* row is already using.
 *
 * The `user_code` collision, and this is half the answer to it: at ~34.5 bits
 * two live codes can legitimately collide, and `idx_pairing_codes_user_code` is
 * deliberately not UNIQUE so that such a collision cannot fail an honest
 * device's start request. Re-rolling against the live set makes the collision
 * rarer still without ever refusing the device — after
 * `USER_CODE_MINT_ATTEMPTS` unlucky draws (which, against a table that would
 * have to hold billions of live codes, means the CSPRNG is broken, not that we
 * are unlucky) the last candidate is inserted anyway and the operator is told.
 *
 * This check is a read-then-write and therefore racy by construction: two
 * concurrent starts can both see a free code and both insert it. That residue
 * is the *other* half of the answer, and it is resolved in `handleClaim`, which
 * refuses an ambiguous code rather than guessing which device the human meant.
 */
async function mintUnusedUserCode(env: Env, now: number): Promise<string> {
  let candidate = "";
  for (let i = 0; i < USER_CODE_MINT_ATTEMPTS; i++) {
    candidate = mintUserCode();
    const clash = await env.DB.prepare(
      "SELECT 1 AS hit FROM pairing_codes WHERE user_code = ?1 AND expires_at > ?2 LIMIT 1",
    )
      .bind(candidate, now)
      .first<{ hit: number }>();
    if (!clash) return candidate;
  }
  console.error(
    `[pair] ${USER_CODE_MINT_ATTEMPTS} consecutive user_code collisions — the code space or the ` +
      "CSPRNG is not behaving; minting anyway, and the claim path will refuse the ambiguity",
  );
  return candidate;
}

/* -------------------------------------------------------------------------- */
/* Device metadata (R8)                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Device-supplied text, made safe to store and to hand to a renderer: control
 * characters and format characters removed (that is C0/C1 plus the bidi
 * overrides that make `nam<RLO>...` read as something else entirely), trimmed,
 * and hard-capped. Anything empty afterwards is stored as NULL rather than as
 * an empty string, so "the device said nothing" has one representation.
 */
export function sanitizeMetadata(raw: unknown, cap: number): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .trim()
    .slice(0, cap);
  return cleaned === "" ? null : cleaned;
}

/**
 * The metadata shape the confirm screen (R8) renders. `untrusted` is part of
 * the contract, not a comment: the device chose these strings, nothing has
 * verified them, and the UI is required to present them as claims rather than
 * as facts.
 */
interface DeviceMetadata {
  name: string | null;
  fw_version: string | null;
  untrusted: true;
}

function metadata(row: { device_name: string | null; fw_version: string | null }): DeviceMetadata {
  return { name: row.device_name, fw_version: row.fw_version, untrusted: true };
}

/* -------------------------------------------------------------------------- */
/* Budgets (R7) — sharded daily counters in D1, from email.ts                  */
/* -------------------------------------------------------------------------- */

/**
 * Which global slice a key's next charge draws on, given what that key has
 * already spent today. The whole point of the split: charges past
 * `FRESH_SLICE_CHARGES` are the ones a single key can produce in volume, so
 * they get their own pool and cannot exhaust the one a first-of-the-day
 * request lands in.
 */
function sliceFor(keyedUsed: number): GlobalSlice {
  return keyedUsed < FRESH_SLICE_CHARGES ? "fresh" : "repeat";
}

/**
 * Record — durably, not only in a log tail nobody is reading — that a global
 * slice turned away a request that had done nothing wrong.
 *
 * A spent global slice is the one refusal here that is not the caller's fault,
 * and it is invisible in the response: the honest board sees the same 429 an
 * abuser does. Without a counter, "device pairing has been off for eleven
 * hours" is indistinguishable from "nobody paired a device today".
 *
 * Safe to write on the refusal path precisely because it is *fixed*
 * cardinality — two scopes, two keys, `BUDGET_SHARDS` rows apiece — which is
 * what the keyed budgets are not, and why they are never written before their
 * bound is checked. A counter failure must not turn a 429 into a 500, so it is
 * swallowed after being logged: it exists to report, never to gate.
 */
async function noteGlobalRefusal(
  env: Env,
  scope: string,
  slice: GlobalSlice,
  surface: "start" | "claim",
): Promise<void> {
  console.error(
    `[pair] ${surface} refused: the deployment-wide ${slice} slice is spent for today — ` +
      `honest callers in this class are being turned away (auth_budgets scope=${scope})`,
  );
  try {
    await incrementBudget(env, scope, slice);
  } catch (err) {
    console.error(`[pair] refusal counter write failed: ${String(err)}`);
  }
}

/**
 * Bound `pair/start` before it writes anything.
 *
 * `pair/start` is unauthenticated and inserts a `pairing_codes` row, so the
 * only thing standing between the internet and an unbounded table is this
 * function running *first*. The ordering is `chargeSendBudget`'s and is load
 * bearing for the same reason: the per-network key is attacker-chosen with
 * unbounded cardinality, so charging it before the global slice is checked
 * would persist one `auth_budgets` row per network for as long as anyone cares
 * to POST. Reading every counter first means an exhausted cap writes nothing.
 *
 * The per-network counter is the one that refuses in practice; the global
 * slices are the ceiling on the day's D1 growth, and they are two rather than
 * one so that a caller charging the same key over and over — the only cheap
 * way to spend a lot of this budget — spends the `repeat` slice and leaves the
 * `fresh` one, which is where a board pairing for the first time today lands.
 * The residue is real and worth naming: an attacker who brings genuinely fresh
 * networks, one per charge, can still spend the fresh slice. That costs them a
 * routable allocation per four requests instead of an address per twenty, and
 * it is the same residue `email.ts` accepts on its `known` slice.
 *
 * Not serializable, deliberately: two concurrent charges at the boundary can
 * both pass, so a limit of N admits N+1 in the worst case. That is the right
 * trade for a rate limit — the alternative is a transaction on the hot row that
 * sharding exists to avoid.
 */
async function chargeStartBudget(env: Env, ip: string): Promise<boolean> {
  const key = await hashToken(networkKey(ip));
  // Every read before any write. The keyed count is read first because it
  // selects the slice, which is a read too — no row exists until the last
  // two statements.
  const netUsed = await readBudget(env, PAIR_START_IP_SCOPE, key);
  const slice = sliceFor(netUsed);
  const globalScope = slice === "fresh" ? PAIR_START_FRESH_SCOPE : PAIR_START_REPEAT_SCOPE;
  const globalLimit =
    slice === "fresh"
      ? budgetVar(env.PAIR_START_BUDGET_FRESH, DEFAULT_START_FRESH_BUDGET)
      : budgetVar(env.PAIR_START_BUDGET_REPEAT, DEFAULT_START_REPEAT_BUDGET);
  const globalUsed = await readBudget(env, globalScope, "");
  if (globalUsed >= globalLimit) {
    await noteGlobalRefusal(env, PAIR_START_REFUSED_SCOPE, slice, "start");
    return false;
  }
  if (netUsed >= budgetVar(env.PAIR_START_BUDGET_IP, DEFAULT_START_IP_BUDGET)) return false;
  await incrementBudget(env, PAIR_START_IP_SCOPE, key);
  await incrementBudget(env, globalScope, "");
  return true;
}

/**
 * Charge one claim attempt — **hit or miss** (R7).
 *
 * Charging misses is the entire point. A per-code attempt counter cannot see a
 * caller walking the 34.5-bit code space, because every guess that misses
 * belongs to no row; only a counter keyed to the *claimer* can. Both the
 * claimer and the network are charged: one account per network is not a bound,
 * and one network per account is not either.
 *
 * The claimer key is a SHA-256 of the user id and the network key a SHA-256 of
 * the caller's /24 or /64, so `auth_budgets` is not a log of who tried to pair
 * from where.
 *
 * The global slices are what keeps a *deployment* from being switched off by
 * one caller, and they are sliced on the claimer's own count rather than the
 * network's: a session is what this route costs, so the traffic worth
 * separating is "one account attempting over and over" (which the 10/day
 * per-claimer cap already bounds, and which lands in `repeat`) from "an account
 * making its first attempt today" (`fresh`). Getting at the fresh slice at
 * scale therefore costs one *account* per four attempts — and new accounts are
 * themselves rate-limited, since registering consumes R4's unknown-address send
 * slice, 20/day by default.
 */
async function chargeClaimBudget(
  env: Env,
  userId: string,
  ip: string,
): Promise<{ allowed: boolean; refusedBy?: "global" | "claimer" | "ip" }> {
  const claimerKey = await hashToken(userId);
  const ipKey = await hashToken(networkKey(ip));
  // Every read before any write: see chargeStartBudget.
  const claimerUsed = await readBudget(env, PAIR_CLAIMER_SCOPE, claimerKey);
  const slice = sliceFor(claimerUsed);
  const globalScope = slice === "fresh" ? PAIR_CLAIM_FRESH_SCOPE : PAIR_CLAIM_REPEAT_SCOPE;
  const globalLimit =
    slice === "fresh"
      ? budgetVar(env.PAIR_CLAIM_BUDGET_FRESH, DEFAULT_CLAIM_FRESH_BUDGET)
      : budgetVar(env.PAIR_CLAIM_BUDGET_REPEAT, DEFAULT_CLAIM_REPEAT_BUDGET);
  const globalUsed = await readBudget(env, globalScope, "");
  const ipUsed = await readBudget(env, PAIR_CLAIM_IP_SCOPE, ipKey);
  if (globalUsed >= globalLimit) {
    await noteGlobalRefusal(env, PAIR_CLAIM_REFUSED_SCOPE, slice, "claim");
    return { allowed: false, refusedBy: "global" };
  }
  if (claimerUsed >= budgetVar(env.PAIR_CLAIM_BUDGET_CLAIMER, DEFAULT_CLAIMER_BUDGET)) {
    return { allowed: false, refusedBy: "claimer" };
  }
  if (ipUsed >= budgetVar(env.PAIR_CLAIM_BUDGET_IP, DEFAULT_CLAIM_IP_BUDGET)) {
    return { allowed: false, refusedBy: "ip" };
  }
  await incrementBudget(env, PAIR_CLAIMER_SCOPE, claimerKey);
  await incrementBudget(env, PAIR_CLAIM_IP_SCOPE, ipKey);
  await incrementBudget(env, globalScope, "");
  return { allowed: true };
}

/**
 * Count one attempt against a specific code and destroy it at the cap (R7).
 *
 * Increment and destruction are one `batch()` so a code cannot be left at
 * `attempts = 5` and alive. Returns true when the row is gone, which the caller
 * turns into the same not-found answer any other dead code gets — telling the
 * claimer "you just destroyed it" would confirm that the code had been real.
 */
async function chargeCodeAttempt(env: Env, id: string): Promise<boolean> {
  const results = await env.DB.batch([
    env.DB.prepare("UPDATE pairing_codes SET attempts = attempts + 1 WHERE id = ?1").bind(id),
    env.DB.prepare("DELETE FROM pairing_codes WHERE id = ?1 AND attempts >= ?2").bind(
      id,
      MAX_CODE_ATTEMPTS,
    ),
  ]);
  return (results[1]?.meta?.changes ?? 0) > 0;
}

/* -------------------------------------------------------------------------- */
/* POST /v1/device/pair/start (R6, R7)                                         */
/* -------------------------------------------------------------------------- */

/**
 * Begin a pairing request.
 *
 * Unauthenticated by necessity — a device with no credential is the entire
 * premise — and deliberately outside the CSRF gate, which protects ambient
 * browser credentials and would 403 firmware that sends no `Origin` while
 * protecting nothing (see the header comment in `auth.ts`). What bounds this
 * route is the D1 budget, charged *before* the insert.
 *
 * The response is the only time the plaintext `device_code` exists outside the
 * device: D1 holds its SHA-256 and nothing else.
 */
async function handleStart(request: Request, env: Env): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body) return json({ error: "invalid JSON body" }, 400);

  // Before the write, never after it: this is the whole bound on an
  // unauthenticated INSERT.
  if (!(await chargeStartBudget(env, clientIp(request)))) {
    return json({ error: "rate limited" }, 429);
  }

  const now = nowS();
  const deviceCode = randomToken(DEVICE_CODE_BYTES);
  const userCode = await mintUnusedUserCode(env, now);
  await env.DB.prepare(
    `INSERT INTO pairing_codes
       (id, device_code_hash, user_code, device_name, fw_version, created_at, expires_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
  )
    .bind(
      `pcd_${randomToken(12)}`,
      await hashToken(deviceCode),
      userCode,
      sanitizeMetadata(body.device_name, MAX_DEVICE_NAME_LENGTH),
      sanitizeMetadata(body.fw_version, MAX_FW_VERSION_LENGTH),
      now,
      now + PAIRING_CODE_TTL_S,
    )
    .run();

  return json({
    device_code: deviceCode,
    // Grouped for the human reading it off the screen; the server normalizes
    // the separator away again on the way back in.
    user_code: formatUserCode(userCode),
    verification_uri: `${publicOrigin(request, env)}${PAIR_VERIFICATION_PATH}`,
    expires_in: PAIRING_CODE_TTL_S,
    interval: POLL_INTERVAL_S,
  });
}

/* -------------------------------------------------------------------------- */
/* POST /v1/device/pair/poll (R6, R9; AE4)                                     */
/* -------------------------------------------------------------------------- */

/** RFC 8628 §3.5 error codes, on the 400 the RFC specifies for each. */
function pollError(code: "authorization_pending" | "expired_token" | "invalid_request"): Response {
  return json({ error: code }, 400);
}

/**
 * Collect the token, once.
 *
 * The `device_code` is read from `Authorization: Bearer` and from nowhere else.
 * A copy in the query string would be written to every access log and proxy
 * along the way and would survive in a `Referer`; a request that puts it there
 * is refused rather than honored, so a firmware bug cannot quietly downgrade
 * the credential's handling.
 *
 * Unknown, expired, and already-collected codes are one answer (`expired_token`
 * — AE4's "replay returns not found"): distinguishing them would tell a
 * device-code guesser which of their guesses had once been real.
 *
 * **This is the one route here with no D1 budget, and that is a decision, not
 * an oversight.** The lookup is a probe of the unique index on
 * `device_code_hash`: one row read on a hit and *zero* on a miss, whatever the
 * table holds — and a caller who does not hold a device code only ever misses,
 * so the traffic worth bounding is the traffic that bills nothing. Charging a
 * budget would swap that zero-row read for two `SELECT`s and an `UPSERT`, which
 * is a *write* on an unauthenticated path: the bound would cost strictly more
 * than what it bounds and would grow the table that `chargeStartBudget`'s
 * ordering exists to protect. What holds the decision up is the index, so
 * `pair.test.ts` pins `rows_read` against a populated table; a predicate that
 * stopped being index-covered would fail there rather than quietly turn every
 * poll into a scan. Request rate itself is the in-isolate bucket's job
 * (`index.ts`), sized for RFC 8628's 5-second `interval`.
 *
 * **Token rotation is specified here and not implemented** (R9, U6). Firmware
 * should treat `DEVICE_TOKEN_ROTATION_HEADER` (`X-GC-Device-Token`) on *any*
 * device-token response as "persist this value and use it from now on"; no
 * route emits it today, and a device that ignores it keeps working. Writing the
 * handling into the firmware now is what makes switching rotation on later a
 * non-breaking change rather than a fleet-wide reflash.
 */
async function handlePoll(request: Request, env: Env, url: URL): Promise<Response> {
  if (url.searchParams.has("device_code")) return pollError("invalid_request");
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) return pollError("invalid_request");
  const deviceCode = header.slice("Bearer ".length).trim();
  if (!deviceCode) return pollError("invalid_request");

  const now = nowS();
  const row = await env.DB.prepare(
    `SELECT id, device_name, fw_version, expires_at, claimed_by
       FROM pairing_codes WHERE device_code_hash = ?1`,
  )
    .bind(await hashToken(deviceCode))
    .first<{
      id: string;
      device_name: string | null;
      fw_version: string | null;
      expires_at: number;
      claimed_by: string | null;
    }>();
  if (!row || row.expires_at <= now) return pollError("expired_token");
  if (row.claimed_by === null) return pollError("authorization_pending");

  const token = `${DEVICE_TOKEN_PREFIX}${randomToken(DEVICE_TOKEN_BYTES)}`;
  const deviceId = `dev_${randomToken(12)}`;
  // One transaction, two statements, and the pairing row is the latch. The
  // INSERT selects *from* the row the DELETE removes, so a second poll running
  // as a second transaction finds nothing to select and inserts nothing — the
  // token is issued exactly once without a read-then-write anywhere. The
  // rows-affected check on the insert is what tells this caller which it was.
  const results = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO devices (id, user_id, token_hash, name, paired_at, fw_version, scopes)
       SELECT ?1, claimed_by, ?2, device_name, ?3, fw_version, ?4
         FROM pairing_codes
        WHERE id = ?5 AND claimed_by IS NOT NULL AND expires_at > ?3`,
    ).bind(deviceId, await hashToken(token), now, formatScopes(DEFAULT_DEVICE_SCOPES), row.id),
    env.DB.prepare("DELETE FROM pairing_codes WHERE id = ?1").bind(row.id),
  ]);
  if ((results[0]?.meta?.changes ?? 0) !== 1) return pollError("expired_token");

  return json({
    access_token: token,
    token_type: "Bearer",
    device_id: deviceId,
    // Sent back so the device knows what it may ask for without guessing.
    // `read:fix` is absent by design (R9) until the owner grants it.
    scopes: [...DEFAULT_DEVICE_SCOPES],
  });
}

/* -------------------------------------------------------------------------- */
/* POST /v1/pair/claim (R7, R8; AE4, AE5)                                      */
/* -------------------------------------------------------------------------- */

/**
 * One answer for a code that does not exist, has expired, is already claimed,
 * was destroyed by its attempt counter, is ambiguous, or lost a race. A
 * claimer walking the code space must not be able to tell any of those apart —
 * "expired" in particular would confirm that the code had once been real.
 */
function noSuchCode(): Response {
  return json({ error: "no pending pairing request for that code" }, 404);
}

/**
 * Attach a pending pairing request to this account.
 *
 * Session-only (R8): `authorize()` supplies the 401 and, for a session
 * credential, the CSRF gate's 403 — a cross-site page must not be able to
 * attach an attacker's board to whoever's browser it can reach. A *device*
 * credential is refused by `authorize()` itself, because this route names no
 * scope and U6 made that the fail-closed rule: a token extracted from one board
 * cannot pair a second board onto the owner's account. The explicit check below
 * is the backstop that keeps that true if this route ever gains a scope for
 * some other reason.
 *
 * Two steps, and the two-step shape is a security control, not a UI nicety
 * (RFC 8628 §5.4): the first call returns the device's self-reported metadata
 * for the confirm screen, and only a call carrying `confirm: true` binds
 * anything. A user talked into typing a code read to them over the phone gets
 * one screen that names a board they are not holding before anything happens.
 *
 * The token is never in any response here. Claim writes `claimed_by`; the
 * device collects its own credential on its next poll.
 */
async function handleClaim(request: Request, env: Env): Promise<Response> {
  const auth = await authorize(request, env);
  if (auth instanceof Response) return auth;
  if (auth.credential.kind !== "session") {
    return json({ error: "forbidden: pairing requires a browser session" }, 403);
  }
  // Any 2xx that leaves the session in place has to carry a slid cookie, and so
  // does every other answer on this route: a refused claim must not silently
  // shorten the claimer's session.
  const withSession = (res: Response): Response => {
    if (!auth.refresh) return res;
    const headers = new Headers(res.headers);
    headers.append("Set-Cookie", auth.refresh);
    return new Response(res.body, { status: res.status, headers });
  };

  const body = await readJsonBody(request);
  if (!body) return withSession(json({ error: "invalid JSON body" }, 400));
  const raw = typeof body.user_code === "string" ? body.user_code : "";
  const userCode = normalizeUserCode(raw);
  // A string that is not code-shaped at all never reaches a lookup, so it is
  // not an attempt and is not charged: a UI bug must not be able to spend the
  // user's own daily budget, and nothing about the code space is learned from
  // a rejected syntax.
  if (!userCode) return withSession(json({ error: "invalid code" }, 400));

  const budget = await chargeClaimBudget(env, auth.credential.userId, clientIp(request));
  if (!budget.allowed) {
    return withSession(json({ error: "too many pairing attempts" }, 429));
  }

  const now = nowS();
  // LIMIT 2 is the ambiguity probe: one row is a claim, two is a collision.
  const { results } = await env.DB.prepare(
    `SELECT id, device_name, fw_version FROM pairing_codes
      WHERE user_code = ?1 AND expires_at > ?2 AND claimed_by IS NULL
      ORDER BY created_at LIMIT 2`,
  )
    .bind(userCode, now)
    .all<{ id: string; device_name: string | null; fw_version: string | null }>();

  if (results.length === 0) return withSession(noSuchCode());
  if (results.length > 1) {
    // The `user_code` collision, resolved: **refuse, never choose.** Two live
    // requests share this string, and picking one — newest, oldest, either —
    // would hand this account's pairing to a device the user is not holding
    // whenever the other row is an attacker's. That is RFC 8628 §5.4's phishing
    // outcome reached by luck instead of persuasion, and no confirm screen
    // catches it, because the screen would faithfully describe the wrong board.
    // Neither row is touched: an unaimable 1-in-2.5e10 collision must not
    // become a way to burn somebody's attempt counter. The honest user asks the
    // device for a new code and the ambiguity is gone.
    console.warn(`[pair] refusing an ambiguous user_code: ${results.length} live rows`);
    return withSession(noSuchCode());
  }

  const row = results[0];
  if (body.confirm !== true) {
    // The preview is an attempt against this code (see MAX_CODE_ATTEMPTS): it
    // is the step that discloses the device's name to whoever typed the code.
    if (await chargeCodeAttempt(env, row.id)) return withSession(noSuchCode());
    return withSession(
      json(
        {
          status: "confirm",
          user_code: formatUserCode(userCode),
          device: metadata(row),
        },
        409,
      ),
    );
  }

  // The bind. Conditional UPDATE plus rows-affected, never a read-then-write:
  // two claimers who both passed the SELECT above arrive here together and
  // exactly one changes a row. Claiming also rewrites `expires_at` into the
  // short delivery window — see PAIR_DELIVERY_TTL_S.
  const claimed = await env.DB.prepare(
    `UPDATE pairing_codes SET claimed_by = ?1, claimed_at = ?2, expires_at = ?3
      WHERE id = ?4 AND claimed_by IS NULL AND expires_at > ?2`,
  )
    .bind(auth.credential.userId, now, now + PAIR_DELIVERY_TTL_S, row.id)
    .run();
  if ((claimed.meta?.changes ?? 0) !== 1) return withSession(noSuchCode());

  // No token, no device id: this browser learns only that the board it named
  // is now attached to its account. The credential goes to the device.
  return withSession(json({ ok: true, device: metadata(row) }));
}

/* -------------------------------------------------------------------------- */
/* Dispatch                                                                    */
/* -------------------------------------------------------------------------- */

export async function routePair(request: Request, env: Env, url: URL): Promise<Response> {
  if (url.pathname === "/v1/device/pair/start" && request.method === "POST") {
    return handleStart(request, env);
  }
  if (url.pathname === "/v1/device/pair/poll" && request.method === "POST") {
    return handlePoll(request, env, url);
  }
  if (url.pathname === "/v1/pair/claim" && request.method === "POST") {
    return handleClaim(request, env);
  }
  return json({ error: "not found" }, 404);
}
