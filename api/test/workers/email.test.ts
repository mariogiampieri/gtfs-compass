import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { hashToken } from "../../src/auth";
import {
  BUDGET_SHARDS,
  EmailConfigError,
  EmailSendError,
  REFUSED_SCOPE_SUFFIX,
  SEND_ADDRESS_SCOPE,
  SEND_FAILURE_SCOPE,
  SEND_GLOBAL_KNOWN_SCOPE,
  SEND_GLOBAL_UNKNOWN_SCOPE,
  budgetDay,
  buildMime,
  chargeSendBudget,
  deliver,
  incrementBudget,
  isAllowedRecipient,
  magicLinkMessage,
  normalizeEmail,
  parseAllowlist,
  readBudget,
  readSendFailures,
  scrubSecrets,
  selectSender,
  type EmailDeps,
  type EmailSender,
  type OutboundEmail,
} from "../../src/email";
import { resetSchema } from "./schema";

const KNOWN = "Mario@Example.com";
const UNKNOWN = "stranger@example.net";
/** Stands in for a live magic-link token: high-entropy, base64url, 22+ chars. */
const TOKEN = "Zm9vYmFyYmF6cXV4MTIzNA";
const LINK = `https://api.example/auth/callback#${TOKEN}`;

function e(overrides: Record<string, unknown>): Env {
  return { ...env, ...overrides } as unknown as Env;
}

const resendEnv = (extra: Record<string, unknown> = {}) =>
  e({
    AUTH_EMAIL_PROVIDER: "resend",
    RESEND_API_KEY: "re_test_key",
    AUTH_EMAIL_FROM: "signin@gtfs-compass.example",
    ...extra,
  });

const consoleEnv = (extra: Record<string, unknown> = {}) =>
  e({
    AUTH_EMAIL_PROVIDER: "console",
    AUTH_ALLOWED_EMAILS: "mario@example.com",
    ...extra,
  });

/** A `send_email` binding stand-in: records the raw message it was handed. */
function fakeRouting() {
  const sent: { from: string; to: string; raw: string }[] = [];
  return {
    sent,
    binding: { send: async () => {} },
    // The provider builds the message through this dep, so the test observes
    // exactly what `cloudflare:email` would have received.
    deps: {
      routingMessage: async (from: string, to: string, raw: string) => {
        sent.push({ from, to, raw });
        return { from, to, raw };
      },
    } satisfies EmailDeps,
  };
}

/** Captures everything the module writes to a log sink, plus the real console. */
function logSink() {
  const lines: string[] = [];
  const deps: EmailDeps = {
    log: (line) => lines.push(line),
    warn: (line) => lines.push(line),
  };
  return { lines, deps, joined: () => lines.join("\n") };
}

function okResponse(): Response {
  return new Response(JSON.stringify({ id: "msg_1" }), { status: 200 });
}

beforeEach(async () => {
  await resetSchema();
});

/* -------------------------------------------------------------------------- */

describe("provider selection", () => {
  it("selects each provider by env", () => {
    expect(selectSender(resendEnv()).provider).toBe("resend");
    expect(selectSender(consoleEnv()).provider).toBe("console");
    const { binding } = fakeRouting();
    expect(
      selectSender(
        e({
          AUTH_EMAIL_PROVIDER: "cloudflare-routing",
          EMAIL_ROUTING: binding,
          AUTH_EMAIL_FROM: "signin@gtfs-compass.example",
        }),
      ).provider,
    ).toBe("cloudflare-routing");
  });

  it("fails closed: unset or unrecognized is an error, never a downgrade to console", () => {
    for (const raw of [undefined, "", "Console", " console", "resend ", "mailchannels", "true"]) {
      const candidate = e(raw === undefined ? {} : { AUTH_EMAIL_PROVIDER: raw });
      expect(() => selectSender(candidate)).toThrow(EmailConfigError);
    }
  });

  it("resend with no key is a hard failure — synchronous, before any token is minted", () => {
    // Synchronous: `selectSender` does no I/O, which is what lets the caller run
    // it inline ahead of the magic_tokens INSERT. A rejected promise here would
    // invite the caller to mint first and discover the misconfiguration later.
    expect(() => selectSender(e({ AUTH_EMAIL_PROVIDER: "resend", AUTH_EMAIL_FROM: "a@b.example" })))
      .toThrow(/RESEND_API_KEY/);
    expect(() =>
      selectSender(
        e({ AUTH_EMAIL_PROVIDER: "resend", RESEND_API_KEY: "   ", AUTH_EMAIL_FROM: "a@b.example" }),
      ),
    ).toThrow(EmailConfigError);
  });

  it("resend and cloudflare-routing require a From address", () => {
    expect(() =>
      selectSender(e({ AUTH_EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_x" })),
    ).toThrow(/AUTH_EMAIL_FROM/);
    expect(() =>
      selectSender(
        e({ AUTH_EMAIL_PROVIDER: "cloudflare-routing", EMAIL_ROUTING: fakeRouting().binding }),
      ),
    ).toThrow(/AUTH_EMAIL_FROM/);
  });

  it("cloudflare-routing without the send_email binding is a hard failure", () => {
    expect(() =>
      selectSender(
        e({ AUTH_EMAIL_PROVIDER: "cloudflare-routing", AUTH_EMAIL_FROM: "a@b.example" }),
      ),
    ).toThrow(/EMAIL_ROUTING/);
  });

  it("console without an allowlist refuses", () => {
    for (const raw of [undefined, "", "   ", ","]) {
      const candidate = e({
        AUTH_EMAIL_PROVIDER: "console",
        ...(raw === undefined ? {} : { AUTH_ALLOWED_EMAILS: raw }),
      });
      expect(() => selectSender(candidate)).toThrow(/AUTH_ALLOWED_EMAILS/);
    }
    expect(selectSender(consoleEnv()).provider).toBe("console");
  });
});

/* -------------------------------------------------------------------------- */

describe("resend provider", () => {
  it("POSTs the message to Resend with the key as a Bearer credential", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const stub = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return okResponse();
    }) as unknown as typeof fetch;

    const sender = selectSender(resendEnv());
    const result = await sender.send(magicLinkMessage(KNOWN, LINK), { fetch: stub });

    expect(result).toEqual({ provider: "resend", ok: true });
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect(calls[0].init.method).toBe("POST");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(
      "Bearer re_test_key",
    );
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toMatchObject({ from: "signin@gtfs-compass.example", to: [KNOWN] });
    expect(body.text).toContain(LINK);
  });

  it("a non-2xx response is a send failure, not a silent success", async () => {
    const stub = vi.fn(
      async () => new Response(JSON.stringify({ name: "validation_error" }), { status: 422 }),
    ) as unknown as typeof fetch;
    const sender = selectSender(resendEnv());
    await expect(sender.send(magicLinkMessage(KNOWN, LINK), { fetch: stub })).rejects.toThrow(
      EmailSendError,
    );
  });

  it("refuses header injection in the recipient or subject", async () => {
    const stub = vi.fn(async () => okResponse()) as unknown as typeof fetch;
    const sender = selectSender(resendEnv());
    await expect(
      sender.send({ to: "a@b.example\r\nBcc: evil@x.example", subject: "s", text: "t" }, { fetch: stub }),
    ).rejects.toThrow(EmailSendError);
    await expect(
      sender.send({ to: "a@b.example", subject: "s\nBcc: evil@x.example", text: "t" }, { fetch: stub }),
    ).rejects.toThrow(EmailSendError);
    expect(stub).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */

describe("cloudflare-routing provider", () => {
  const routingEnv = (binding: unknown) =>
    e({
      AUTH_EMAIL_PROVIDER: "cloudflare-routing",
      EMAIL_ROUTING: binding,
      AUTH_EMAIL_FROM: "signin@gtfs-compass.example",
    });

  it("hands the binding an RFC 5322 message carrying the link", async () => {
    const routing = fakeRouting();
    const sender = selectSender(routingEnv(routing.binding));
    const result = await sender.send(magicLinkMessage(KNOWN, LINK), routing.deps);

    expect(result).toEqual({ provider: "cloudflare-routing", ok: true });
    expect(routing.sent).toHaveLength(1);
    const { from, to, raw } = routing.sent[0];
    expect(from).toBe("signin@gtfs-compass.example");
    expect(to).toBe(KNOWN);
    expect(raw).toContain("From: signin@gtfs-compass.example");
    expect(raw).toContain(`To: ${KNOWN}`);
    expect(raw).toMatch(/Message-ID: <[^>]+@gtfs-compass\.example>/);
    expect(raw).toContain("Content-Transfer-Encoding: base64");
    expect(raw.split("\r\n\r\n")[0]).not.toContain(TOKEN); // headers carry no token
    // Body is the base64 of the plain text, so the link survives the encoding.
    const body = raw.split("\r\n\r\n")[1].split("\r\n").join("");
    expect(atob(body)).toContain(LINK);
  });

  it("base64 body lines stay within the 76-character MIME limit", () => {
    const raw = buildMime("signin@gtfs-compass.example", magicLinkMessage(KNOWN, LINK));
    for (const line of raw.split("\r\n")) expect(line.length).toBeLessThanOrEqual(998);
    const bodyLines = raw.split("\r\n\r\n")[1].split("\r\n");
    for (const line of bodyLines) expect(line.length).toBeLessThanOrEqual(76);
  });

  it("a rejected send surfaces as EmailSendError (unverified recipient is the common case)", async () => {
    const binding = {
      send: async () => {
        throw new Error("destination address not verified");
      },
    };
    const sender = selectSender(routingEnv(binding));
    await expect(sender.send(magicLinkMessage(UNKNOWN, LINK))).rejects.toThrow(
      /cloudflare-routing rejected/,
    );
  });
});

/* -------------------------------------------------------------------------- */

describe("console provider", () => {
  it("logs the deliberate line and echoes it back for a dev-mode response body", async () => {
    const sink = logSink();
    const sender = selectSender(consoleEnv());
    const result = await sender.send(magicLinkMessage(KNOWN, LINK), sink.deps);

    expect(result.provider).toBe("console");
    expect(result.ok).toBe(true);
    expect(result.echo).toContain(LINK);
    expect(sink.joined()).toContain(LINK);
    expect(sink.joined()).toContain("mario@example.com"); // normalized
  });

  it("refuses an address that is not on the allowlist — the token is never printed", async () => {
    const sink = logSink();
    const sender = selectSender(consoleEnv());
    await expect(sender.send(magicLinkMessage(UNKNOWN, LINK), sink.deps)).rejects.toThrow(
      EmailSendError,
    );
    expect(sink.joined()).not.toContain(TOKEN);
  });
});

/* -------------------------------------------------------------------------- */

describe("token containment", () => {
  it("no provider but console emits the token to a log", async () => {
    const spies = {
      log: vi.spyOn(console, "log").mockImplementation(() => {}),
      warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
      error: vi.spyOn(console, "error").mockImplementation(() => {}),
      info: vi.spyOn(console, "info").mockImplementation(() => {}),
      debug: vi.spyOn(console, "debug").mockImplementation(() => {}),
    };
    try {
      const message = magicLinkMessage(KNOWN, LINK);
      // resend: success and failure, including an upstream that echoes our body.
      const echoing = vi.fn(
        async (_url: string, init: RequestInit) =>
          new Response(`rejected payload: ${String(init.body)}`, { status: 400 }),
      ) as unknown as typeof fetch;
      await deliver(selectSender(resendEnv()), env as unknown as Env, message, { fetch: echoing });
      await deliver(selectSender(resendEnv()), env as unknown as Env, message, {
        fetch: vi.fn(async () => okResponse()) as unknown as typeof fetch,
      });
      // cloudflare-routing: a binding whose error text quotes the message.
      const leaky = {
        send: async () => {
          throw new Error(`refused: ${LINK}`);
        },
      };
      await deliver(
        selectSender(
          e({
            AUTH_EMAIL_PROVIDER: "cloudflare-routing",
            EMAIL_ROUTING: leaky,
            AUTH_EMAIL_FROM: "signin@gtfs-compass.example",
          }),
        ),
        env as unknown as Env,
        message,
      );

      const written = Object.values(spies)
        .flatMap((spy) => spy.mock.calls)
        .flat()
        .map((arg) => String(arg))
        .join("\n");
      expect(written).not.toContain(TOKEN);
      expect(written).toContain("[redacted]"); // the scrub actually fired
    } finally {
      for (const spy of Object.values(spies)) spy.mockRestore();
    }
  });

  it("scrubSecrets removes high-entropy runs from the message, keeping the rest legible", () => {
    expect(scrubSecrets(`upstream said: ${LINK}`, magicLinkMessage(KNOWN, LINK).text)).not.toContain(
      TOKEN,
    );
    expect(scrubSecrets("plain 500 error", magicLinkMessage(KNOWN, LINK).text)).toBe(
      "plain 500 error",
    );
  });
});

/* -------------------------------------------------------------------------- */

describe("addresses and the allowlist", () => {
  it("normalizes to lowercase and trims", () => {
    expect(normalizeEmail("  Mario@Example.COM ")).toBe("mario@example.com");
  });

  it("parses comma- or whitespace-separated lists, deduped and normalized", () => {
    expect(parseAllowlist(e({ AUTH_ALLOWED_EMAILS: "A@x.example, b@x.example\nA@X.example" }))).toEqual([
      "a@x.example",
      "b@x.example",
    ]);
    expect(parseAllowlist(e({}))).toEqual([]);
  });

  it("an empty allowlist means open registration (R4b's deliberate opt-in)", () => {
    expect(isAllowedRecipient(e({}), UNKNOWN)).toBe(true);
    const gated = e({ AUTH_ALLOWED_EMAILS: "mario@example.com" });
    expect(isAllowedRecipient(gated, KNOWN)).toBe(true);
    expect(isAllowedRecipient(gated, UNKNOWN)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */

describe("sharded budgets", () => {
  it("reads a logical counter as a SUM across shards", async () => {
    for (let i = 0; i < 20; i++) await incrementBudget(env as unknown as Env, "t:scope", "k");
    expect(await readBudget(env as unknown as Env, "t:scope", "k")).toBe(20);
    const rows = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM auth_budgets WHERE scope = 't:scope'",
    ).first<{ n: number }>();
    // Spread over shards, not piled on one hot row.
    expect(rows!.n).toBeGreaterThan(1);
    expect(rows!.n).toBeLessThanOrEqual(BUDGET_SHARDS);
  });

  it("counters are per-day: yesterday's total does not charge today", async () => {
    const yesterday = budgetDay() - 1;
    await incrementBudget(env as unknown as Env, "t:scope", "k", yesterday);
    expect(await readBudget(env as unknown as Env, "t:scope", "k", yesterday)).toBe(1);
    expect(await readBudget(env as unknown as Env, "t:scope", "k")).toBe(0);
  });

  it("charging admits up to the limit, then refuses and writes nothing", async () => {
    const target = e({ AUTH_SEND_BUDGET_ADDRESS: "3", AUTH_SEND_BUDGET_KNOWN: "100" });
    for (let i = 0; i < 3; i++) {
      expect((await chargeSendBudget(target, KNOWN, { known: true })).allowed).toBe(true);
    }
    expect((await chargeSendBudget(target, KNOWN, { known: true })).allowed).toBe(false);
    expect(await readBudget(target, SEND_ADDRESS_SCOPE, await hashToken("mario@example.com"))).toBe(
      3,
    );
  });
});

describe("the send budget (R4)", () => {
  const budgetEnv = (extra: Record<string, unknown> = {}) =>
    e({
      AUTH_SEND_BUDGET_ADDRESS: "3",
      AUTH_SEND_BUDGET_KNOWN: "4",
      AUTH_SEND_BUDGET_UNKNOWN: "2",
      ...extra,
    });

  it("keys the per-address counter by hash, not by the address itself", async () => {
    const target = budgetEnv();
    expect(await chargeSendBudget(target, KNOWN, { known: true })).toEqual({
      allowed: true,
      slice: "known",
    });
    const keys = await env.DB.prepare("SELECT DISTINCT key FROM auth_budgets WHERE scope = ?1")
      .bind(SEND_ADDRESS_SCOPE)
      .all<{ key: string }>();
    expect(keys.results.map((r) => r.key)).toEqual([await hashToken("mario@example.com")]);
    // The plaintext address appears nowhere in the table.
    const dump = await env.DB.prepare("SELECT scope, key FROM auth_budgets").all<
      Record<string, string>
    >();
    expect(JSON.stringify(dump.results).toLowerCase()).not.toContain("mario@example.com");
  });

  it("case and whitespace variants of one address share a budget", async () => {
    const target = budgetEnv({ AUTH_SEND_BUDGET_ADDRESS: "2" });
    expect((await chargeSendBudget(target, "mario@example.com", { known: true })).allowed).toBe(true);
    expect((await chargeSendBudget(target, "  MARIO@Example.com ", { known: true })).allowed).toBe(
      true,
    );
    const third = await chargeSendBudget(target, "Mario@EXAMPLE.com", { known: true });
    expect(third).toEqual({ allowed: false, slice: "known", refusedBy: "address" });
  });

  it("charges the slice the `known` flag selects, and only that slice", async () => {
    const target = budgetEnv();
    await chargeSendBudget(target, KNOWN, { known: true });
    await chargeSendBudget(target, UNKNOWN, { known: false });
    expect(await readBudget(target, SEND_GLOBAL_KNOWN_SCOPE, "")).toBe(1);
    expect(await readBudget(target, SEND_GLOBAL_UNKNOWN_SCOPE, "")).toBe(1);
  });

  it("unknown-slice exhaustion still permits a known-account send (the whole point of R4)", async () => {
    // Equal slice sizes on purpose: with one shared counter the spray below
    // would consume the whole cap, so this fails the moment the slices merge.
    const target = budgetEnv({ AUTH_SEND_BUDGET_ADDRESS: "100", AUTH_SEND_BUDGET_KNOWN: "2", AUTH_SEND_BUDGET_UNKNOWN: "2" });
    // Distinct unknown addresses, so the per-address budget never bites — this
    // is exactly the attack the reserved slice exists to survive.
    for (let i = 0; i < 2; i++) {
      expect((await chargeSendBudget(target, `spray${i}@example.net`, { known: false })).allowed).toBe(
        true,
      );
    }
    const exhausted = await chargeSendBudget(target, "spray99@example.net", { known: false });
    expect(exhausted).toEqual({ allowed: false, slice: "unknown", refusedBy: "global" });

    // The spray consumed the unknown slice and left the reserved one untouched.
    expect(await readBudget(target, SEND_GLOBAL_UNKNOWN_SCOPE, "")).toBe(2);
    expect(await readBudget(target, SEND_GLOBAL_KNOWN_SCOPE, "")).toBe(0);

    // Existing users keep their *whole* budget, not merely one leftover send.
    expect(await chargeSendBudget(target, "a@example.com", { known: true })).toEqual({
      allowed: true,
      slice: "known",
    });
    expect((await chargeSendBudget(target, "b@example.com", { known: true })).allowed).toBe(true);
  });

  it("the known slice is bounded too, so a compromised account cannot drain the tier", async () => {
    const target = budgetEnv({ AUTH_SEND_BUDGET_ADDRESS: "100", AUTH_SEND_BUDGET_KNOWN: "2" });
    expect((await chargeSendBudget(target, "a@example.com", { known: true })).allowed).toBe(true);
    expect((await chargeSendBudget(target, "b@example.com", { known: true })).allowed).toBe(true);
    expect((await chargeSendBudget(target, "c@example.com", { known: true })).allowed).toBe(false);
  });

  it("issues the same queries in the same order for known and unknown (R2: no inline branch)", async () => {
    const seen: string[][] = [];
    // A recording proxy over the real D1 binding: the queries are observed, the
    // statements still run, so the assertion is about the executed path.
    const recorder = {
      prepare: (query: string) => {
        seen[seen.length - 1].push(query);
        return env.DB.prepare(query);
      },
    };
    const target = budgetEnv({ DB: recorder });

    seen.push([]);
    await chargeSendBudget(target, "known@example.com", { known: true });
    seen.push([]);
    await chargeSendBudget(target, "unknown@example.net", { known: false });
    // Byte-identical SQL, same count, same order: the slice travels as a *bound
    // value*, never as a different query or an extra one. That is the single
    // difference R4 requires and R2 permits.
    expect(seen[1]).toEqual(seen[0]);
  });

  it("a spent global slice refuses before the per-address counter writes a row", async () => {
    // The address key is attacker-chosen and unbounded, so charging it ahead of
    // the global slice would let an unauthenticated caller mint one persisted
    // D1 row per unique address forever — long after the daily cap on *emails*
    // was spent. The global read has to come first or the cap bounds nothing.
    const target = budgetEnv({ AUTH_SEND_BUDGET_ADDRESS: "5", AUTH_SEND_BUDGET_UNKNOWN: "1" });
    expect((await chargeSendBudget(target, "first@example.net", { known: false })).allowed).toBe(
      true,
    );
    const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM auth_budgets").first<{
      n: number;
    }>();

    for (let i = 0; i < 40; i++) {
      const decision = await chargeSendBudget(target, `spray${i}@example.net`, { known: false });
      expect(decision).toEqual({ allowed: false, slice: "unknown", refusedBy: "global" });
    }
    const after = await env.DB.prepare("SELECT COUNT(*) AS n FROM auth_budgets").first<{
      n: number;
    }>();
    expect(after!.n).toBe(before!.n);
  });

  it("a limit of 0 is an operator kill switch, not a fall back to the default", async () => {
    const stopped = budgetEnv({ AUTH_SEND_BUDGET_UNKNOWN: "0" });
    expect(await chargeSendBudget(stopped, UNKNOWN, { known: false })).toEqual({
      allowed: false,
      slice: "unknown",
      refusedBy: "global",
    });
    expect(await chargeSendBudget(budgetEnv({ AUTH_SEND_BUDGET_ADDRESS: "0" }), KNOWN, {
      known: true,
    })).toEqual({ allowed: false, slice: "known", refusedBy: "address" });
    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM auth_budgets").first<{ n: number }>();
    expect(rows!.n).toBe(0);

    // Malformed config is the case the default exists for; 0 is not malformed.
    for (const raw of ["-1", "abc", "1.5", ""]) {
      expect(
        (await chargeSendBudget(budgetEnv({ AUTH_SEND_BUDGET_UNKNOWN: raw }), `n${raw}@x.example`, {
          known: false,
        })).allowed,
      ).toBe(true);
    }
  });

  it("a charge that will never be mailed spends a parallel counter, not the live slice", async () => {
    const target = budgetEnv();
    const decision = await chargeSendBudget(target, UNKNOWN, { known: false, deliverable: false });
    expect(decision.allowed).toBe(true); // the caller still gets a decision, not an error
    // Neither live counter moved, so a refused address cannot spend the slice
    // that bounds real registrations.
    expect(await readBudget(target, SEND_GLOBAL_UNKNOWN_SCOPE, "")).toBe(0);
    expect(await readBudget(target, SEND_ADDRESS_SCOPE, await hashToken(UNKNOWN))).toBe(0);
    // It is charged on the parallel counters, so the statement shape and the
    // D1 write count are the same as a deliverable request's.
    expect(
      await readBudget(target, SEND_GLOBAL_UNKNOWN_SCOPE + REFUSED_SCOPE_SUFFIX, ""),
    ).toBe(1);
    expect(
      await readBudget(target, SEND_ADDRESS_SCOPE + REFUSED_SCOPE_SUFFIX, await hashToken(UNKNOWN)),
    ).toBe(1);
  });

  it("issues the same queries whether or not the charge is deliverable", async () => {
    const seen: string[][] = [];
    const recorder = {
      prepare: (query: string) => {
        seen[seen.length - 1].push(query);
        return env.DB.prepare(query);
      },
    };
    const target = budgetEnv({ DB: recorder });

    seen.push([]);
    await chargeSendBudget(target, "listed@example.com", { known: false, deliverable: true });
    seen.push([]);
    await chargeSendBudget(target, "unlisted@example.net", { known: false, deliverable: false });
    expect(seen[1]).toEqual(seen[0]);
  });

  it("is callable inline: it returns a value, never a Response, and has committed before it resolves", async () => {
    const target = budgetEnv();
    const decision = await chargeSendBudget(target, KNOWN, { known: true });
    expect(decision).not.toBeInstanceOf(Response);
    // By the time the inline path can respond, the charge is already durable —
    // which is what makes "budget check precedes the response" true rather than
    // a race with the waitUntil send.
    expect(await readBudget(target, SEND_GLOBAL_KNOWN_SCOPE, "")).toBe(1);
    expect(await readBudget(target, SEND_ADDRESS_SCOPE, await hashToken("mario@example.com"))).toBe(
      1,
    );
  });
});

/* -------------------------------------------------------------------------- */

describe("deliver()", () => {
  const message: OutboundEmail = magicLinkMessage(KNOWN, LINK);

  it("never throws, and records a failure on the observable counter", async () => {
    const sink = logSink();
    const failing = vi.fn(async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    const result = await deliver(selectSender(resendEnv()), env as unknown as Env, message, {
      ...sink.deps,
      fetch: failing,
    });
    expect(result).toEqual({ provider: "resend", ok: false });
    expect(await readSendFailures(env as unknown as Env, "resend")).toBe(1);
    expect(await readSendFailures(env as unknown as Env)).toBe(1);
    expect(sink.joined()).toContain("provider=resend");
  });

  it("counts failures per provider", async () => {
    const sink = logSink();
    const failing = vi.fn(async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    await deliver(selectSender(resendEnv()), env as unknown as Env, message, {
      ...sink.deps,
      fetch: failing,
    });
    await deliver(selectSender(consoleEnv()), env as unknown as Env, magicLinkMessage(UNKNOWN, LINK), sink.deps);
    expect(await readSendFailures(env as unknown as Env, "resend")).toBe(1);
    expect(await readSendFailures(env as unknown as Env, "console")).toBe(1);
    expect(await readSendFailures(env as unknown as Env)).toBe(2);
    const failureKeys = await env.DB.prepare("SELECT DISTINCT key FROM auth_budgets WHERE scope = ?1")
      .bind(SEND_FAILURE_SCOPE)
      .all<{ key: string }>();
    expect(failureKeys.results.map((r) => r.key).sort()).toEqual(["console", "resend"]);
  });

  it("records nothing on success and passes the result through", async () => {
    const sink = logSink();
    const result = await deliver(selectSender(consoleEnv()), env as unknown as Env, message, sink.deps);
    expect(result.ok).toBe(true);
    expect(result.echo).toContain(LINK);
    expect(await readSendFailures(env as unknown as Env)).toBe(0);
  });

  it("a broken counter is reported, not allowed to mask the delivery failure", async () => {
    const sink = logSink();
    const broken = {
      ...env,
      DB: {
        prepare: () => {
          throw new Error("d1 unavailable");
        },
      },
    } as unknown as Env;
    const sender: EmailSender = {
      provider: "resend",
      from: "signin@gtfs-compass.example",
      send: async () => {
        throw new EmailSendError("upstream down");
      },
    };
    const result = await deliver(sender, broken, message, sink.deps);
    expect(result).toEqual({ provider: "resend", ok: false });
    expect(sink.joined()).toContain("upstream down");
    expect(sink.joined()).toContain("failure counter write failed");
  });
});
