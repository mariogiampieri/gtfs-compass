import type { D1Migration } from "@cloudflare/vitest-pool-workers";

// `cloudflare:test`'s `env` is typed `Cloudflare.Env`, which src/env.d.ts
// bridges to the project `Env`. TEST_MIGRATIONS is bound only by
// vitest.config.ts, so it is declared on the test-side interface and stays off
// the production `Env` that the Worker's handlers receive.
declare global {
  namespace Cloudflare {
    interface Env {
      /** api/migrations, read in Node at config time — workerd has no filesystem. */
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

export {};
