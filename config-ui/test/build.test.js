import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DIST_DIR, SRC_DIR, auditHtml, build } from "../build.mjs";

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

describe("R19 gate covers every navigable output type, not just .html (F10)", () => {
  // icon.svg is served at /icon.svg and is a document a browser can navigate
  // to directly, same as index.html — the audit that gated only .html would
  // never see a violation planted here, or in a future .htm/.xhtml file.
  const PROBE_BASENAME = "_r19_probe";
  const EXTENSIONS = [".html", ".htm", ".xhtml", ".svg"];

  afterEach(async () => {
    for (const ext of EXTENSIONS) {
      await rm(path.join(SRC_DIR, `${PROBE_BASENAME}${ext}`), { force: true });
    }
    // Restore dist to the clean state the earlier tests in this file assumed,
    // in case a later suite (or a re-run) reads it after this one.
    await build();
  });

  for (const ext of EXTENSIONS) {
    it(`fails the build on an inline <script> planted in a ${ext} file`, async () => {
      await writeFile(
        path.join(SRC_DIR, `${PROBE_BASENAME}${ext}`),
        "<script>alert(1)</script>\n",
      );
      await expect(build()).rejects.toThrow(/R19/);
    });
  }
});
