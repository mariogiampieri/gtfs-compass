import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { DIST_DIR, auditHtml, build } from "../build.mjs";

/** @type {{files: string[]}} */
let output;

beforeAll(async () => {
  output = await build();
});

const read = (rel) => readFile(path.join(DIST_DIR, rel), "utf8");

describe("config-ui build output", () => {
  it("emits the files the Worker's assets.directory expects", () => {
    for (const file of ["index.html", "app.js", "auth.js", "geo.js", "mode.js", "styles.css"]) {
      expect(output.files).toContain(file);
    }
  });

  it("contains no inline <script> anywhere (R19: script-src 'self', no nonce possible)", async () => {
    const html = await read("index.html");
    // The scanner the build gates on, re-run against the shipped bytes so this
    // is an assertion about the asset, not about the scanner.
    expect(auditHtml(html)).toEqual([]);
    for (const tag of html.match(/<script\b[^>]*>/gi) ?? []) {
      expect(tag).toMatch(/\ssrc\s*=/i);
    }
    expect(html).not.toMatch(/<style\b/i);
  });

  it("fails the build when an inline script sneaks in", () => {
    expect(auditHtml('<script>alert(1)</script>')).toHaveLength(1);
    expect(auditHtml('<button onclick="go()">x</button>')).toHaveLength(1);
    expect(auditHtml('<p style="color:red">x</p>')).toHaveLength(1);
    expect(auditHtml('<script type="module" src="/app.js"></script>')).toEqual([]);
    // Attributes that merely start with "on"-looking text are not handlers.
    expect(auditHtml('<input autocapitalize="off" spellcheck="false" />')).toEqual([]);
  });

  it("ships a _headers file whose CSP covers the shell", async () => {
    const headers = await read("_headers");
    expect(headers).toMatch(/^\/\*$/m);
    const csp = headers.match(/Content-Security-Policy:(.*)/)?.[1] ?? "";
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("unsafe-inline");
    expect(headers).toContain("X-Content-Type-Options: nosniff");
    expect(headers).toContain("Referrer-Policy: no-referrer");
  });

  it("is installable as a PWA from the same origin as /v1/*", async () => {
    const manifest = JSON.parse(await read("manifest.webmanifest"));
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.icons.length).toBeGreaterThan(0);
    expect(await read("index.html")).toContain('rel="manifest"');
  });

  it("loads every script and style from this origin, never a CDN", async () => {
    const html = await read("index.html");
    for (const url of html.match(/(?:src|href)="([^"]+)"/g) ?? []) {
      expect(url).not.toMatch(/https?:\/\//);
    }
  });
});
