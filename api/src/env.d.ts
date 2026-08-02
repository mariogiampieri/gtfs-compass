import type { FeedDO } from "./feed_do";

declare global {
  interface Env {
    DB: D1Database;
    FEED_DO: DurableObjectNamespace<FeedDO>;
  }
  // `cloudflare:test`'s env (and workers-types' import { env }) are typed as
  // Cloudflare.Env; bridge the project Env into it.
  namespace Cloudflare {
    interface Env extends globalThis.Env {}
  }
}

export {};
