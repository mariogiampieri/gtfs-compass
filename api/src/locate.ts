/**
 * locate.ts — the spec's ordered provider chain behind one interface.
 *
 * The device never calls a geolocation provider directly: providers stay
 * swappable without reflashing, and the accuracy gate lives in exactly one
 * place (constraint #5: coarse location is gated, never trusted silently).
 */

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

export type ResolvedLocation =
  | { known: true; lat: number; lon: number; accuracy: number; provider: string }
  | { known: false };

const BEACONDB_URL = "https://api.beacondb.net/v1/geolocate";
// BeaconDB mandates an identifying User-Agent (verified in the Phase 3 plan).
const USER_AGENT = "gtfs-compass/0.1 (+https://github.com/mariogiampieri/gtfs-compass)";

const DEFAULT_MAX_ACCURACY_M = 500;
const DEFAULT_TIMEOUT_MS = 2000;
export const MAX_BSSIDS = 50;

const CACHE_TTL_MS = 10 * 60 * 1000;

function intVar(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

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
 * Run the chain: first provider fix wins, then the accuracy gate is applied
 * AFTER the providers (the gate lives in the chain, not in any provider).
 * `definitive` is false only when a transient provider failure means the
 * negative says nothing about this BSSID set.
 */
async function runChain(
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
  if (!fix) return { fix: null, definitive: !sawTransient };
  const maxAccuracy = intVar(env.LOCATE_MAX_ACCURACY_M, DEFAULT_MAX_ACCURACY_M);
  if (fix.accuracy > maxAccuracy) {
    return { fix: null, definitive: true }; // never pass a too-coarse fix through
  }
  return { fix, definitive: true };
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
// router's caches. Values are resolved outcomes; raw BSSIDs are never stored.
const locateCache = new Map<string, { expiresMs: number; value: ResolvedLocation }>();

/**
 * Resolve a submitted BSSID set to a gated position, or `{known: false}`.
 * Route handlers 400 oversized arrays before calling this; the slice here is
 * defense in depth so no oversized set ever reaches a provider.
 */
export async function resolveLocation(bssids: unknown[], env: Env): Promise<ResolvedLocation> {
  const normalized = normalizeBssids(bssids).slice(0, MAX_BSSIDS);
  if (normalized.length === 0) return { known: false };

  const key = await cacheKey(normalized.map((ap) => ap.macAddress));
  const now = Date.now();
  const cached = locateCache.get(key);
  if (cached && cached.expiresMs > now) {
    console.log("[locate-cache] hit");
    return cached.value;
  }
  console.log("[locate-cache] miss");

  const { fix, definitive } = await runChain(normalized, env);
  const value: ResolvedLocation = fix
    ? { known: true, lat: fix.lat, lon: fix.lon, accuracy: fix.accuracy, provider: fix.provider }
    : { known: false };

  // A provider outage must not pin {known:false} for the TTL — the next scan
  // should retry the chain the moment the provider recovers.
  if (fix || definitive) {
    if (locateCache.size > 5000) locateCache.clear(); // crude bound, mirrors rateBuckets
    locateCache.set(key, { expiresMs: now + CACHE_TTL_MS, value });
  }
  return value;
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
