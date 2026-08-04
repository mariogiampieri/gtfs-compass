/**
 * locate.ts — the spec's ordered provider chain behind one interface.
 *
 * The device never calls a geolocation provider directly: providers stay
 * swappable without reflashing, and the accuracy gate lives in exactly one
 * place (constraint #5: coarse location is gated, never trusted silently).
 *
 * **Two layers, deliberately** (Phase 5 plan, U8; R12, R13, R15):
 *
 *   `resolveFromWifi(bssids, env)`  the WiFi sub-chain — normalization, the
 *                                   10-minute BSSID-hash cache, negative
 *                                   caching — returning an **ungated** fix.
 *   `resolveLocation(ctx)`          the ordered composer: phone → wifi →
 *                                   unknown, gating **each** outcome as it
 *                                   comes back and continuing on rejection.
 *
 * The split is what makes a per-device provider expressible at all. Three
 * properties depend on the layering rather than on anyone remembering them:
 *
 *  1. **The gate runs inside the loop, per candidate, and rejection continues**
 *     (R12). A 900 m phone fix is skipped *and BeaconDB is then consulted*
 *     (AE7); the old shape broke out of the loop on the first fix and gated
 *     afterwards, which would have turned a coarse phone fix into `{known:
 *     false}` with the rest of the chain never run.
 *  2. **Nothing per-device may be cached above the BSSID-hash cache** (R15).
 *     That cache is keyed on the access points alone, so two boards in one
 *     household share its entries by construction — which is fine for a WiFi
 *     answer and would be a cross-device position leak for a phone one (AE8).
 *     The composer therefore caches nothing; only the WiFi layer does.
 *  3. **The empty-BSSID short circuit belongs to the WiFi layer**, not to the
 *     chain. A board that skipped its radio scan still has a phone provider to
 *     consult; returning `{known: false}` before the loop made that
 *     unreachable.
 *
 * The 10-minute cache now stores *ungated* positions, so a cache hit is still
 * gated by the composer — the gate is above the cache, not below it.
 */

import { type Credential, hasScope } from "./auth";
import { intVar } from "./vars";
import { type FixQuality, QUALITY_LAST_KNOWN, getFix } from "./relay";

/** A submitted access point, Ichnaea-style (BeaconDB accepts it unchanged). */
export interface WifiAccessPoint {
  macAddress: string;
  signalStrength?: number;
}

export interface LocateFix {
  lat: number;
  lon: number;
  accuracy: number;
  provider: string;
}

/**
 * "not-found": the provider answered authoritatively that it cannot place
 * this set (cacheable negative). "unavailable": timeout/network/5xx/garbage —
 * says nothing about the set, so it must never be cached as a negative.
 */
export type ProviderOutcome = LocateFix | "not-found" | "unavailable";

export type LocateProvider = (
  bssids: WifiAccessPoint[],
  env: Env,
) => Promise<ProviderOutcome>;

/**
 * What one source in the ordered chain produced, **before the gate**.
 *
 * `accuracy` is nullable because a relayed fix may carry none (the phone's
 * source could not state one) and "unknown accuracy" must be a gate decision
 * in the one place gate decisions are made, not a shape a source silently
 * drops on the floor.
 */
interface LocateCandidate {
  lat: number;
  lon: number;
  accuracy: number | null;
  provider: string;
  /** Relayed fixes only: when the *phone* fixed the position (R13). */
  capturedAt?: number;
  /** Relayed fixes only: `current` inside the 120 s horizon, else `last_known`. */
  quality?: FixQuality;
}

/**
 * The wire shape. `captured_at` and `quality` are present **only** for a
 * relayed phone fix (R13): a WiFi fix has no capture time of its own to report
 * and is current by construction, and AE9 requires that a chain resolving
 * without the relay produce byte-identical JSON to the shipped contract. The
 * device therefore reads "absent `quality`" as "a position, now".
 */
export type ResolvedLocation =
  | {
      known: true;
      lat: number;
      lon: number;
      accuracy: number;
      provider: string;
      captured_at?: number;
      quality?: FixQuality;
    }
  | { known: false };

const BEACONDB_URL = "https://api.beacondb.net/v1/geolocate";
// BeaconDB mandates an identifying User-Agent (verified in the Phase 3 plan).
const USER_AGENT = "gtfs-compass/0.1 (+https://github.com/mariogiampieri/gtfs-compass)";

export const DEFAULT_MAX_ACCURACY_M = 500;
const DEFAULT_TIMEOUT_MS = 2000;
export const MAX_BSSIDS = 50;

const CACHE_TTL_MS = 10 * 60 * 1000;


/**
 * BeaconDB — free, no key, experimental (no SLA). `considerIp: false` +
 * `fallbacks.ipf: false` so IP guesses surface as the structured 404
 * (`reason: "notFound"`) instead of a 25 km "fix". Every fetch carries an
 * abort timeout: this call sits at the front of the device's 1–2 s budget,
 * so a hung provider must degrade to `{known: false}`, never block.
 */
const beacondb: LocateProvider = async (bssids, env) => {
  const timeoutMs = intVar(env.LOCATE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(BEACONDB_URL, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        wifiAccessPoints: bssids.map(({ macAddress, signalStrength }) => ({
          macAddress,
          signalStrength,
        })),
        considerIp: false,
        fallbacks: { ipf: false },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return "unavailable"; // timeout or network error → chain degrades, never throws
  }
  if (res.status === 404) return "not-found"; // structured notFound: authoritative miss
  if (res.status !== 200) return "unavailable";
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return "unavailable";
  }
  if (typeof body !== "object" || body === null) return "unavailable";
  // Defensive: a fallback-derived fix (e.g. {"fallback":"ipf"}) is never a position.
  if ("fallback" in body) return "not-found";
  const b = body as { location?: { lat?: unknown; lng?: unknown }; accuracy?: unknown };
  const lat = b.location?.lat;
  const lon = b.location?.lng;
  const accuracy = b.accuracy;
  if (typeof lat !== "number" || typeof lon !== "number" || typeof accuracy !== "number") {
    return "unavailable";
  }
  return { lat, lon, accuracy, provider: "beacondb" };
};

/**
 * Ordered chain. Self-hosters get BeaconDB + `{known: false}` and that must
 * work fine.
 */
const providers: LocateProvider[] = [
  beacondb,
  // Unwired Labs LocationAPI slot (spec step 2): env-gated paid fallback,
  // deliberately unbuilt per the build order. When it lands it goes here,
  // invoked only when UNWIREDLABS_KEY is set.
];

/**
 * Run the WiFi providers: first fix wins, **ungated**. `definitive` is false
 * only when a transient provider failure means the negative says nothing about
 * this BSSID set.
 *
 * The gate deliberately does not live here (R12). It is applied by the composer
 * to every candidate from every source, which is what lets a rejected fix fall
 * through to the next provider instead of ending resolution.
 */
async function runWifiChain(
  bssids: WifiAccessPoint[],
  env: Env,
): Promise<{ fix: LocateFix | null; definitive: boolean }> {
  let fix: LocateFix | null = null;
  let sawTransient = false;
  for (const provider of providers) {
    const outcome = await provider(bssids, env);
    if (outcome === "unavailable") {
      sawTransient = true;
      continue;
    }
    if (outcome === "not-found") continue;
    fix = outcome;
    break;
  }
  return { fix, definitive: fix !== null || !sawTransient };
}

/* -------------------------------------------------------------------------- */
/* The accuracy gate — one implementation, one env var (constraint #5, R12)    */
/* -------------------------------------------------------------------------- */

/** The configured gate value. `walk.ts` reads the same one for its origin test. */
export function maxAccuracyM(env: Env): number {
  return intVar(env.LOCATE_MAX_ACCURACY_M, DEFAULT_MAX_ACCURACY_M);
}

/**
 * **The** accuracy gate. Every provider outcome in the chain passes through
 * this and nothing else, so "coarse location is gated, never trusted silently"
 * has exactly one implementation and exactly one env var behind it.
 *
 * An accuracy the source could not state fails closed: a position that cannot
 * show it is inside the gate is not shown to be inside the gate. It falls
 * through to the next provider like any other rejection, so the cost of failing
 * closed is a WiFi lookup, not a `{known: false}`.
 */
export function withinAccuracyGate(
  accuracy: number | null | undefined,
  env: Env,
): accuracy is number {
  if (typeof accuracy !== "number" || !Number.isFinite(accuracy)) return false;
  return accuracy <= maxAccuracyM(env);
}

/** Lowercase, drop malformed entries, dedupe by MAC (first observation wins). */
function normalizeBssids(raw: unknown[]): WifiAccessPoint[] {
  const byMac = new Map<string, WifiAccessPoint>();
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const { macAddress, signalStrength } = entry as Record<string, unknown>;
    if (typeof macAddress !== "string" || macAddress.length === 0 || macAddress.length > 64) {
      continue; // length cap: a MAC is 17 chars; oversized strings are junk or abuse
    }
    const mac = macAddress.toLowerCase();
    if (byMac.has(mac)) continue;
    byMac.set(mac, {
      macAddress: mac,
      ...(typeof signalStrength === "number" ? { signalStrength } : {}),
    });
  }
  return [...byMac.values()];
}

/** SHA-256 hex of the sorted MAC set — the cache key stores no BSSIDs. */
async function cacheKey(macs: string[]): Promise<string> {
  const canonical = [...macs].sort().join(",");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// In-isolate, best-effort (reset on isolate recycle) — same posture as the
// router's caches. Values are **ungated** WiFi outcomes; raw BSSIDs are never
// stored, and neither is anything derived from a credential (R15).
const locateCache = new Map<string, { expiresMs: number; value: LocateFix | null }>();

/**
 * The WiFi sub-chain: normalize → 10-minute BSSID-hash cache → ordered
 * providers, returning an **ungated** fix or `null`.
 *
 * Route handlers 400 oversized arrays before calling this; the slice here is
 * defense in depth so no oversized set ever reaches a provider.
 *
 * **This cache is device-agnostic and must stay that way** (R15). Its key is a
 * hash of the sorted MAC set and nothing else, so two boards in one household
 * that see the same access points share entries — correct for an answer derived
 * from those access points, and a cross-device leak for an answer derived from
 * a credential. That is the whole reason the phone provider sits *above* this
 * function rather than inside it.
 *
 * An empty or entirely malformed set short-circuits **here**, without a
 * provider call and without a cache entry. It used to short-circuit the whole
 * chain, which made a phone fix unreachable for any board that skipped its
 * radio scan.
 */
export async function resolveFromWifi(bssids: unknown[], env: Env): Promise<LocateFix | null> {
  const normalized = normalizeBssids(bssids).slice(0, MAX_BSSIDS);
  if (normalized.length === 0) return null;

  const key = await cacheKey(normalized.map((ap) => ap.macAddress));
  const now = Date.now();
  const cached = locateCache.get(key);
  if (cached && cached.expiresMs > now) {
    console.log("[locate-cache] hit");
    return cached.value;
  }
  console.log("[locate-cache] miss");

  const { fix, definitive } = await runWifiChain(normalized, env);

  // A provider outage must not pin a negative for the TTL — the next scan
  // should retry the chain the moment the provider recovers.
  if (definitive) {
    if (locateCache.size > 5000) locateCache.clear(); // crude bound, mirrors rateBuckets
    locateCache.set(key, { expiresMs: now + CACHE_TTL_MS, value: fix });
  }
  return fix;
}

/* -------------------------------------------------------------------------- */
/* The ordered chain: phone → wifi → unknown                                   */
/* -------------------------------------------------------------------------- */

/**
 * What the chain needs to resolve one request. `credential` is optional and
 * `null` is a normal value: `/v1/locate` and `/v1/nearby` are anonymous-capable
 * (R10), and an anonymous request simply has no phone provider to consult.
 */
export interface LocateContext {
  /** Raw request-supplied access points; normalized by the WiFi sub-chain. */
  bssids: unknown[];
  env: Env;
  credential?: Credential | null;
}

type LocateSource = (ctx: LocateContext) => Promise<LocateCandidate | null>;

/**
 * The relay (R12, R13). **Device credentials only, and only while the
 * credential currently carries `read:fix`** (R9, AE6d).
 *
 * The grant governs the read, not just the fan-out. `clearFix` already deletes
 * the delivered row on revocation, but that closes only the stored-state half:
 * a fix written between the revocation and the delete, or by a fan-out that
 * raced it, would otherwise keep being served to a board whose owner was told
 * the grant was off. Testing the *live* scopes on the credential the board just
 * presented is what makes revocation effective on the very next call.
 *
 * A session is not a source of device position: `hasScope` answers true for
 * sessions by design (a session is the account, not a delegation), so the
 * `kind` test is what keeps this device-only — and it is also simply required,
 * since there is no device id on a session to look a fix up by. The device id
 * comes from the credential and never from the request body: `/v1/locate`'s
 * `device_id` field is a diagnostic label anyone may send, and reading a fix by
 * it would let any caller name any board.
 */
const phoneSource: LocateSource = async (ctx) => {
  const credential = ctx.credential;
  if (!credential || credential.kind !== "device") return null;
  if (!hasScope(credential, "read:fix")) return null;

  const stored = await getFix(ctx.env, credential.deviceId);
  if (!stored) return null;
  return {
    lat: stored.lat,
    lon: stored.lon,
    accuracy: stored.accuracyM,
    provider: "phone",
    capturedAt: stored.capturedAt,
    quality: stored.quality,
  };
};

const wifiSource: LocateSource = async (ctx) => await resolveFromWifi(ctx.bssids, ctx.env);

/**
 * Ordered sources. Self-hosters get WiFi + `{known: false}` and that must work
 * fine; a deployment with no phone posting anything gets exactly today's chain.
 */
const sources: LocateSource[] = [phoneSource, wifiSource];

/**
 * Resolve a request to a gated position, or `{known: false}`.
 *
 * The loop is the whole point: every candidate is gated as it arrives and a
 * rejection **continues to the next source** rather than ending resolution
 * (R12/AE7). Nothing here is cached — see `resolveFromWifi`.
 *
 * A last-known fix (past the relay's 120 s horizon) is held rather than
 * returned: it is still a real place the user was, but anything a *live*
 * provider can resolve outranks it, so it surfaces only when the rest of the
 * chain comes back empty (R13). It carries its `captured_at` and its
 * `quality` so the device renders an age instead of a silent stale number.
 */
export async function resolveLocation(ctx: LocateContext): Promise<ResolvedLocation> {
  let lastKnown: ResolvedLocation | null = null;

  for (const source of sources) {
    const candidate = await source(ctx);
    if (!candidate) continue;
    const accuracy = candidate.accuracy;
    if (!withinAccuracyGate(accuracy, ctx.env)) continue; // reject and keep going
    const resolved = toResolved(candidate, accuracy);
    if (candidate.quality === QUALITY_LAST_KNOWN) {
      lastKnown ??= resolved;
      continue;
    }
    return resolved;
  }

  return lastKnown ?? { known: false };
}

/**
 * Key order is the wire contract: `known, lat, lon, accuracy, provider` is what
 * shipped, and the two relay fields are appended after it and only when the
 * candidate has them (AE9).
 */
function toResolved(candidate: LocateCandidate, accuracy: number): ResolvedLocation {
  return {
    known: true,
    lat: candidate.lat,
    lon: candidate.lon,
    accuracy,
    provider: candidate.provider,
    ...(candidate.quality !== undefined
      ? { captured_at: candidate.capturedAt, quality: candidate.quality }
      : {}),
  };
}

/**
 * Shared request-body validation for the two endpoints that accept a WiFi
 * scan (/v1/locate and POST /v1/nearby): JSON parse, array check, size cap —
 * one implementation so the rules can never drift apart. Returns the parsed
 * body on success, or a ready 400 Response.
 */
export async function readWifiScanBody(
  request: Request,
): Promise<{ body: Record<string, unknown>; wifiAccessPoints: unknown[] } | Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) ?? {};
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const wifiAccessPoints = body.wifiAccessPoints;
  if (!Array.isArray(wifiAccessPoints)) {
    return Response.json({ error: "wifiAccessPoints must be an array" }, { status: 400 });
  }
  // Reject oversized sets before any hashing or provider call.
  if (wifiAccessPoints.length > MAX_BSSIDS) {
    return Response.json(
      { error: `wifiAccessPoints capped at ${MAX_BSSIDS} entries` },
      { status: 400 },
    );
  }
  return { body, wifiAccessPoints };
}

/** Great-circle distance in meters — the geo primitive lives with proximity. */
export { haversineM } from "./stops";
