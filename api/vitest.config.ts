import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

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
            // Test-only shared secret so the locate diagnostics surfaces can
            // be exercised end-to-end (production uses a wrangler secret).
            miniflare: { bindings: { DIAG_TOKEN: "test-diag-token" } },
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
