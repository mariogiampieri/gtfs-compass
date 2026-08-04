/**
 * The DOM half of the confirm screen and the device list (U10; R8, R18, R19).
 *
 * Split out of `app.js` because this is the module that renders
 * attacker-controlled text — a device's self-reported `name` and `fw_version`
 * are whatever the board POSTed to `/v1/device/pair/start`, and nothing has
 * verified either. Having it in its own module is what lets a test plant markup
 * in those fields against a real DOM and assert that it did not become markup.
 *
 * Three rules, all of them structural rather than remembered:
 *
 *  1. **Nodes are built, never parsed.** `createElement` plus `textContent`,
 *     never `innerHTML` / `insertAdjacentHTML` / `outerHTML`. A string that
 *     never reaches an HTML parser cannot be markup, whatever it contains —
 *     which is why this holds for `<img src=x onerror=…>` and for the bidi and
 *     `</script>` payloads equally, without an escaping table anyone has to
 *     maintain.
 *
 *  2. **Handlers are listeners.** `addEventListener`, never an `on*` attribute
 *     — the build gate (`build.mjs`) rejects inline handlers in emitted HTML,
 *     and `script-src 'self'` has no `unsafe-inline` escape hatch. Two layers,
 *     and this module is the first one.
 *
 *  3. **Visibility is the `hidden` attribute**, never an inline `style`:
 *     `style-src 'self'` would silently kill it.
 *
 * The CSP is the second layer, not the only one. It stops an injected script
 * from *executing*; it does nothing about markup that rewrites the page it was
 * injected into, and it is not present at all if a future asset ships without
 * `_headers`. Escaping is the control.
 */

import {
  MAX_DISPLAY_FW,
  MAX_DISPLAY_NAME,
  SCOPES,
  UNENFORCED_NOTE,
  UNKNOWN_FW,
  UNNAMED_DEVICE,
  UNTRUSTED_NOTE,
  cap,
  formatAge,
} from "./devices.js";

/** @param {string} tag @param {string} [className] @param {string} [text] */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  // The single choke point for device-supplied text. textContent, always.
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * The device's self-reported name, capped for display and never empty.
 * @param {{name?: string|null}} device
 */
export function displayName(device) {
  const raw = typeof device?.name === "string" ? device.name.trim() : "";
  return raw === "" ? UNNAMED_DEVICE : cap(raw, MAX_DISPLAY_NAME);
}

/** @param {{fw_version?: string|null}} device */
export function displayFirmware(device) {
  const raw = typeof device?.fw_version === "string" ? device.fw_version.trim() : "";
  return raw === "" ? UNKNOWN_FW : cap(raw, MAX_DISPLAY_FW);
}

/** A `<dt>`/`<dd>` pair into an existing definition list. */
function addRow(dl, term, value) {
  dl.append(el("dt", undefined, term), el("dd", undefined, value));
}

/**
 * The device's own claims about itself, rendered as claims (R8). The
 * "as reported by the device" note is not filler: the whole point of the
 * confirm screen is that this text is the *attacker's* input in the phishing
 * case, and a name presented with the same authority as the rest of the page
 * is what makes "Mario's kitchen board" persuasive.
 *
 * @param {{name?: string|null, fw_version?: string|null}} device
 */
export function renderMetadata(container, device) {
  container.replaceChildren();
  const dl = el("dl", "fix");
  addRow(dl, "Name", displayName(device));
  addRow(dl, "Firmware", displayFirmware(device));
  container.append(dl, el("p", "muted", UNTRUSTED_NOTE));
  return container;
}

/**
 * One device in the list (R18): name, last-seen, firmware, the scope toggles,
 * and unpair.
 *
 * @param {object} entry the `/v1/config/devices` element
 * @param {{onToggle: Function, onUnpair: Function, now?: number}} handlers
 */
function renderDevice(entry, handlers) {
  const item = el("li", "device");
  const device = entry?.device ?? {};
  const scopes = new Set(Array.isArray(entry?.scopes) ? entry.scopes : []);

  item.append(el("h3", "device-name", displayName(device)));
  item.append(el("p", "muted", UNTRUSTED_NOTE));

  const dl = el("dl", "fix");
  addRow(dl, "Firmware", displayFirmware(device));
  addRow(dl, "Paired", formatAge(entry?.paired_at, handlers.now));
  addRow(dl, "Last seen", formatAge(entry?.last_seen, handlers.now));
  item.append(dl);

  for (const scope of SCOPES) {
    const row = el("div", "scope");
    const label = el("label", "scope-label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = scopes.has(scope.id);
    // A property on a node this module created, never a value interpolated
    // into markup or into a selector.
    input.dataset.scope = scope.id;
    input.addEventListener("change", () => {
      handlers.onToggle(entry, scope.id, input.checked, input);
    });
    label.append(input, el("span", undefined, ` ${scope.label}`));
    row.append(label, el("p", "muted", scope.summary));
    // A control that does nothing yet says so, on the row, every render — the
    // same discipline the API applies to stale data. `SCOPES` opts *in* to
    // "enforced", so forgetting the flag over-labels rather than over-claims.
    if (!scope.enforced) row.append(el("p", "scope-unenforced", UNENFORCED_NOTE));
    if (scope.warning) row.append(el("p", "scope-warning", scope.warning));
    item.append(row);
  }

  const unpair = el("button", "danger", "Unpair this device");
  unpair.type = "button";
  unpair.addEventListener("click", () => handlers.onUnpair(entry, unpair));
  item.append(unpair);

  return item;
}

/**
 * Replace the list's contents with these devices. Full re-render rather than a
 * patch: the list is at most a handful of rows, and re-rendering from the
 * server's answer is what keeps a toggle showing what the *server* holds rather
 * than what the click assumed.
 *
 * @param {HTMLElement} listEl
 * @param {object[]} devices
 * @param {{onToggle: Function, onUnpair: Function, now?: number}} handlers
 */
export function renderDevices(listEl, devices, handlers) {
  listEl.replaceChildren();
  for (const entry of devices ?? []) listEl.append(renderDevice(entry, handlers));
  return listEl;
}
