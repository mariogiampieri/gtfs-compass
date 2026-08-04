/**
 * Config UI entry point. The only module that touches the DOM or the browser
 * APIs; everything it decides lives in geo.js / auth.js / mode.js so it can be
 * tested without a browser.
 *
 * Two rules hold everywhere in here:
 *   - text goes in with `textContent`, never `innerHTML`. Later units render
 *     device metadata, which is attacker-controlled text.
 *   - visibility is the `hidden` attribute, never an inline `style` — `style-src
 *     'self'` has no `unsafe-inline` escape hatch (R19).
 */
import { requestMagicLink } from "./auth.js";
import { GEO_OPTIONS, formatFix, geolocationErrorMessage, insecureContextMessage } from "./geo.js";
import { bannerForMode, fetchAuthMode } from "./mode.js";

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

mountBanner();
mountSignIn();
mountCapture();
