import { describe, expect, it, vi } from "vitest";

import { CSRF_HEADER } from "../src/auth.js";
import {
  MAX_TIMESTAMP_DRIFT_S,
  MIN_POST_INTERVAL_MS,
  RELAY_FAILED_MESSAGE,
  RELAY_KEPT_BETTER_MESSAGE,
  RELAY_NO_DEVICES_MESSAGE,
  RELAY_OFFLINE_MESSAGE,
  RELAY_PATH,
  RELAY_RATE_LIMITED_MESSAGE,
  RELAY_SIGNED_OUT_MESSAGE,
  capturedAtSeconds,
  fixBody,
  postFix,
  relayedMessage,
  shouldPost,
} from "../src/relay.js";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** A GeolocationPosition-shaped object, timestamped now unless told otherwise. */
function position(overrides = {}) {
  return {
    coords: { latitude: 40.705231, longitude: -74.013617, accuracy: 12, ...overrides.coords },
    timestamp: overrides.timestamp ?? Date.now(),
  };
}

describe("the request body (R11)", () => {
  it("names no device — only the position, and the relay flag", () => {
    const body = fixBody(position());
    // The absence is the design: the session identifies the user and the grant
    // list identifies the recipients, so there is nothing here to spoof.
    expect(Object.keys(body).sort()).toEqual(["accuracy", "captured_at", "lat", "lon", "relay"]);
    expect(body.relay).toBe(true);
    expect(body.device_id).toBeUndefined();
  });

  it("sends the raw accuracy, uncapped and unrounded (R12 gates at read time)", () => {
    expect(fixBody(position({ coords: { accuracy: 1875 } })).accuracy).toBe(1875);
    // A browser that reports no accuracy at all sends none rather than a zero.
    expect(fixBody(position({ coords: { accuracy: undefined } })).accuracy).toBeUndefined();
  });

  it("drops a capture time it cannot vouch for instead of sending a bad one", () => {
    const now = Date.UTC(2026, 7, 4, 12, 0, 0);
    // Milliseconds where seconds belong: 1_785_000_000_000 s is the year 58000.
    expect(capturedAtSeconds(now * 1000, now)).toBeNull();
    // A monotonic clock reading rather than a wall clock.
    expect(capturedAtSeconds(9_000, now)).toBeNull();
    expect(capturedAtSeconds(Number.NaN, now)).toBeNull();
    expect(capturedAtSeconds(now - 5_000, now)).toBe(Math.floor(now / 1000) - 5);
    // Right at the tolerance the server also applies.
    expect(capturedAtSeconds(now + MAX_TIMESTAMP_DRIFT_S * 1000, now)).not.toBeNull();
    expect(capturedAtSeconds(now + (MAX_TIMESTAMP_DRIFT_S + 1) * 1000, now)).toBeNull();

    const body = fixBody(position({ timestamp: 9_000 }));
    expect(body).not.toHaveProperty("captured_at");
    expect(body.lat).toBeCloseTo(40.705231, 6);
  });
});

describe("the cadence throttle (the client's half of R11's budget)", () => {
  it("allows the first post and refuses a second inside the minute", () => {
    const t0 = 1_800_000_000_000;
    expect(shouldPost(null, t0)).toBe(true);
    expect(shouldPost(undefined, t0)).toBe(true);
    expect(shouldPost(t0, t0 + 1_000)).toBe(false);
    expect(shouldPost(t0, t0 + MIN_POST_INTERVAL_MS - 1)).toBe(false);
    expect(shouldPost(t0, t0 + MIN_POST_INTERVAL_MS)).toBe(true);
  });

  it("a clock that jumped backwards does not lock the button out", () => {
    const t0 = 1_800_000_000_000;
    expect(shouldPost(t0, t0 - 3_600_000)).toBe(true);
  });
});

describe("postFix", () => {
  it("posts to /v1/locate/ref with the CSRF header and same-origin credentials", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ relayed: { devices: 2 } }));

    const result = await postFix(position(), fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [path, init] = fetchImpl.mock.calls[0];
    expect(path).toBe(RELAY_PATH);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(init.headers[CSRF_HEADER]).toBe("1");
    expect(JSON.parse(init.body).relay).toBe(true);
    expect(result).toMatchObject({ state: "sent", devices: 2 });
    expect(result.message).toContain("2 devices");
  });

  it("says what the boards did with the fix, not only that it was sent", async () => {
    // The server reports two numbers because they differ: a board holding a
    // strictly more accurate position from inside the horizon keeps it, which
    // is the case the refinement exists for and the case "each keeps this
    // position until a newer one arrives" is false about.
    const suppressed = vi.fn().mockResolvedValue(json({ relayed: { devices: 2, stored: 0 } }));
    const kept = await postFix(position(), suppressed);
    expect(kept).toMatchObject({ state: "sent", devices: 2, stored: 0 });
    expect(kept.message).toBe(RELAY_KEPT_BETTER_MESSAGE);
    expect(kept.message).not.toContain("until a newer one arrives");

    const partial = vi.fn().mockResolvedValue(json({ relayed: { devices: 3, stored: 1 } }));
    const some = await postFix(position(), partial);
    expect(some.message).toContain("1 took it");
    expect(some.message).toContain("more accurate position");

    // And the ordinary case is unchanged.
    expect(relayedMessage(2, 2)).toContain("until a newer one arrives");
    // A server that does not report the distinction is read as a plain
    // delivery, never as a suppression.
    expect(relayedMessage(2)).toBe(relayedMessage(2, 2));
  });

  it("says so when the fix went nowhere, rather than reporting a bare success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ relayed: { devices: 0 } }));
    const result = await postFix(position(), fetchImpl);
    expect(result.state).toBe("sent");
    expect(result.message).toBe(RELAY_NO_DEVICES_MESSAGE);
    expect(relayedMessage(0)).toBe(RELAY_NO_DEVICES_MESSAGE);
    expect(relayedMessage(1)).toContain("1 device.");
  });

  it("maps every server refusal to its own sentence", async () => {
    const cases = [
      [401, "signed-out", RELAY_SIGNED_OUT_MESSAGE],
      [429, "rate-limited", RELAY_RATE_LIMITED_MESSAGE],
      [403, "error", RELAY_FAILED_MESSAGE],
      [400, "error", RELAY_FAILED_MESSAGE],
      [500, "error", RELAY_FAILED_MESSAGE],
    ];
    for (const [status, state, message] of cases) {
      const fetchImpl = vi.fn().mockResolvedValue(json({ error: "no" }, status));
      expect(await postFix(position(), fetchImpl)).toEqual({ state, message });
    }
  });

  it("a transport failure is reported as one, and never as a send", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("offline"));
    expect(await postFix(position(), fetchImpl)).toEqual({
      state: "error",
      message: RELAY_OFFLINE_MESSAGE,
    });
  });

  it("a 200 with an unreadable body is still a send", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("not json", { status: 200 }));
    expect(await postFix(position(), fetchImpl)).toMatchObject({ state: "sent" });
  });
});
