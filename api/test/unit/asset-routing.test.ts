import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Static-asset routing (R16/R19) against a real local `wrangler dev`.
 *
 * This does not run in the workerd vitest pool on purpose. `SELF.fetch()` in
 * `@cloudflare/vitest-pool-workers` (0.20.1) hands every request straight to
 * the user Worker: the static-asset router is not in front of it, so `/` there
 * answers the router's JSON 404 no matter what `assets` says in
 * `wrangler.jsonc`. Asserting SPA fallback or `_headers` from that pool would
 * prove nothing about production. `wrangler dev` runs the same asset router
 * the edge does, so the assertions live here where they can actually fail.
 *
 * What is at stake: an unknown `/v1/*` path must stay a JSON 404. With
 * `not_found_handling: "single-page-application"` and no `run_worker_first`,
 * it would be an HTML 200 — and a device parsing JSON that receives an HTML
 * 200 fails in the worst possible way.
 */

const apiDir = join(dirname(fileURLToPath(import.meta.url)), "../..");
const distDir = join(apiDir, "../config-ui/dist");
const PORT = 8700 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;

/**
 * An asset deliberately parked on a live API path. `run_worker_first` is the
 * only thing standing between this file and `/v1/nearby`; without a collision
 * in the tree, the routing assertion would pass for the wrong reason.
 */
const decoyDir = join(distDir, "v1");
const decoyFile = join(decoyDir, "nearby");

let server: ReturnType<typeof spawn>;
let log = "";

async function waitForReady(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/app.js`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`wrangler dev never came up on ${BASE}\n${log}`);
}

beforeAll(async () => {
  // `dist/` is build output and is not committed, so build it here rather
  // than relying on whoever invoked the suite having run `pretest`.
  execFileSync("node", [join(distDir, "../build.mjs")], { stdio: "pipe" });
  mkdirSync(decoyDir, { recursive: true });
  writeFileSync(decoyFile, "DECOY ASSET, NOT JSON\n");
  server = spawn(
    join(apiDir, "node_modules/.bin/wrangler"),
    ["dev", "--port", String(PORT), "--ip", "127.0.0.1"],
    {
      cwd: apiDir,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "true" },
    },
  );
  server.stdout?.on("data", (chunk) => (log += chunk));
  server.stderr?.on("data", (chunk) => (log += chunk));
  await waitForReady(90_000);
}, 120_000);

afterAll(() => {
  rmSync(decoyDir, { recursive: true, force: true });
  // Kill the process group: wrangler forks workerd, and killing only the
  // parent leaves a listener holding the port.
  if (server?.pid) {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill("SIGTERM");
    }
  }
});

describe("static assets in front of the API", () => {
  it("serves the SPA shell at /", async () => {
    const res = await fetch(`${BASE}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    expect(await res.text()).toContain("<title>gtfs-compass");
  });

  it("serves the shell for unknown UI paths so client-side routes survive a reload", async () => {
    const res = await fetch(`${BASE}/devices/not-a-real-route`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
  });

  it("applies the _headers CSP to the shell, with no unsafe-inline", async () => {
    const res = await fetch(`${BASE}/`);
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("unsafe-inline");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("reaches the Worker for /v1/* even when an asset shares the name", async () => {
    const res = await fetch(`${BASE}/v1/nearby`);
    // The Worker's own argument validation, not the decoy file sitting at
    // config-ui/dist/v1/nearby.
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(await res.json()).toEqual({ error: "lat and lon required" });
  });

  it("answers an unknown /v1/* path with JSON 404, never the SPA shell", async () => {
    const res = await fetch(`${BASE}/v1/does-not-exist`);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  // F11: the bare namespace root, with no trailing segment at all — distinct
  // from `/v1/does-not-exist` above, which the `/v1/*` glob is unambiguously
  // written to cover. Settled empirically rather than assumed, because a glob
  // that requires a trailing segment would let exactly this path fall through
  // to the SPA shell's HTML 200, the failure this whole suite exists to catch.
  it("answers the bare /v1 root with JSON, never the SPA shell", async () => {
    const res = await fetch(`${BASE}/v1`);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(res.status).not.toBe(200);
  });

  it("answers the bare /internal root with JSON, never the SPA shell", async () => {
    const res = await fetch(`${BASE}/internal`);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(res.status).not.toBe(200);
  });

  it("serves the auth interstitial from the Worker, with a per-request CSP nonce", async () => {
    // R19's reason for putting the callback under /v1/: `run_worker_first`
    // already covers it, so the asset router cannot answer it with the SPA
    // shell — which would deliver the most security-critical page in the app
    // under the static `script-src 'self'` policy, with its inline script
    // silently blocked and no nonce anywhere.
    const res = await fetch(`${BASE}/v1/auth/callback`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/script-src 'nonce-[A-Za-z0-9_-]+'/);
    expect(csp).not.toContain("unsafe-inline");
    expect(await res.text()).toContain("Signing in");
    // A nonce reused across responses is a nonce an injected script can quote.
    const again = await fetch(`${BASE}/v1/auth/callback`);
    expect(again.headers.get("content-security-policy")).not.toBe(csp);
  });

  it("leaves /internal/* alone", async () => {
    const res = await fetch(`${BASE}/internal/mta-subway/ace`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  it("does not serve _headers itself as an asset", async () => {
    const res = await fetch(`${BASE}/_headers`);
    expect(await res.text()).not.toContain("Content-Security-Policy:");
  });
});
