import { describe, expect, it } from "vitest";

import {
  GEO_OPTIONS,
  LOCATE_MAX_ACCURACY_M,
  WALK_ROUTING_MAX_ACCURACY_M,
  accuracyVerdict,
  formatFix,
  geolocationErrorMessage,
  insecureContextMessage,
} from "../src/geo.js";

const secure = { protocol: "https:", host: "compass.example" };
const lan = { protocol: "http:", host: "192.168.1.20:8787" };

describe("capture preconditions (R17)", () => {
  it("never reuses a cached position", () => {
    expect(GEO_OPTIONS.maximumAge).toBe(0);
    expect(GEO_OPTIONS.enableHighAccuracy).toBe(true);
    expect(GEO_OPTIONS.timeout).toBeGreaterThan(0);
  });

  it("says nothing when the page can actually ask for a fix", () => {
    expect(insecureContextMessage(secure, true, true)).toBeNull();
  });

  it("explains the HTTPS requirement on a LAN IP instead of failing silently", () => {
    const message = insecureContextMessage(lan, false, true);
    expect(message).toMatch(/https/i);
    expect(message).toContain("192.168.1.20:8787");
    expect(message).toMatch(/without any prompt|insecure/i);
  });

  it("still explains itself when the API is missing on a secure origin", () => {
    const message = insecureContextMessage(secure, true, false);
    expect(message).toMatch(/Geolocation API/);
  });
});

describe("error copy", () => {
  it("gives PERMISSION_DENIED its own recovery instructions", () => {
    const denied = geolocationErrorMessage({ code: 1 });
    expect(denied).toMatch(/permission is blocked/i);
    expect(denied).toMatch(/iOS/);
    expect(denied).toMatch(/Android/);
    // and it must not read like any of the other two
    expect(denied).not.toBe(geolocationErrorMessage({ code: 2 }));
    expect(denied).not.toBe(geolocationErrorMessage({ code: 3 }));
  });

  it("distinguishes unavailable, timeout, and unknown", () => {
    expect(geolocationErrorMessage({ code: 2 })).toMatch(/could not work out where/i);
    expect(geolocationErrorMessage({ code: 3 })).toMatch(/No fix within \d+ seconds/);
    expect(geolocationErrorMessage(undefined)).toMatch(/did not say why/);
  });
});

describe("accuracy honesty", () => {
  it("surfaces the raw accuracy unrounded", () => {
    const fix = formatFix({
      coords: { latitude: 40.7128123, longitude: -74.0060456, accuracy: 13.427 },
      timestamp: Date.UTC(2026, 7, 4, 12, 0, 0),
    });
    expect(fix.accuracy).toBe("13.427 m");
    expect(fix.accuracyM).toBe(13.427);
    expect(fix.lat).toBe("40.712812");
    expect(fix.lon).toBe("-74.006046");
  });

  it("grades a fix against the routing and locate thresholds", () => {
    expect(accuracyVerdict(WALK_ROUTING_MAX_ACCURACY_M)).toMatch(/walk times/);
    expect(accuracyVerdict(WALK_ROUTING_MAX_ACCURACY_M + 1)).toMatch(/too coarse to route/);
    expect(accuracyVerdict(LOCATE_MAX_ACCURACY_M + 1)).toMatch(/unknown position/);
    expect(accuracyVerdict(Number.NaN)).toMatch(/unknown/);
  });
});
