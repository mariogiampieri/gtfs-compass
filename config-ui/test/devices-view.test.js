// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

import {
  MAX_DISPLAY_FW,
  MAX_DISPLAY_NAME,
  SCOPES,
  UNENFORCED_NOTE,
  UNKNOWN_FW,
  UNNAMED_DEVICE,
  UNTRUSTED_NOTE,
} from "../src/devices.js";
import { displayName, renderDevices, renderMetadata } from "../src/devices-view.js";

/**
 * Rendering device-supplied metadata (U10; R8, R18, R19).
 *
 * A real DOM, on purpose. The claim under test is "this text does not become
 * markup", and only a real parser can falsify it — a string-comparison test
 * against a hand-rolled escaper would pass against the escaper's own bugs.
 *
 * The payloads are the ones that actually get used: an `onerror` handler (the
 * classic that survives most naive escapers because it needs no `<script>`) and
 * a `</script>` breakout. Bidi overrides are deliberately *not* tested here —
 * they are not an escaping problem, they are a legibility one, and the control
 * for them is `sanitizeMetadata` in `api/src/routes/pair.ts`, which strips
 * format characters before the string is ever stored.
 */

const HOSTILE_NAME = '<img src=x onerror="alert(1)">';
const HOSTILE_FW = '</script><script>alert(2)</script>';

const handlers = { onToggle: vi.fn(), onUnpair: vi.fn(), now: 1_800_000_000_000 };

function entry(overrides = {}) {
  return {
    id: "dev_1",
    paired_at: Math.floor(handlers.now / 1000) - 600,
    last_seen: Math.floor(handlers.now / 1000) - 120,
    scopes: ["read:departures", "read:config"],
    device: { name: "Kitchen board", fw_version: "1.4.0", untrusted: true },
    ...overrides,
  };
}

/** Every attribute on every node in the subtree. */
function allAttributes(root) {
  const names = [];
  for (const node of root.querySelectorAll("*")) {
    for (const attr of node.attributes) names.push(attr.name.toLowerCase());
  }
  return names;
}

describe("device-supplied text is text (R8)", () => {
  it("does not let a name become an element", () => {
    const list = document.createElement("ul");
    renderDevices(list, [entry({ device: { name: HOSTILE_NAME, fw_version: HOSTILE_FW } })], handlers);

    // The payload is present, and present as *text*.
    expect(list.querySelector(".device-name").textContent).toBe(HOSTILE_NAME);
    // ...and nothing it asked for exists.
    expect(list.querySelectorAll("img")).toHaveLength(0);
    expect(list.querySelectorAll("script")).toHaveLength(0);
    expect(allAttributes(list).filter((name) => name.startsWith("on"))).toEqual([]);
    // The serialized form proves the escape rather than the absence of a tag:
    // an entity here is the parser's own escaping, not a table this repo keeps.
    expect(list.innerHTML).toContain("&lt;img");
    expect(list.innerHTML).not.toContain("<img");
  });

  it("does not let a firmware string break out of the document either", () => {
    const list = document.createElement("ul");
    renderDevices(list, [entry({ device: { name: "ok", fw_version: HOSTILE_FW } })], handlers);
    // Capped at MAX_DISPLAY_FW *and* still text: the two controls are
    // independent, and the payload is longer than the cap on purpose so the
    // truncation cannot be what is doing the escaping.
    expect(list.textContent).toContain(HOSTILE_FW.slice(0, MAX_DISPLAY_FW - 1));
    expect(list.textContent).not.toContain(HOSTILE_FW);
    expect(list.querySelectorAll("script")).toHaveLength(0);
    expect(list.innerHTML).toContain("&lt;/script&gt;");
  });

  it("holds for the confirm screen, which renders the same metadata (R8)", () => {
    const box = document.createElement("div");
    renderMetadata(box, { name: HOSTILE_NAME, fw_version: HOSTILE_FW, untrusted: true });
    expect(box.textContent).toContain(HOSTILE_NAME);
    expect(box.querySelectorAll("img, script")).toHaveLength(0);
    expect(allAttributes(box).filter((name) => name.startsWith("on"))).toEqual([]);
  });

  it("marks the metadata as the device's claim, in both places", () => {
    const list = document.createElement("ul");
    const box = document.createElement("div");
    renderDevices(list, [entry()], handlers);
    renderMetadata(box, { name: "Kitchen board", fw_version: "1.4.0" });
    expect(list.textContent).toContain(UNTRUSTED_NOTE);
    expect(box.textContent).toContain(UNTRUSTED_NOTE);
  });

  it("caps the displayed name however long the device's is", () => {
    const long = "A".repeat(500);
    expect(displayName({ name: long })).toHaveLength(MAX_DISPLAY_NAME);
    const list = document.createElement("ul");
    renderDevices(list, [entry({ device: { name: long } })], handlers);
    expect(list.querySelector(".device-name").textContent).toHaveLength(MAX_DISPLAY_NAME);
  });

  it("names a device that reported nothing rather than rendering a blank row", () => {
    const list = document.createElement("ul");
    renderDevices(list, [entry({ device: { name: null, fw_version: null } })], handlers);
    expect(list.querySelector(".device-name").textContent).toBe(UNNAMED_DEVICE);
    expect(list.textContent).toContain(UNKNOWN_FW);
  });

  it("uses no inline style attribute anywhere — style-src 'self' would kill it", () => {
    const list = document.createElement("ul");
    renderDevices(list, [entry()], handlers);
    expect(allAttributes(list)).not.toContain("style");
  });
});

describe("the device list itself (R18)", () => {
  it("shows name, firmware, when it was paired and when it was last seen", () => {
    const list = document.createElement("ul");
    renderDevices(list, [entry()], handlers);
    const text = list.textContent;
    expect(text).toContain("Kitchen board");
    expect(text).toContain("1.4.0");
    expect(text).toContain("10 minutes ago"); // paired
    expect(text).toContain("2 minutes ago"); // last seen
  });

  it("renders a checkbox per scope, checked from the server's answer", () => {
    const list = document.createElement("ul");
    renderDevices(list, [entry()], handlers);
    const boxes = [...list.querySelectorAll("input[type=checkbox]")];
    expect(boxes.map((b) => b.dataset.scope)).toEqual(SCOPES.map((s) => s.id));
    expect(boxes.map((b) => b.checked)).toEqual([true, true, false]);
  });

  it("shows read:fix unchecked for a freshly paired device, with its warning visible", () => {
    const list = document.createElement("ul");
    renderDevices(list, [entry()], handlers);
    const fix = list.querySelector('input[data-scope="read:fix"]');
    expect(fix.checked).toBe(false);
    expect(list.querySelector(".scope-warning").textContent).toMatch(/live position/i);
  });

  it("marks the toggles that gate nothing yet, on the row itself (F5)", () => {
    const list = document.createElement("ul");
    renderDevices(list, [entry()], handlers);

    // Row-level, not a footnote: the claim being corrected is made by the
    // checkbox, so the correction has to sit with the checkbox.
    for (const id of ["read:departures", "read:config"]) {
      const row = list.querySelector(`input[data-scope="${id}"]`).closest(".scope");
      expect(row.textContent).toContain(UNENFORCED_NOTE);
    }
    const fixRow = list.querySelector('input[data-scope="read:fix"]').closest(".scope");
    expect(fixRow.textContent).not.toContain(UNENFORCED_NOTE);
    expect(list.querySelectorAll(".scope-unenforced")).toHaveLength(2);
  });

  it("reports a toggle with the device, the scope and the new state", () => {
    const onToggle = vi.fn();
    const list = document.createElement("ul");
    const row = entry();
    renderDevices(list, [row], { ...handlers, onToggle });

    const fix = list.querySelector('input[data-scope="read:fix"]');
    fix.checked = true;
    fix.dispatchEvent(new Event("change"));

    expect(onToggle).toHaveBeenCalledTimes(1);
    const [device, scope, granted] = onToggle.mock.calls[0];
    expect(device.id).toBe("dev_1");
    expect(scope).toBe("read:fix");
    expect(granted).toBe(true);
  });

  it("reports an unpair for the device the button belongs to", () => {
    const onUnpair = vi.fn();
    const list = document.createElement("ul");
    renderDevices(list, [entry({ id: "dev_a" }), entry({ id: "dev_b" })], {
      ...handlers,
      onUnpair,
    });
    list.querySelectorAll("button.danger")[1].dispatchEvent(new Event("click"));
    expect(onUnpair.mock.calls[0][0].id).toBe("dev_b");
  });

  it("replaces the list rather than appending to it, so a re-render cannot double rows", () => {
    const list = document.createElement("ul");
    renderDevices(list, [entry()], handlers);
    renderDevices(list, [entry()], handlers);
    expect(list.querySelectorAll("li.device")).toHaveLength(1);
  });

  it("empties the list when the account has no devices", () => {
    const list = document.createElement("ul");
    renderDevices(list, [entry()], handlers);
    renderDevices(list, [], handlers);
    expect(list.children).toHaveLength(0);
  });
});
