import type { FeedDO } from "./feed_do";
import type { GbfsDO } from "./gbfs_do";

declare global {
  interface Env {
    DB: D1Database;
    FEED_DO: DurableObjectNamespace<FeedDO>;
    GBFS_DO: DurableObjectNamespace<GbfsDO>;
    /** Accuracy gate for locate results, meters (default 500). */
    LOCATE_MAX_ACCURACY_M?: string;
    /** Abort timeout for locate provider fetches, ms (default 2000). */
    LOCATE_TIMEOUT_MS?: string;
    /** Shared secret gating the locate diagnostics surfaces (wrangler secret). */
    DIAG_TOKEN?: string;
  }
  // `cloudflare:test`'s env (and workers-types' import { env }) are typed as
  // Cloudflare.Env; bridge the project Env into it.
  namespace Cloudflare {
    interface Env extends globalThis.Env {}
  }
}

export {};
