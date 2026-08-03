import { DurableObject } from "cloudflare:workers";

import { type Arrival, ParseError, feedHeaderTimestamp, getAdapter, groupUrlsFor } from "./adapters";
import {
  batchIdsParam,
  type DoIdentity,
  FETCH_TIMEOUT_MS,
  IDLE_SUSPEND_MS,
  MissingFeedError,
  doTag,
} from "./do_shared";

export { FETCH_TIMEOUT_MS, IDLE_SUSPEND_MS } from "./do_shared";

export const POLL_INTERVAL_MS = 20_000;
export const ARRIVALS_PER_ROUTE = 8; // per (stop, route): the trunk-detail screen scrolls all upcoming

// Chunked persistence (bus-scale snapshots exceed the ~128 KiB KV value
// limit ~20×): a snapshot whose JSON outgrows one value is gzipped and split
// across `snapshot_chunk:N` entries governed by `snapshot_meta`. Small
// snapshots keep the legacy `snapshot` key byte-identically. Exactly one
// format exists after any successful persist (both crossings clean up the
// other's keys in the same atomic batch).
const LEGACY_SNAPSHOT_KEY = "snapshot";
const META_KEY = "snapshot_meta";
const CHUNK_PREFIX = "snapshot_chunk:";
const CHUNK_BYTES = 90 * 1024; // headroom under the 128 KiB per-value limit
export const MAX_CHUNKS = 127; // +1 meta = the 128-entry transactional put ceiling

interface Snapshot {
  arrivals: Record<string, Arrival[]>;
  fetchedAtMs: number; // wall clock at fetch start
  headerTimestamp: number; // feed generation time (epoch seconds)
}

interface SnapshotMeta {
  chunks: number;
  totalBytes: number; // compressed byte length — torn restores fail the join check
  encoding: "gzip";
  fetchedAtMs: number;
}

interface FeedConfig {
  rtTripUrl: string;
  adapter: string;
  rtNeedsKey: boolean;
}

async function gzipBytes(data: Uint8Array, mode: "gzip" | "gunzip"): Promise<Uint8Array> {
  const stream = new Blob([data.slice().buffer as ArrayBuffer]).stream().pipeThrough(
    mode === "gzip" ? new CompressionStream("gzip") : new DecompressionStream("gzip"),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** RT_FEED_KEYS secret (JSON feed id → key), parsed once per isolate. A
 * malformed secret degrades exactly like a missing one — the parse error is
 * never logged with content (V8 SyntaxErrors embed source snippets). */
let feedKeysMemo: Record<string, string> | null = null;
let feedKeysWarned = false;
export function feedKeys(env: Env): Record<string, string> {
  if (feedKeysMemo === null) {
    try {
      const parsed: unknown = env.RT_FEED_KEYS ? JSON.parse(env.RT_FEED_KEYS) : {};
      feedKeysMemo =
        typeof parsed === "object" && parsed !== null
          ? Object.fromEntries(
              Object.entries(parsed).filter(([, v]) => typeof v === "string"),
            )
          : {};
    } catch {
      if (!feedKeysWarned) {
        feedKeysWarned = true;
        console.warn("RT_FEED_KEYS is not valid JSON; treating all feeds as keyless");
      }
      feedKeysMemo = {};
    }
  }
  return feedKeysMemo;
}

/** Test seam: reset the isolate memo (secrets change only via redeploy). */
export function resetFeedKeysForTests(): void {
  feedKeysMemo = null;
  feedKeysWarned = false;
}

/**
 * One DO per feed group ("{feed_id}:{group}"). Polls upstream on a 20 s alarm
 * while devices are reading; self-suspends after 10 idle minutes; serves the
 * last snapshot instantly and refreshes behind. Concurrency discipline per
 * docs/plans/2026-08-02-002: reschedule-first alarm that never throws, one
 * refresh in flight, storage-await-only read-path arming, newer-only stores.
 */
export class FeedDO extends DurableObject<Env> {
  private snapshot: Snapshot | null = null;
  private identity: DoIdentity | null = null;
  private lastReadMs = 0;
  private lastPersistedReadMs = 0;
  private refreshInFlight = false;
  private configPromise: Promise<FeedConfig> | null = null;
  private configMissing = false;
  private configMissingSinceMs = 0;
  private keylessWarned = false;
  private lastFetchKeyed = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Storage-only restore: warm restart serves the last snapshot (R4).
    // Meta-first (chunked format), legacy-key fallback — the fallback IS the
    // format migration for pre-chunking deployments.
    ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get<unknown>([
        LEGACY_SNAPSHOT_KEY,
        META_KEY,
        "identity",
        "last_read",
      ]);
      const map = stored as Map<string, unknown>;
      const meta = map.get(META_KEY) as SnapshotMeta | undefined;
      if (meta) {
        this.snapshot = await this.restoreChunked(meta);
      } else {
        this.snapshot = (map.get(LEGACY_SNAPSHOT_KEY) as Snapshot | undefined) ?? null;
      }
      this.identity = (map.get("identity") as DoIdentity | undefined) ?? null;
      this.lastReadMs = (map.get("last_read") as number | undefined) ?? 0;
      this.lastPersistedReadMs = this.lastReadMs;
    });
  }

  /** Join + validate + decompress the chunked format; any mismatch deletes
   * the bad keys and restores as "no data yet" (next refresh recovers). */
  private async restoreChunked(meta: SnapshotMeta): Promise<Snapshot | null> {
    try {
      const keys = Array.from({ length: meta.chunks }, (_, i) => `${CHUNK_PREFIX}${i}`);
      const stored = (await this.ctx.storage.get<ArrayBuffer>(keys)) as Map<string, ArrayBuffer>;
      let total = 0;
      const parts: Uint8Array[] = [];
      for (const key of keys) {
        const part = stored.get(key);
        if (!part) throw new Error(`missing ${key}`);
        parts.push(new Uint8Array(part));
        total += part.byteLength;
      }
      if (meta.chunks !== parts.length || total !== meta.totalBytes) {
        throw new Error(`torn chunked snapshot: ${parts.length}/${meta.chunks} chunks, ${total}/${meta.totalBytes} bytes`);
      }
      const joined = new Uint8Array(total);
      let offset = 0;
      for (const part of parts) {
        joined.set(part, offset);
        offset += part.byteLength;
      }
      const json = new TextDecoder().decode(await gzipBytes(joined, "gunzip"));
      return JSON.parse(json) as Snapshot;
    } catch (error) {
      console.warn(`${doTag(this.identity)} chunked snapshot restore failed; clearing:`, error);
      await this.deleteChunkedKeys();
      return null;
    }
  }

  private async deleteChunkedKeys(): Promise<void> {
    const chunkKeys = [...(await this.ctx.storage.list({ prefix: CHUNK_PREFIX })).keys()];
    await this.ctx.storage.delete([META_KEY, ...chunkKeys]);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const single = url.pathname.match(/^\/stop\/([^/]+)$/);
    const batch = url.pathname === "/stops";
    const feedId = url.searchParams.get("feed");
    const group = url.searchParams.get("group");
    if ((!single && !batch) || !feedId || !group) {
      return Response.json({ error: "bad request" }, { status: 400 });
    }
    if (this.configMissing) {
      // Natural recovery: under continuous polling the DO stays resident, so
      // a memory-only flag would pin 404 forever after the feeds row is
      // fixed. One retry per poll interval falls through to arm-and-refresh,
      // which re-runs loadConfig against D1.
      if (Date.now() - this.configMissingSinceMs <= POLL_INTERVAL_MS) {
        return Response.json({ error: `unknown feed: ${feedId}` }, { status: 404 });
      }
      this.configMissing = false;
    }
    const stopIds = single ? [decodeURIComponent(single[1])] : (batchIdsParam(url) ?? []);
    const now = Date.now();

    // Input-gated sequence: storage awaits only, no interleaving point.
    this.lastReadMs = now;
    if (!this.identity) {
      this.identity = { feedId, group };
      await this.ctx.storage.put("identity", this.identity);
    }
    if (now - this.lastPersistedReadMs > POLL_INTERVAL_MS) {
      // Hibernation between sparse reads is the common case; a memory-only
      // stamp would be forgotten and the DO could suspend mid-usage.
      await this.ctx.storage.put("last_read", now);
      this.lastPersistedReadMs = now;
    }
    const pending = await this.ctx.storage.getAlarm();
    const arming = pending === null;
    if (arming) {
      await this.ctx.storage.setAlarm(now + POLL_INTERVAL_MS);
    }

    const response = single
      ? this.stopResponse(stopIds[0], group, now)
      : this.stopsResponse(stopIds, group, now);
    if (arming) {
      this.ctx.waitUntil(this.refresh());
    }
    return response;
  }

  async alarm(): Promise<void> {
    // Total handler: exception-driven retries are intentionally unreachable;
    // the 20 s cadence is the retry policy. Duplicate (at-least-once)
    // invocations are idempotent: setAlarm overrides, refresh single-flights.
    try {
      if (!this.identity) return; // pre-first-read alarm: nothing to poll

      const now = Date.now();
      if (this.lastReadMs > this.lastPersistedReadMs) {
        await this.ctx.storage.put("last_read", this.lastReadMs);
        this.lastPersistedReadMs = this.lastReadMs;
      }
      if (now - this.lastReadMs >= IDLE_SUSPEND_MS) {
        return; // self-suspend: no reschedule (R2)
      }
      await this.ctx.storage.setAlarm(now + POLL_INTERVAL_MS); // reschedule-first
      await this.refresh();
    } catch (error) {
      console.error(`${this.tag()} alarm cycle failed (loop already re-armed):`, error);
    }
  }

  private tag(): string {
    return doTag(this.identity);
  }

  /** Fetch + parse + store, single-flight, newer-only. Never throws. */
  private async refresh(): Promise<void> {
    if (this.refreshInFlight || !this.identity) return;
    this.refreshInFlight = true;
    const fetchStartMs = Date.now();
    try {
      const config = await this.loadConfig(this.identity.feedId);
      this.configMissing = false; // a later-fixed feeds row must recover reads
      let url = groupUrlsFor(config.adapter, config.rtTripUrl)?.[this.identity.group];
      if (!url) {
        console.warn(`${this.tag()} adapter ${config.adapter} has no group ${this.identity.group}`);
        return;
      }

      // rt_needs_key feeds get their key from the RT_FEED_KEYS secret; a
      // missing entry degrades keyless (currently works upstream) with one
      // warning per DO lifetime. The composed URL is never logged.
      this.lastFetchKeyed = false;
      if (config.rtNeedsKey) {
        const key = feedKeys(this.env)[this.identity.feedId];
        if (key) {
          url += (url.includes("?") ? "&" : "?") + `key=${encodeURIComponent(key)}`;
          this.lastFetchKeyed = true;
        } else if (!this.keylessWarned) {
          this.keylessWarned = true;
          console.warn(`${this.tag()} rt_needs_key set but no RT_FEED_KEYS entry; polling keyless`);
        }
      }

      const upstream = await fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!upstream.ok) {
        if (config.rtNeedsKey && !this.lastFetchKeyed && (upstream.status === 401 || upstream.status === 403)) {
          // Distinguishable from a transient failure: the documented key
          // requirement has probably started being enforced.
          console.warn(
            `${this.tag()} keyless poll rejected (${upstream.status}) — upstream key enforcement may have begun; install RT_FEED_KEYS`,
          );
        } else {
          console.warn(`${this.tag()} upstream ${upstream.status}; keeping old snapshot`);
        }
        return;
      }
      const buf = new Uint8Array(await upstream.arrayBuffer());

      let headerTimestamp = feedHeaderTimestamp(buf);
      // A far-future header timestamp must never become the persisted
      // high-water mark — it would reject every correct feed forever.
      if (headerTimestamp > Math.floor(fetchStartMs / 1000) + 300) {
        console.warn(`${this.tag()} implausible header timestamp ${headerTimestamp}; ignoring`);
        headerTimestamp = 0;
      }
      // Frozen upstream: HTTP 200 but the feed hasn't advanced. Treat as a
      // failed fetch so staleness becomes visible (spec constraint #5).
      // Feeds that omit the optional header timestamp (0) skip this gate.
      if (this.snapshot && headerTimestamp > 0 && headerTimestamp <= this.snapshot.headerTimestamp) {
        console.warn(`${this.tag()} feed header not advancing (${headerTimestamp}); keeping old snapshot`);
        return;
      }
      if (this.snapshot && fetchStartMs <= this.snapshot.fetchedAtMs) {
        return; // stale-ordered write from an older interleaved fetch
      }

      const nowSec = Math.floor(fetchStartMs / 1000);
      const parsed = getAdapter(config.adapter).parse(buf, nowSec);
      const snapshot: Snapshot = {
        arrivals: trimPerRoute(parsed),
        fetchedAtMs: fetchStartMs,
        headerTimestamp,
      };
      // Persist first, then flip memory: a failed put must not leave the live
      // instance serving data that regresses on the next warm restart (R4).
      // The only exception is the explicit >MAX_CHUNKS refusal, where memory
      // deliberately serves fresh over a stale persisted state.
      await this.persistSnapshot(snapshot);
      this.snapshot = snapshot;
    } catch (error) {
      if (error instanceof MissingFeedError) {
        this.configMissing = true;
        this.configMissingSinceMs = Date.now();
      } else if (error instanceof ParseError) {
        console.warn(`${this.tag()} unparseable upstream feed; keeping old snapshot:`, error.message);
      } else if (this.lastFetchKeyed) {
        // Fetch errors can embed the request URL (with ?key=) in message or
        // cause — keyed feeds log a scrubbed line only.
        console.warn(
          `${this.tag()} refresh failed (keyed feed; error scrubbed): ${error instanceof Error ? error.name : "Error"}`,
        );
      } else {
        console.warn(`${this.tag()} refresh failed; keeping old snapshot:`, error);
      }
    } finally {
      this.refreshInFlight = false;
    }
  }

  /**
   * One-format-on-disk persistence. Small snapshots write the legacy key
   * exactly as before (subway's unchanged, rollback-safe path); oversized
   * ones gzip and chunk. Both crossings delete the other format's keys in
   * the same coalesced batch as the write, and memory is flipped by the
   * caller only after this resolves (persist-before-flip).
   */
  private async persistSnapshot(snapshot: Snapshot): Promise<void> {
    const jsonBytes = new TextEncoder().encode(JSON.stringify(snapshot));
    const existingChunks = [...(await this.ctx.storage.list({ prefix: CHUNK_PREFIX })).keys()];

    if (jsonBytes.length <= CHUNK_BYTES) {
      // Legacy path: same object put as always; clean chunked keys if we are
      // crossing back down so meta-first restore can't resurrect stale data.
      const put = this.ctx.storage.put(LEGACY_SNAPSHOT_KEY, snapshot);
      const cleanup = existingChunks.length
        ? this.ctx.storage.delete([META_KEY, ...existingChunks])
        : null;
      await Promise.all(cleanup ? [put, cleanup] : [put]);
      return;
    }

    const gz = await gzipBytes(jsonBytes, "gzip");
    const chunkCount = Math.ceil(gz.length / CHUNK_BYTES);
    if (chunkCount > MAX_CHUNKS) {
      // Refusal, not a throw: memory serves fresh, persisted state stays at
      // the previous complete snapshot, and the condition is loud.
      console.error(
        `${this.tag()} snapshot needs ${chunkCount} chunks (max ${MAX_CHUNKS}, ~${Math.round(gz.length / 1024)} KiB compressed); persist refused`,
      );
      return;
    }
    const entries: Record<string, unknown> = {};
    for (let i = 0; i < chunkCount; i++) {
      entries[`${CHUNK_PREFIX}${i}`] = gz.slice(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES).buffer;
    }
    const meta: SnapshotMeta = {
      chunks: chunkCount,
      totalBytes: gz.length,
      encoding: "gzip",
      fetchedAtMs: snapshot.fetchedAtMs,
    };
    entries[META_KEY] = meta;
    const stale = [
      LEGACY_SNAPSHOT_KEY,
      ...existingChunks.filter((key) => Number(key.slice(CHUNK_PREFIX.length)) >= chunkCount),
    ];
    // Issued without intervening awaits so the platform coalesces them into
    // one atomic write batch (verified by test, not asserted by comment).
    const put = this.ctx.storage.put(entries);
    const del = this.ctx.storage.delete(stale);
    await Promise.all([put, del]);
  }

  private loadConfig(feedId: string): Promise<FeedConfig> {
    if (!this.configPromise) {
      this.configPromise = (async () => {
        const row = await this.env.DB.prepare(
          "SELECT rt_trip_url, adapter, rt_needs_key FROM feeds WHERE id = ?",
        )
          .bind(feedId)
          .first<{ rt_trip_url: string | null; adapter: string | null; rt_needs_key: number | null }>();
        if (!row?.rt_trip_url || !row.adapter) {
          throw new MissingFeedError(feedId);
        }
        return { rtTripUrl: row.rt_trip_url, adapter: row.adapter, rtNeedsKey: row.rt_needs_key === 1 };
      })();
      // Clear on rejection so a transient D1 error doesn't pin failure.
      this.configPromise.catch(() => {
        this.configPromise = null;
      });
    }
    return this.configPromise;
  }

  private stopResponse(stopId: string, group: string, nowMs: number): Response {
    if (!this.snapshot) {
      // First-ever read: "no data yet" — distinct from no-service (fetched_at null).
      return Response.json({ fetched_at: null, group, arrivals: [] });
    }
    const nowSec = Math.floor(nowMs / 1000);
    // hasOwn guard: stop ids are caller-controlled and storage round-trips
    // restore Object.prototype, so "constructor" etc. must not hit the chain.
    const stored = Object.hasOwn(this.snapshot.arrivals, stopId)
      ? this.snapshot.arrivals[stopId]
      : [];
    const arrivals = stored.filter(
      (a) => a.time >= nowSec, // same boundary rule as the adapter's write-trim
    );
    return Response.json({
      fetched_at: Math.floor(this.snapshot.fetchedAtMs / 1000),
      group,
      arrivals,
    });
  }

  /**
   * Batch read for composition: one snapshot lookup per group per request
   * instead of one per platform. Same first-read/staleness contract as the
   * single-stop route; every requested id is present (empty when unknown).
   */
  private stopsResponse(stopIds: string[], group: string, nowMs: number): Response {
    // Object.create(null): stop ids are caller-controlled; "__proto__" etc.
    // must land as own keys, mirroring trimPerRoute and GbfsDO.
    if (!this.snapshot) {
      const empty: Record<string, Arrival[]> = Object.create(null);
      for (const id of stopIds) empty[id] = [];
      return Response.json({ fetched_at: null, group, stops: empty });
    }
    const nowSec = Math.floor(nowMs / 1000);
    const stops: Record<string, Arrival[]> = Object.create(null);
    for (const id of stopIds) {
      const stored = Object.hasOwn(this.snapshot.arrivals, id) ? this.snapshot.arrivals[id] : [];
      stops[id] = stored.filter((a) => a.time >= nowSec);
    }
    return Response.json({
      fetched_at: Math.floor(this.snapshot.fetchedAtMs / 1000),
      group,
      stops,
    });
  }
}

/** Keep the next ARRIVALS_PER_ROUTE arrivals per (stop, route), merged sorted. */
export function trimPerRoute(byStop: Map<string, Arrival[]>): Record<string, Arrival[]> {
  const out: Record<string, Arrival[]> = Object.create(null); // no prototype keys
  for (const [stopId, arrivals] of byStop) {
    const perRoute = new Map<string, number>();
    const kept: Arrival[] = [];
    for (const arrival of arrivals) {
      // arrivals are sorted ascending by the adapter
      const count = perRoute.get(arrival.routeId) ?? 0;
      if (count < ARRIVALS_PER_ROUTE) {
        kept.push(arrival);
        perRoute.set(arrival.routeId, count + 1);
      }
    }
    out[stopId] = kept;
  }
  return out;
}
