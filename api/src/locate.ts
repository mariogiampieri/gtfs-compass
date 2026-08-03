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

export type LocateProvider = (
  bssids: WifiAccessPoint[],
  env: Env,
) => Promise<LocateFix | null>;

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
    return null; // timeout or network error → chain degrades, never throws
  }
  if (res.status !== 200) return null; // includes the structured 404 notFound
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null) return null;
  // Defensive: a fallback-derived fix (e.g. {"fallback":"ipf"}) is never a position.
  if ("fallback" in body) return null;
  const b = body as { location?: { lat?: unknown; lng?: unknown }; accuracy?: unknown };
  const lat = b.location?.lat;
  const lon = b.location?.lng;
  const accuracy = b.accuracy;
  if (typeof lat !== "number" || typeof lon !== "number" || typeof accuracy !== "number") {
    return null;
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
 */
async function runChain(bssids: WifiAccessPoint[], env: Env): Promise<LocateFix | null> {
  let fix: LocateFix | null = null;
  for (const provider of providers) {
    fix = await provider(bssids, env);
    if (fix) break;
  }
  if (!fix) return null;
  const maxAccuracy = intVar(env.LOCATE_MAX_ACCURACY_M, DEFAULT_MAX_ACCURACY_M);
  if (fix.accuracy > maxAccuracy) return null; // never pass a too-coarse fix through
  return fix;
}

/** Lowercase, drop malformed entries, dedupe by MAC (first observation wins). */
function normalizeBssids(raw: unknown[]): WifiAccessPoint[] {
  const byMac = new Map<string, WifiAccessPoint>();
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const { macAddress, signalStrength } = entry as Record<string, unknown>;
    if (typeof macAddress !== "string" || macAddress.length === 0) continue;
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

  const fix = await runChain(normalized, env);
  const value: ResolvedLocation = fix
    ? { known: true, lat: fix.lat, lon: fix.lon, accuracy: fix.accuracy, provider: fix.provider }
    : { known: false };

  if (locateCache.size > 5000) locateCache.clear(); // crude bound, mirrors rateBuckets
  locateCache.set(key, { expiresMs: now + CACHE_TTL_MS, value });
  return value;
}

/** Great-circle distance in meters. Shared by locate diagnostics and proximity. */
export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
