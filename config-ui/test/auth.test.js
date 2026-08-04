import { describe, expect, it, vi } from "vitest";

import {
  CSRF_HEADER,
  SIGN_IN_INVALID_MESSAGE,
  SIGN_IN_RATE_LIMITED_MESSAGE,
  SIGN_IN_SENT_MESSAGE,
  SIGN_IN_UNAVAILABLE_MESSAGE,
  requestMagicLink,
} from "../src/auth.js";
import { AUTH_MODE_PATH, SINGLE_USER_BANNER, bannerForMode, fetchAuthMode } from "../src/mode.js";

const ok = () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } });

describe("sign-in request", () => {
  it("posts JSON to /v1/auth/request with the CSRF header and same-origin credentials", async () => {
    const fetchImpl = vi.fn(ok);
    await requestMagicLink("Rider@Example.com ", fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/v1/auth/request");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(init.headers[CSRF_HEADER]).toBeTruthy();
    expect(JSON.parse(init.body)).toEqual({ email: "Rider@Example.com" });
  });

  it("says the same thing whatever the server thinks of the address", async () => {
    const known = await requestMagicLink("known@example.com", vi.fn(ok));
    const unknown = await requestMagicLink("nobody@example.com", vi.fn(ok));
    expect(known.message).toBe(SIGN_IN_SENT_MESSAGE);
    expect(unknown.message).toBe(known.message);
    expect(unknown.ok).toBe(true);
  });

  it("reports transport failures without leaking whether the address exists", async () => {
    const server = await requestMagicLink(
      "a@example.com",
      vi.fn(async () => new Response("", { status: 500 })),
    );
    const network = await requestMagicLink(
      "a@example.com",
      vi.fn(async () => {
        throw new TypeError("network");
      }),
    );
    expect(server.message).toBe(SIGN_IN_UNAVAILABLE_MESSAGE);
    expect(network.message).toBe(server.message);
    expect(server.ok).toBe(false);
  });

  it("surfaces rate limiting distinctly — it is about the client, not the address", async () => {
    const limited = await requestMagicLink(
      "a@example.com",
      vi.fn(async () => new Response("", { status: 429 })),
    );
    expect(limited.message).toBe(SIGN_IN_RATE_LIMITED_MESSAGE);
  });

  it("does not send an obviously unaddressable value", async () => {
    const fetchImpl = vi.fn(ok);
    for (const bad of ["", "   ", "nope", "@example.com", "a b@example.com"]) {
      const result = await requestMagicLink(bad, fetchImpl);
      expect(result.message).toBe(SIGN_IN_INVALID_MESSAGE);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("single-user banner (R5)", () => {
  it("renders only for the single mode", () => {
    expect(bannerForMode("single")).toBe(SINGLE_USER_BANNER);
    expect(bannerForMode("multi")).toBeNull();
    expect(bannerForMode(undefined)).toBeNull();
    expect(SINGLE_USER_BANNER).toMatch(/network-level control/);
  });

  it("fails closed to multi-user when the flag endpoint is absent or unreadable", async () => {
    const missing = await fetchAuthMode(vi.fn(async () => new Response("", { status: 404 })));
    const garbage = await fetchAuthMode(
      vi.fn(async () => Response.json({ auth_mode: "SINGLE-ish" })),
    );
    const broken = await fetchAuthMode(
      vi.fn(async () => {
        throw new TypeError("offline");
      }),
    );
    expect([missing, garbage, broken]).toEqual(["multi", "multi", "multi"]);
  });

  it("reads the exact flag string from the documented endpoint", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ auth_mode: "single" }));
    expect(await fetchAuthMode(fetchImpl)).toBe("single");
    expect(fetchImpl.mock.calls[0][0]).toBe(AUTH_MODE_PATH);
  });
});
