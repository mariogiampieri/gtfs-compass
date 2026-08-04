import path from "node:path";
import { fileURLToPath } from "node:url";

import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Workers tests run inside workerd and have no filesystem access, so the
// migration files are read here (in Node, at config time) and handed to the
// test worker as a binding. `readD1Migrations` reads the whole directory in
// migration-number order and splits each file with wrangler's own SQL splitter
// — a new migration is picked up with no edit here or in the test helper.
const migrations = await readD1Migrations(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations"),
);

// Two projects: "unit" runs pure-JS tests (protobuf decode, adapters) in node
// so they can read fixture files from disk; "workers" runs DO/router tests
// inside workerd for accurate alarm/storage semantics.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["test/unit/**/*.test.ts"],
        },
      },
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: {
              bindings: {
                // Test-only shared secret so the locate diagnostics surfaces
                // can be exercised end-to-end (production uses a wrangler
                // secret).
                DIAG_TOKEN: "test-diag-token",
                TEST_MIGRATIONS: migrations,
              },
            },
          }),
        ],
        test: {
          name: "workers",
          include: ["test/workers/**/*.test.ts"],
        },
      },
    ],
  },
});
