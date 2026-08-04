import type { AlertDO } from "./alerts_do";
import type { FeedDO } from "./feed_do";
import type { GbfsDO } from "./gbfs_do";

declare global {
  interface Env {
    DB: D1Database;
    FEED_DO: DurableObjectNamespace<FeedDO>;
    GBFS_DO: DurableObjectNamespace<GbfsDO>;
    ALERT_DO: DurableObjectNamespace<AlertDO>;
    /** Curated-feed allowlist (wrangler vars, JSON array of feed ids). */
    CURATED_FEEDS?: string[];
    /** Accuracy gate for locate results, meters (default 500). */
    LOCATE_MAX_ACCURACY_M?: string;
    /** Abort timeout for locate provider fetches, ms (default 2000). */
    LOCATE_TIMEOUT_MS?: string;
    /** Shared secret gating the locate diagnostics surfaces (wrangler secret). */
    DIAG_TOKEN?: string;
    /** JSON map of feed id → realtime API key for rt_needs_key feeds
     * (wrangler secret, e.g. {"mta-bus": "..."}). */
    RT_FEED_KEYS?: string;
    /**
     * Auth bypass (R5). The **exact** string "single" binds every request to
     * the synthetic user `usr_single` and skips login; anything unset or
     * unrecognized fails closed to multi-user. Browser-only controls still
     * apply, so this is safe only behind a network-level control.
     */
    AUTH_MODE?: string;
    /** Sliding session window in days (default 30, renewed at half-life). */
    SESSION_TTL_DAYS?: string;
    /** Absolute session lifetime in days from created_at (default 180). */
    SESSION_ABSOLUTE_TTL_DAYS?: string;
  }
  // `cloudflare:test`'s env (and workers-types' import { env }) are typed as
  // Cloudflare.Env; bridge the project Env into it.
  namespace Cloudflare {
    interface Env extends globalThis.Env {}
  }
}

export {};
