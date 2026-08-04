// @vitest-environment happy-dom
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { PAIRED_MESSAGE, PAIR_NOT_COMPLETED_MESSAGE } from "../src/devices.js";

/**
 * The wiring in `app.js` (U10; R8).
 *
 * Everything `app.js` *decides* lives in the pure modules and is tested there.
 * What is left here is control flow — which message is shown, and which of
 * "reset the form" / "re-read the list" happen — and that is only observable by
 * running the module against a DOM. So the shell is the real `index.html`
 * body, not a hand-built fixture: a test that invented its own element ids
 * would keep passing after the markup they came from was renamed.
 *
 * The network seams are mocked at the module boundary rather than at `fetch`,
 * because the claim under test is about what `app.js` does with a *result*,
 * including result shapes today's server does not produce.
 */

const mocks = vi.hoisted(() => ({
  claimCode: vi.fn(),
  fetchDevices: vi.fn(),
  setScope: vi.fn(),
  unpairDevice: vi.fn(),
  fetchAuthMode: vi.fn(),
  requestMagicLink: vi.fn(),
}));

vi.mock("../src/devices.js", async (importOriginal) => ({
  ...(await importOriginal()),
  claimCode: mocks.claimCode,
  fetchDevices: mocks.fetchDevices,
  setScope: mocks.setScope,
  unpairDevice: mocks.unpairDevice,
}));

vi.mock("../src/mode.js", async (importOriginal) => ({
  ...(await importOriginal()),
  fetchAuthMode: mocks.fetchAuthMode,
}));

vi.mock("../src/auth.js", async (importOriginal) => ({
  ...(await importOriginal()),
  requestMagicLink: mocks.requestMagicLink,
}));

const here = path.dirname(fileURLToPath(import.meta.url));
const html = await readFile(path.join(here, "../src/index.html"), "utf8");
const BODY = html.slice(html.indexOf("<body>") + "<body>".length, html.indexOf("</body>"));

/** One turn of the macrotask queue — long enough for the mounted handlers. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function mount() {
  document.body.innerHTML = BODY;
  vi.resetModules();
  await import("../src/app.js");
  await settle();
}

const byId = (id) => document.getElementById(id);

/** Type a code and submit it, landing on the confirm screen. */
async function openConfirm(code = "BCDF-GHJK") {
  byId("pair-code").value = code;
  byId("pair-form").dispatchEvent(new Event("submit", { cancelable: true }));
  await settle();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchAuthMode.mockResolvedValue("multi");
  mocks.fetchDevices.mockResolvedValue({ state: "ok", devices: [] });
  mocks.claimCode.mockResolvedValue({ state: "error", message: "unused" });
});

describe("the confirm step reports what actually happened (R8)", () => {
  it("pairs, clears the form and re-reads the list on a paired result", async () => {
    mocks.claimCode
      .mockResolvedValueOnce({ state: "confirm", code: "BCDFGHJK", device: { name: "Kitchen" } })
      .mockResolvedValueOnce({ state: "paired", code: "BCDFGHJK", device: {}, message: PAIRED_MESSAGE });

    await mount();
    await openConfirm();
    expect(byId("pair-confirm").hidden).toBe(false);

    const reads = mocks.fetchDevices.mock.calls.length;
    byId("pair-confirm-yes").dispatchEvent(new Event("click"));
    await settle();

    expect(byId("pair-status").textContent).toBe(PAIRED_MESSAGE);
    expect(byId("pair-code").value).toBe("");
    expect(mocks.fetchDevices.mock.calls.length).toBe(reads + 1);
  });

  it("does not announce a pairing for a result that is not one (F9)", async () => {
    // `claimCode` maps *every* 409 to a confirm result with no message, so the
    // fallback fires on a non-paired outcome. Unreachable against today's
    // server — and this is the one screen whose job is telling the user what
    // got attached to their account, so it fails closed or not at all.
    mocks.claimCode
      .mockResolvedValueOnce({ state: "confirm", code: "BCDFGHJK", device: { name: "Kitchen" } })
      .mockResolvedValueOnce({ state: "confirm", code: "BCDFGHJK", device: {} });

    await mount();
    await openConfirm();

    const reads = mocks.fetchDevices.mock.calls.length;
    byId("pair-confirm-yes").dispatchEvent(new Event("click"));
    await settle();

    expect(byId("pair-status").textContent).not.toContain("Paired");
    expect(byId("pair-status").textContent).toBe(PAIR_NOT_COMPLETED_MESSAGE);
    // The two side effects that only belong to a real pairing.
    expect(byId("pair-code").value).toBe("BCDF-GHJK");
    expect(mocks.fetchDevices.mock.calls.length).toBe(reads);
  });

  it("closes the confirm screen either way, so a stale code cannot be re-confirmed", async () => {
    mocks.claimCode
      .mockResolvedValueOnce({ state: "confirm", code: "BCDFGHJK", device: {} })
      .mockResolvedValueOnce({ state: "confirm", code: "BCDFGHJK", device: {} });

    await mount();
    await openConfirm();
    byId("pair-confirm-yes").dispatchEvent(new Event("click"));
    await settle();

    expect(byId("pair-confirm").hidden).toBe(true);
    // A second click with nothing pending must not re-send the claim.
    const calls = mocks.claimCode.mock.calls.length;
    byId("pair-confirm-yes").dispatchEvent(new Event("click"));
    await settle();
    expect(mocks.claimCode.mock.calls.length).toBe(calls);
  });
});
