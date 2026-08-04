#!/usr/bin/env node
/**
 * config-ui build.
 *
 * There is no bundler. This UI is a shell, a form, and a button, written as
 * native ES modules that every target browser loads directly — so the build is
 * a copy plus the one check that actually matters: R19 forbids inline script
 * and inline style in the statically-served SPA, and the usual bundlers inject
 * exactly that by default (Vite's module-preload polyfill is an inline
 * `<script>`; several inline the CSS runtime). Enforcing the constraint is
 * cheaper here than configuring it away somewhere else, and the check runs on
 * the emitted output rather than on the source, so it keeps holding if a
 * bundler is introduced later behind this same entry point.
 *
 * Contract for later units: sources in `config-ui/src`, output in
 * `config-ui/dist`, which is what `api/wrangler.jsonc` points `assets.directory`
 * at. Add files to `src/`; nothing else needs to change.
 */
import { cp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const SRC_DIR = path.join(here, "src");
export const DIST_DIR = path.join(here, "dist");

/** Files that must exist in the output for the Worker to serve a usable SPA. */
const REQUIRED = ["index.html", "app.js", "styles.css", "_headers", "manifest.webmanifest"];

/**
 * Extensions the R19 audit reads. Not just `.html`: everything in `src/` is
 * copied verbatim to `dist/` and served statically, so any of these is a
 * document a browser can navigate to directly — `icon.svg` at `/icon.svg`
 * today, and whatever `.htm`/`.xhtml` a later unit adds without anyone
 * revisiting this list.
 */
const AUDITED_EXTENSIONS = [".html", ".htm", ".xhtml", ".svg"];

/**
 * Static-asset delivery cannot carry a per-request nonce, so `script-src
 * 'self'` / `style-src 'self'` is the whole policy — anything inline is simply
 * dead on arrival in the browser, silently. Failing the build is the only way
 * that stays true.
 *
 * @param {string} html
 * @returns {string[]} violations, empty when clean
 */
export function auditHtml(html) {
  const problems = [];
  for (const tag of html.match(/<script\b[^>]*>/gi) ?? []) {
    if (!/\ssrc\s*=/i.test(tag)) problems.push(`inline <script>: ${tag}`);
  }
  if (/<style\b/i.test(html)) problems.push("inline <style> block");
  const handler = html.match(/\son[a-z]+\s*=\s*["']/gi);
  if (handler) problems.push(`inline event handler attribute: ${handler.join(", ")}`);
  if (/\sstyle\s*=\s*["']/i.test(html)) problems.push("inline style attribute");
  if (/javascript:/i.test(html)) problems.push("javascript: URL");
  return problems;
}

/** @param {string} dir @returns {Promise<string[]>} paths relative to dir */
async function walk(dir, prefix = "") {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = path.join(prefix, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(path.join(dir, entry.name), rel)));
    else out.push(rel);
  }
  return out;
}

export async function build() {
  await rm(DIST_DIR, { recursive: true, force: true });
  await mkdir(DIST_DIR, { recursive: true });
  await cp(SRC_DIR, DIST_DIR, { recursive: true });

  const emitted = await walk(DIST_DIR);
  const missing = REQUIRED.filter((f) => !emitted.includes(f));
  if (missing.length > 0) {
    throw new Error(`config-ui build is missing required output: ${missing.join(", ")}`);
  }

  const violations = [];
  for (const rel of emitted) {
    if (!AUDITED_EXTENSIONS.some((ext) => rel.endsWith(ext))) continue;
    for (const problem of auditHtml(await readFile(path.join(DIST_DIR, rel), "utf8"))) {
      violations.push(`${rel}: ${problem}`);
    }
  }
  if (violations.length > 0) {
    throw new Error(
      `config-ui build violates the R19 no-inline-script/style rule:\n  ${violations.join("\n  ")}`,
    );
  }

  return { files: emitted.sort(), dist: DIST_DIR };
}

// Run the build when invoked as a script; stay side-effect-free when imported
// by the tests that assert on its output.
if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const { files } = await build();
  console.log(`config-ui → dist (${files.length} files, no inline script or style)`);
}
