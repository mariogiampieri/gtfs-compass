/**
 * Config UI entry point. The only module that touches the DOM or the browser
 * APIs directly; everything it decides lives in geo.js / auth.js / mode.js /
 * devices.js so it can be tested without a browser, and the one piece of
 * rendering that handles attacker-controlled text lives in devices-view.js so
 * it can be tested against a real DOM.
 *
 * Two rules hold everywhere in here:
 *   - text goes in with `textContent`, never `innerHTML`. Later units render
 *     device metadata, which is attacker-controlled text.
 *   - visibility is the `hidden` attribute, never an inline `style` — `style-src
 *     'self'` has no `unsafe-inline` escape hatch (R19).
 */
import { requestMagicLink } from "./auth.js";
import {
  CONFIRM_WARNING,
  PAIRED_MESSAGE,
  claimCode,
  fetchDevices,
  setScope,
  unpairDevice,
} from "./devices.js";
import { displayName, renderDevices, renderMetadata } from "./devices-view.js";
import { GEO_OPTIONS, formatFix, geolocationErrorMessage, insecureContextMessage } from "./geo.js";
import { bannerForMode, fetchAuthMode } from "./mode.js";

/** Where the device sends the human (`PAIR_VERIFICATION_PATH` in pair.ts). */
const PAIR_PATH = "/pair";

/** @param {HTMLElement} el @param {string} text */
function show(el, text) {
  el.textContent = text;
  el.hidden = false;
}

function hide(el) {
  el.hidden = true;
}

function mountBanner() {
  const banner = document.getElementById("single-user-banner");
  if (!banner) return;
  void fetchAuthMode().then((mode) => {
    const text = bannerForMode(mode);
    if (text) show(banner, text);
  });
}

function mountSignIn() {
  const form = /** @type {HTMLFormElement|null} */ (document.getElementById("sign-in-form"));
  const input = /** @type {HTMLInputElement|null} */ (document.getElementById("email"));
  const submit = /** @type {HTMLButtonElement|null} */ (document.getElementById("sign-in-submit"));
  const status = document.getElementById("sign-in-status");
  if (!form || !input || !submit || !status) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    show(status, "Sending…");
    try {
      const result = await requestMagicLink(input.value);
      show(status, result.message);
      if (result.ok) form.reset();
    } finally {
      submit.disabled = false;
    }
  });
}

function mountCapture() {
  const button = /** @type {HTMLButtonElement|null} */ (document.getElementById("capture-button"));
  const status = document.getElementById("capture-status");
  const result = document.getElementById("capture-result");
  if (!button || !status || !result) return;

  const fields = {
    lat: document.getElementById("fix-lat"),
    lon: document.getElementById("fix-lon"),
    accuracy: document.getElementById("fix-accuracy"),
    captured: document.getElementById("fix-captured"),
    verdict: document.getElementById("fix-verdict"),
  };

  // Bound to a click, never called on load: browsers only prompt for location
  // from a user gesture, and a prompt nobody asked for gets dismissed.
  button.addEventListener("click", () => {
    hide(result);
    const blocked = insecureContextMessage(
      window.location,
      window.isSecureContext,
      Boolean(navigator.geolocation),
    );
    if (blocked) {
      show(status, blocked);
      return;
    }
    button.disabled = true;
    show(status, "Asking your phone where it is…");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        button.disabled = false;
        const fix = formatFix(position);
        if (fields.lat) fields.lat.textContent = fix.lat;
        if (fields.lon) fields.lon.textContent = fix.lon;
        if (fields.accuracy) fields.accuracy.textContent = fix.accuracy;
        if (fields.captured) fields.captured.textContent = fix.capturedAt;
        if (fields.verdict) fields.verdict.textContent = fix.verdict;
        show(status, "Got a fix. Nothing was sent anywhere.");
        result.hidden = false;
      },
      (error) => {
        button.disabled = false;
        show(status, geolocationErrorMessage(error));
      },
      GEO_OPTIONS,
    );
  });
}

/* -------------------------------------------------------------------------- */
/* Pairing entry and the device list (U10)                                     */
/* -------------------------------------------------------------------------- */

/**
 * Reload the list from the server and re-render.
 *
 * Every mutation ends here rather than patching the row it just changed: the
 * server is the authority on what a board actually holds, and a checkbox that
 * keeps the state the *click* implied is exactly how a failed revocation ends
 * up looking successful.
 */
async function refreshDevices() {
  const list = document.getElementById("devices-list");
  const empty = document.getElementById("devices-empty");
  const status = document.getElementById("devices-status");
  if (!list || !empty || !status) return false;

  const result = await fetchDevices();
  if (result.state !== "ok") {
    list.replaceChildren();
    empty.hidden = true;
    show(status, result.message);
    return false;
  }
  empty.hidden = result.devices.length > 0;
  hide(status);
  renderDevices(list, result.devices, {
    onToggle: async (entry, scope, granted, input) => {
      input.disabled = true;
      const outcome = await setScope(entry.id, scope, granted);
      input.disabled = false;
      // Re-read whatever the outcome, and *then* report: a conflict, a refusal
      // and a success all want the list to show the server's answer rather
      // than the click's, and reporting first would let the re-read's own
      // status write wipe the message the user needs to see.
      const reloaded = await refreshDevices();
      if (outcome.state !== "ok") show(status, outcome.message);
      else if (reloaded) hide(status);
    },
    onUnpair: async (entry, button) => {
      const name = displayName(entry.device ?? {});
      if (!window.confirm(`Unpair "${name}"? Its credential stops working immediately.`)) return;
      button.disabled = true;
      const outcome = await unpairDevice(entry.id);
      await refreshDevices();
      show(status, outcome.message);
    },
  });
  return true;
}

function mountPairing() {
  const form = /** @type {HTMLFormElement|null} */ (document.getElementById("pair-form"));
  const input = /** @type {HTMLInputElement|null} */ (document.getElementById("pair-code"));
  const submit = /** @type {HTMLButtonElement|null} */ (document.getElementById("pair-submit"));
  const status = document.getElementById("pair-status");
  const confirmBox = document.getElementById("pair-confirm");
  const confirmWarning = document.getElementById("pair-confirm-warning");
  const confirmDevice = document.getElementById("pair-confirm-device");
  const confirmYes = /** @type {HTMLButtonElement|null} */ (
    document.getElementById("pair-confirm-yes")
  );
  const confirmNo = document.getElementById("pair-confirm-no");
  if (!form || !input || !submit || !status || !confirmBox) return;
  if (!confirmWarning || !confirmDevice || !confirmYes || !confirmNo) return;

  /** The code the confirm screen is currently about; null when it is hidden. */
  let pending = null;

  const closeConfirm = () => {
    pending = null;
    confirmBox.hidden = true;
    confirmDevice.replaceChildren();
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    closeConfirm();
    submit.disabled = true;
    show(status, "Looking up that code…");
    const result = await claimCode(input.value);
    submit.disabled = false;
    if (result.state === "confirm") {
      pending = result.code;
      hide(status);
      // The anti-phishing copy is written here, as text, every time the screen
      // opens — never left sitting in the markup where a stale build could
      // ship the box without it.
      confirmWarning.textContent = CONFIRM_WARNING;
      renderMetadata(confirmDevice, result.device);
      confirmBox.hidden = false;
      confirmYes.focus();
      return;
    }
    show(status, result.message ?? "");
  });

  confirmNo.addEventListener("click", () => {
    closeConfirm();
    show(status, "Cancelled. Nothing was paired.");
  });

  confirmYes.addEventListener("click", async () => {
    if (!pending) return;
    confirmYes.disabled = true;
    const result = await claimCode(pending, { confirm: true });
    confirmYes.disabled = false;
    closeConfirm();
    show(status, result.message ?? PAIRED_MESSAGE);
    if (result.state === "paired") {
      form.reset();
      await refreshDevices();
    }
  });

  // The device sends the human to /pair; the SPA fallback answers it with this
  // same shell, so "arriving at /pair" means "put the cursor in the code box".
  if (window.location.pathname === PAIR_PATH) input.focus();
}

function mountDevices() {
  if (!document.getElementById("devices-list")) return;
  void refreshDevices();
}

mountBanner();
mountSignIn();
mountPairing();
mountDevices();
mountCapture();
