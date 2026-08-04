import { describe, expect, it, vi } from "vitest";

import { CSRF_HEADER } from "../src/auth.js";
import {
  CLAIM_PATH,
  CLAIM_RATE_LIMITED_MESSAGE,
  CODE_INVALID_MESSAGE,
  CODE_UNKNOWN_MESSAGE,
  CONFIRM_WARNING,
  DEVICES_PATH,
  DEVICES_UNAVAILABLE_MESSAGE,
  OFFLINE_MESSAGE,
  SCOPES,
  SCOPE_CONFLICT_MESSAGE,
  SIGNED_OUT_MESSAGE,
  UNENFORCED_NOTE,
  UNPAIRED_MESSAGE,
  UNPAIR_FAILED_MESSAGE,
  cap,
  claimCode,
  fetchDevices,
  formatAge,
  formatCode,
  normalizeCode,
  setScope,
  unpairDevice,
} from "../src/devices.js";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/* -------------------------------------------------------------------------- */
/* The code the human types                                                    */
/* -------------------------------------------------------------------------- */

describe("pairing code normalization", () => {
  it("treats case and separators as presentation, like the server does", () => {
    for (const raw of ["BCDFGHJK", "bcdf-ghjk", "BCDF GHJK", " bcdf—ghjk "]) {
      expect(normalizeCode(raw)).toBe("BCDFGHJK");
    }
  });

  it("rejects a code with a character outside the alphabet instead of dropping it", () => {
    // Dropping the stray "O" would re-align this into the *valid* code
    // BCDFGHJK — a claim against a pairing request the user never looked at.
    expect(normalizeCode("BCDFOGHJK")).toBeNull();
    expect(normalizeCode("BCDF-GHJ")).toBeNull();
    expect(normalizeCode("")).toBeNull();
    expect(normalizeCode(undefined)).toBeNull();
  });

  it("groups a code for reading back off a small screen", () => {
    expect(formatCode("BCDFGHJK")).toBe("BCDF-GHJK");
  });
});

/* -------------------------------------------------------------------------- */
/* Claiming (R8)                                                               */
/* -------------------------------------------------------------------------- */

describe("claiming a pairing code", () => {
  it("posts the normalized code with the CSRF header and same-origin credentials", async () => {
    const fetchImpl = vi.fn(async () => json({ status: "confirm", device: {} }, 409));
    await claimCode("bcdf-ghjk", { fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(CLAIM_PATH);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(init.headers[CSRF_HEADER]).toBeTruthy();
    expect(JSON.parse(init.body)).toEqual({ user_code: "BCDFGHJK" });
  });

  it("does not send a code-shaped-nothing — a typo must not spend the daily attempt budget", async () => {
    const fetchImpl = vi.fn(async () => json({}, 200));
    const result = await claimCode("nope", { fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result).toEqual({ state: "error", message: CODE_INVALID_MESSAGE });
  });

  it("never sends confirm on the first call — the preview is the control, not a nicety", async () => {
    const fetchImpl = vi.fn(async () => json({ status: "confirm", device: {} }, 409));
    await claimCode("BCDFGHJK", { fetchImpl });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).confirm).toBeUndefined();
  });

  it("turns the server's 409 into a confirm screen carrying the device's claims", async () => {
    const device = { name: "Kitchen board", fw_version: "1.4.0", untrusted: true };
    const result = await claimCode("BCDF-GHJK", {
      fetchImpl: async () => json({ status: "confirm", user_code: "BCDF-GHJK", device }, 409),
    });
    expect(result.state).toBe("confirm");
    expect(result.code).toBe("BCDFGHJK");
    expect(result.device).toEqual(device);
  });

  it("binds only when the user confirms", async () => {
    const fetchImpl = vi.fn(async () => json({ ok: true, device: { name: "Kitchen board" } }));
    const result = await claimCode("BCDFGHJK", { confirm: true, fetchImpl });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      user_code: "BCDFGHJK",
      confirm: true,
    });
    expect(result.state).toBe("paired");
  });

  it("maps every refusal to a message that does not invent a distinction", async () => {
    const cases = [
      [404, CODE_UNKNOWN_MESSAGE],
      [400, CODE_INVALID_MESSAGE],
      [429, CLAIM_RATE_LIMITED_MESSAGE],
      [401, SIGNED_OUT_MESSAGE],
      [403, SIGNED_OUT_MESSAGE],
      [500, OFFLINE_MESSAGE],
    ];
    for (const [status, message] of cases) {
      const result = await claimCode("BCDFGHJK", {
        fetchImpl: async () => json({ error: "x" }, status),
      });
      expect(result).toEqual({ state: "error", message });
    }
  });

  it("survives a transport failure", async () => {
    const result = await claimCode("BCDFGHJK", {
      fetchImpl: async () => {
        throw new TypeError("network");
      },
    });
    expect(result).toEqual({ state: "error", message: OFFLINE_MESSAGE });
  });

  it("names the phishing attack the confirm screen exists to stop (R8)", () => {
    // RFC 8628 §5.4: the attack is a code arriving by phone call or message.
    // A generic "are you sure?" is not this control.
    expect(CONFIRM_WARNING).toMatch(/holding/i);
    expect(CONFIRM_WARNING).toMatch(/phone|sent it to you/i);
  });
});

/* -------------------------------------------------------------------------- */
/* The device list and its toggles (R9, R18)                                   */
/* -------------------------------------------------------------------------- */

describe("the device list", () => {
  it("reads the list with the session cookie and no CSRF header (it is a GET)", async () => {
    const fetchImpl = vi.fn(async () => json({ devices: [{ id: "dev_1" }] }));
    const result = await fetchDevices(fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(DEVICES_PATH);
    expect(init.credentials).toBe("same-origin");
    expect(result.state).toBe("ok");
    expect(result.devices).toHaveLength(1);
  });

  it("treats 401 as signed-out rather than as a fault", async () => {
    const result = await fetchDevices(async () => json({ error: "unauthorized" }, 401));
    expect(result).toEqual({ state: "signed-out", message: SIGNED_OUT_MESSAGE });
  });

  it("tolerates a body that is not the shape it expected", async () => {
    expect((await fetchDevices(async () => json({}))).devices).toEqual([]);
    expect((await fetchDevices(async () => new Response("not json"))).devices).toEqual([]);
  });
});

describe("scope toggles", () => {
  it("PATCHes one scope at a time, so a stale tab cannot restore a revoked grant", async () => {
    const fetchImpl = vi.fn(async () => json({ id: "dev_1", scopes: ["read:fix"] }));
    await setScope("dev_1", "read:fix", true, fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${DEVICES_PATH}/dev_1`);
    expect(init.method).toBe("PATCH");
    expect(init.headers[CSRF_HEADER]).toBeTruthy();
    expect(JSON.parse(init.body)).toEqual({ scope: "read:fix", granted: true });
  });

  it("escapes a device id into the path rather than concatenating it", async () => {
    const fetchImpl = vi.fn(async () => json({}));
    await setScope("dev/../other", "read:fix", false, fetchImpl);
    expect(fetchImpl.mock.calls[0][0]).toBe(`${DEVICES_PATH}/dev%2F..%2Fother`);
  });

  it("reports a concurrent change instead of pretending the toggle stuck", async () => {
    const result = await setScope("dev_1", "read:fix", false, async () => json({}, 409));
    expect(result).toEqual({ state: "conflict", message: SCOPE_CONFLICT_MESSAGE });
  });

  it("says in plain language what granting read:fix means (R9/R11)", () => {
    const fix = SCOPES.find((s) => s.id === "read:fix");
    expect(fix.warning).toMatch(/live position/i);
    expect(fix.warning).toMatch(/deletes the position already sent/i);
    // The other two are not dressed up as privacy decisions; only this one is.
    for (const scope of SCOPES.filter((s) => s.id !== "read:fix")) {
      expect(scope.warning).toBeUndefined();
    }
  });

  it("lists read:fix as off-by-default in its own copy", () => {
    expect(SCOPES.find((s) => s.id === "read:fix").summary).toMatch(/off unless you turn it on/i);
  });

  it("does not claim a permission is enforced when nothing checks it (F5)", () => {
    // `/v1/departures` and `/v1/nearby` name no scope — they are anonymous by
    // design (R10) — and the board's own config read is U15. So unchecking
    // either of these two changes nothing the user can observe, and a toggle
    // that stays silent about that is the failure this list exists to prevent.
    // Enforcement arrives with U13 and U15; the label goes then, not before.
    for (const id of ["read:departures", "read:config"]) {
      expect(SCOPES.find((s) => s.id === id).enforced).not.toBe(true);
    }
    // read:fix is genuinely off by default, genuinely stored, and revoking it
    // genuinely deletes the delivered position. It is not labelled.
    expect(SCOPES.find((s) => s.id === "read:fix").enforced).toBe(true);
  });

  it("says what is true today and what changes when the check ships (F5)", () => {
    expect(UNENFORCED_NOTE).toMatch(/not enforced yet/i);
    // Today: recorded, and switching it off does not stop the board.
    expect(UNENFORCED_NOTE).toMatch(/recorded|stored/i);
    expect(UNENFORCED_NOTE).toMatch(/does not stop it/i);
    // Later: the grant starts being applied, and a board without it is refused.
    expect(UNENFORCED_NOTE).toMatch(/refused/i);
  });
});

describe("unpairing", () => {
  it("DELETEs the device with the CSRF header", async () => {
    const fetchImpl = vi.fn(async () => json({ ok: true, id: "dev_1" }));
    const result = await unpairDevice("dev_1", fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${DEVICES_PATH}/dev_1`);
    expect(init.method).toBe("DELETE");
    expect(init.headers[CSRF_HEADER]).toBeTruthy();
    expect(result).toEqual({ state: "ok", message: UNPAIRED_MESSAGE });
  });

  it("tells the user that revocation already happened, not that it will", () => {
    expect(UNPAIRED_MESSAGE).toMatch(/immediately/i);
    expect(UNPAIRED_MESSAGE).toMatch(/deleted/i);
  });

  it("says a revocation failed, not that a list failed to load (F9)", async () => {
    // The read's copy would leave the user believing the credential may already
    // be gone while the board keeps working — on the screen reached after a
    // theft. Same split as setScope's SCOPE_FAILED / DEVICES_UNAVAILABLE.
    const result = await unpairDevice("dev_1", async () => json({ error: "x" }, 500));
    expect(result).toEqual({ state: "error", message: UNPAIR_FAILED_MESSAGE });
    expect(UNPAIR_FAILED_MESSAGE).not.toBe(DEVICES_UNAVAILABLE_MESSAGE);
    expect(UNPAIR_FAILED_MESSAGE).toMatch(/still paired|still works/i);
  });
});

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

describe("formatAge", () => {
  const now = 1_800_000_000_000;
  const at = (secondsAgo) => formatAge(Math.floor(now / 1000) - secondsAgo, now);

  it("says never for a device that has not called home", () => {
    expect(formatAge(null, now)).toBe("never");
    expect(formatAge(undefined, now)).toBe("never");
  });

  it("reads in units a human uses", () => {
    expect(at(5)).toBe("just now");
    expect(at(600)).toBe("10 minutes ago");
    expect(at(3600)).toBe("1 hour ago");
    expect(at(7200)).toBe("2 hours ago");
    expect(at(86_400)).toBe("1 day ago");
    expect(at(3 * 86_400)).toBe("3 days ago");
  });

  it("does not report the future when a clock is skewed", () => {
    expect(formatAge(Math.floor(now / 1000) + 5000, now)).toBe("just now");
  });
});

describe("cap", () => {
  it("truncates with a visible ellipsis rather than a silent cut", () => {
    expect(cap("abcdef", 10)).toBe("abcdef");
    expect(cap("abcdef", 4)).toBe("abc…");
    expect(cap(null, 4)).toBe("");
  });
});
