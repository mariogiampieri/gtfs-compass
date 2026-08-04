/**
 * email.ts — magic-link delivery behind one narrow seam, and the D1 abuse
 * budgets that sit in front of it (Phase 5 plan, U3; requirements R1, R4, R4b).
 *
 * Seam shape mirrors `locate.ts`: an ordered set of providers behind one
 * interface, selected by env, with the policy in exactly one place. Two
 * properties this module exists to guarantee structurally rather than by
 * convention:
 *
 *  1. **A misconfigured provider is a hard failure, never a downgrade to
 *     printing tokens.** `AUTH_EMAIL_PROVIDER` is an exact-string match with no
 *     fallback, and every provider validates its whole configuration in
 *     `selectSender()` — which does no I/O and is meant to be called *inline,
 *     before a token is minted*. MailChannels' free Workers path was terminated
 *     in August 2024; there is deliberately no keyless path here to inherit it.
 *
 *  2. **The token reaches exactly one log line, in console mode, on purpose.**
 *     No other provider logs a message body, and `deliver()` scrubs the
 *     message's own high-entropy substrings out of any upstream error text
 *     before it warns — so an upstream that echoes our request body cannot
 *     launder a live sign-in token into the operator's logs.
 *
 * Budgets (R4) are sharded daily counters in `auth_budgets`. Sharding is not
 * decoration: a single global counter row is one hot row under D1's
 * single-primary write path, so each logical counter is spread over
 * `BUDGET_SHARDS` rows, read as a `SUM` and incremented on one random shard.
 *
 * The global daily cap is **split into two slices** — one for addresses that
 * already have an account, a smaller one for unknown addresses. Resend's free
 * tier is 100/day and the cap fails closed, so a single shared counter would
 * let an attacker spraying unknown addresses lock every existing user out of
 * sign-in. The slices make that attack cost the attacker's slice only.
 *
 * R2 constrains this module's shape: `chargeSendBudget()` must be callable
 * inline, before the response, and must not branch observably on account
 * existence beyond *which slice it charges*. Every branch issues the same
 * queries in the same order; only the `scope` string and the limit differ.
 */

import { hashToken, randomToken } from "./auth";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/** The providers `AUTH_EMAIL_PROVIDER` may name. Exact match, no aliases. */
export type EmailProviderName = "resend" | "cloudflare-routing" | "console";

const PROVIDER_NAMES: readonly EmailProviderName[] = ["resend", "cloudflare-routing", "console"];

/** One outbound message. Plain text only — a sign-in link needs nothing more. */
export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
}

/**
 * Injection points. The workers-test pool stubs `fetch` globally, so the
 * network call and the two log sinks are parameters rather than captured
 * globals; production passes nothing and gets the real ones.
 */
export interface EmailDeps {
  fetch?: typeof fetch;
  log?: (line: string) => void;
  warn?: (line: string) => void;
  /**
   * `cloudflare-routing` only: builds the object the `send_email` binding
   * accepts. Defaults to a lazy `import("cloudflare:email")`, which keeps that
   * runtime-only module off the import graph of every other provider.
   */
  routingMessage?: (from: string, to: string, raw: string) => Promise<unknown>;
}

export interface EmailSendResult {
  provider: EmailProviderName;
  ok: boolean;
  /**
   * Console mode only: the exact line that was logged. The one deliberate
   * place a token is allowed to surface, so a local operator can complete a
   * sign-in with no mail provider configured at all.
   */
  echo?: string;
}

/** A fully configured provider. Constructing one has already validated its config. */
export interface EmailSender {
  readonly provider: EmailProviderName;
  readonly from: string;
  send(message: OutboundEmail, deps?: EmailDeps): Promise<EmailSendResult>;
}

/**
 * The provider cannot be used at all: unset, unrecognized, or missing a key.
 * Thrown from `selectSender()` so the caller fails *before* minting a token.
 */
export class EmailConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailConfigError";
  }
}

/** A configured provider refused or failed this particular send. */
export class EmailSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailSendError";
  }
}

/**
 * Structural shape of a Cloudflare Email Routing `send_email` binding. Declared
 * here rather than imported from `cloudflare:email` so this module stays
 * loadable — and testable — wherever that runtime module is absent.
 */
export interface SendEmailBinding {
  send(message: unknown): Promise<void>;
}

/* -------------------------------------------------------------------------- */
/* Addresses and the allowlist (R4b)                                           */
/* -------------------------------------------------------------------------- */

/**
 * Lowercase + trim, in application code. Migration 0003 deliberately does not
 * use `COLLATE NOCASE` (SQLite's 12-step table rebuild on a table every account
 * table cascades to, and ASCII-only besides), so this is the only normalizer.
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * `AUTH_ALLOWED_EMAILS`, normalized and deduped. Comma- or whitespace-separated.
 * An empty list means "no allowlist" — which for registration (R4b) is the
 * deliberate opt-in to open sign-up, and for console mode is a refusal.
 */
export function parseAllowlist(env: Env): string[] {
  const out: string[] = [];
  for (const part of (env.AUTH_ALLOWED_EMAILS ?? "").split(/[,\s]+/)) {
    const address = normalizeEmail(part);
    if (address && !out.includes(address)) out.push(address);
  }
  return out;
}

/**
 * R4b's registration gate. An unlisted address must receive the identical
 * silent 200 R2 requires — so this returns a boolean for the caller to consume
 * *after* the inline path has already committed to its response shape, never a
 * `Response`.
 */
export function isAllowedRecipient(env: Env, email: string): boolean {
  const list = parseAllowlist(env);
  return list.length === 0 || list.includes(normalizeEmail(email));
}

/** CR/LF in a header value is SMTP header injection. Refuse, never sanitize. */
function assertHeaderSafe(field: string, value: string): void {
  if (/[\r\n]/.test(value)) {
    throw new EmailSendError(`refusing to send: ${field} contains a line break`);
  }
}

/**
 * The one place the sign-in mail's wording lives, so no caller has to decide
 * how much of the link to put where. The URL carries the token in its fragment
 * (R1) — the caller builds it; this only frames it.
 */
export function magicLinkMessage(to: string, url: string): OutboundEmail {
  return {
    to,
    subject: "Your gtfs-compass sign-in link",
    text: [
      "Open this link to finish signing in to gtfs-compass:",
      "",
      url,
      "",
      "The link works once and expires in 10 minutes.",
      "If you did not ask to sign in, you can ignore this message — nothing has changed.",
    ].join("\n"),
  };
}

/* -------------------------------------------------------------------------- */
/* Providers                                                                   */
/* -------------------------------------------------------------------------- */

const RESEND_URL = "https://api.resend.com/emails";
/** A hung provider must not hold a `waitUntil` open indefinitely. */
const SEND_TIMEOUT_MS = 10_000;

function requireFrom(env: Env, provider: EmailProviderName): string {
  const from = (env.AUTH_EMAIL_FROM ?? "").trim();
  if (!from) {
    throw new EmailConfigError(
      `AUTH_EMAIL_PROVIDER=${provider} requires AUTH_EMAIL_FROM (a verified sender address)`,
    );
  }
  assertHeaderSafe("AUTH_EMAIL_FROM", from);
  return from;
}

/** Bound the size of anything upstream hands back before it reaches a log. */
function truncate(text: string, limit = 200): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/**
 * Resend over plain HTTPS — no SDK, because the whole call is one POST and a
 * dependency on the auth path is a dependency on sign-in working.
 */
function resendSender(env: Env): EmailSender {
  const key = (env.RESEND_API_KEY ?? "").trim();
  if (!key) {
    // The hard failure the KTD demands: a configured provider with no key stops
    // sign-in, and never quietly becomes "print the token to the log instead".
    throw new EmailConfigError(
      "AUTH_EMAIL_PROVIDER=resend but RESEND_API_KEY is unset — refusing to send",
    );
  }
  const from = requireFrom(env, "resend");
  return {
    provider: "resend",
    from,
    async send(message, deps = {}) {
      assertHeaderSafe("to", message.to);
      assertHeaderSafe("subject", message.subject);
      const doFetch = deps.fetch ?? fetch;
      const res = await doFetch(RESEND_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
        }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new EmailSendError(`resend rejected the send: ${res.status} ${truncate(body)}`);
      }
      return { provider: "resend", ok: true };
    },
  };
}

/**
 * Cloudflare Email Routing's `send_email` binding — zero cost, and the reason
 * it is not the default: **it can only deliver to addresses already verified as
 * destinations in the zone's Email Routing settings.** That is fine for a
 * single-operator deployment and useless for open registration, so choosing it
 * is choosing an allowlisted world.
 */
function routingSender(env: Env): EmailSender {
  const binding = env.EMAIL_ROUTING;
  if (!binding) {
    throw new EmailConfigError(
      "AUTH_EMAIL_PROVIDER=cloudflare-routing but no EMAIL_ROUTING send_email binding is " +
        "configured in wrangler.jsonc — refusing to send",
    );
  }
  const from = requireFrom(env, "cloudflare-routing");
  return {
    provider: "cloudflare-routing",
    from,
    async send(message, deps = {}) {
      const raw = buildMime(from, message);
      const build = deps.routingMessage ?? defaultRoutingMessage;
      try {
        await binding.send(await build(from, message.to, raw));
      } catch (err) {
        // Almost always "destination address not verified". Surfaced as a send
        // failure so it lands on the observable counter rather than vanishing.
        throw new EmailSendError(
          `cloudflare-routing rejected the send: ${truncate(errorText(err))}`,
        );
      }
      return { provider: "cloudflare-routing", ok: true };
    },
  };
}

async function defaultRoutingMessage(from: string, to: string, raw: string): Promise<unknown> {
  const mod = (await import("cloudflare:email")) as {
    EmailMessage: new (from: string, to: string, raw: string) => unknown;
  };
  return new mod.EmailMessage(from, to, raw);
}

/**
 * Local development only. Two conditions, both required: `AUTH_EMAIL_PROVIDER`
 * must name it *explicitly* (there is no path that arrives here by default or
 * by fallback), and `AUTH_ALLOWED_EMAILS` must be non-empty — so the mode that
 * prints live sign-in tokens can only ever print them for named addresses.
 */
function consoleSender(env: Env): EmailSender {
  const allowlist = parseAllowlist(env);
  if (allowlist.length === 0) {
    throw new EmailConfigError(
      "AUTH_EMAIL_PROVIDER=console requires a non-empty AUTH_ALLOWED_EMAILS — refusing to " +
        "print sign-in tokens for arbitrary addresses",
    );
  }
  const from = (env.AUTH_EMAIL_FROM ?? "").trim() || "gtfs-compass@localhost";
  return {
    provider: "console",
    from,
    async send(message, deps = {}) {
      const to = normalizeEmail(message.to);
      if (!allowlist.includes(to)) {
        throw new EmailSendError(
          "console provider refuses an address that is not on AUTH_ALLOWED_EMAILS",
        );
      }
      // THE deliberate token line. Nothing else in this module logs a body.
      const line = `[email:console] to=${to} subject=${message.subject}\n${message.text}`;
      (deps.log ?? console.log)(line);
      return { provider: "console", ok: true, echo: line };
    },
  };
}

/**
 * Resolve `AUTH_EMAIL_PROVIDER` to a fully configured sender, or throw.
 *
 * Does no I/O: **call it inline, before minting a token.** That ordering is
 * what makes "provider configured but unusable" produce no `magic_tokens` row
 * and no half-completed sign-in.
 */
export function selectSender(env: Env): EmailSender {
  const raw = env.AUTH_EMAIL_PROVIDER;
  if (!raw) {
    throw new EmailConfigError(
      "AUTH_EMAIL_PROVIDER is unset — email delivery is not configured, so sign-in is disabled",
    );
  }
  if (!PROVIDER_NAMES.includes(raw as EmailProviderName)) {
    // Fails closed exactly like AUTH_MODE: an unrecognized value is never
    // rounded down to the token-printing provider.
    throw new EmailConfigError(
      `unknown AUTH_EMAIL_PROVIDER ${JSON.stringify(raw)} — expected one of ${PROVIDER_NAMES.join(", ")}`,
    );
  }
  switch (raw as EmailProviderName) {
    case "resend":
      return resendSender(env);
    case "cloudflare-routing":
      return routingSender(env);
    case "console":
      return consoleSender(env);
  }
}

/* -------------------------------------------------------------------------- */
/* MIME (cloudflare-routing)                                                   */
/* -------------------------------------------------------------------------- */

function base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** RFC 2045 caps an encoded line at 76 characters. */
function wrap76(encoded: string): string {
  const lines: string[] = [];
  for (let i = 0; i < encoded.length; i += 76) lines.push(encoded.slice(i, i + 76));
  return lines.join("\r\n");
}

/**
 * A minimal RFC 5322 message. Hand-built rather than pulled from a MIME library
 * on purpose: this is one plain-text part with no attachments, and the auth
 * path does not need another dependency. Body is base64 so a long sign-in URL
 * cannot trip the 998-character line limit.
 */
export function buildMime(from: string, message: OutboundEmail): string {
  assertHeaderSafe("from", from);
  assertHeaderSafe("to", message.to);
  assertHeaderSafe("subject", message.subject);
  const domain = from.split("@")[1] ?? "gtfs-compass.invalid";
  return [
    `From: ${from}`,
    `To: ${message.to}`,
    `Message-ID: <${randomToken(12)}@${domain}>`,
    `Date: ${new Date().toUTCString()}`,
    `Subject: ${message.subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(base64(message.text)),
  ].join("\r\n");
}

/* -------------------------------------------------------------------------- */
/* Budgets (R4) — sharded daily counters in D1                                 */
/* -------------------------------------------------------------------------- */

/**
 * Shard count for every logical counter. Eight is enough to break up the hot
 * row without making the `SUM` read expensive; it is a constant rather than a
 * var because changing it mid-day would split a live counter's total.
 */
export const BUDGET_SHARDS = 8;

/** `auth_budgets.scope` values this module owns. */
export const SEND_ADDRESS_SCOPE = "send:address";
export const SEND_GLOBAL_KNOWN_SCOPE = "send:global:known";
export const SEND_GLOBAL_UNKNOWN_SCOPE = "send:global:unknown";
export const SEND_FAILURE_SCOPE = "send:failure";

/**
 * Suffix that turns each send scope into its dead twin. A request that was
 * never going to be mailed — an address the allowlist refuses, a repeat that
 * already holds its cap of live links — charges these instead of the live
 * slices, so the statement shape and the D1 write count are unchanged while
 * the counters that gate real sign-ins are not consumed. Without it, twenty
 * throwaway addresses block every new registration until 00:00 UTC.
 */
export const REFUSED_SCOPE_SUFFIX = ":refused";

const DEFAULT_ADDRESS_BUDGET = 5;
/**
 * Defaults sum to 100/day — Resend's free tier — with four fifths reserved for
 * addresses that already have an account. Raise both together when the tier does.
 */
const DEFAULT_GLOBAL_KNOWN_BUDGET = 80;
const DEFAULT_GLOBAL_UNKNOWN_BUDGET = 20;

const DAY_MS = 86_400_000;

/** Days since the epoch, UTC — the `auth_budgets.day` column's meaning. */
export function budgetDay(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / DAY_MS);
}

/** Read a logical counter: the SUM across its shards for one day. */
export async function readBudget(
  env: Env,
  scope: string,
  key = "",
  day: number = budgetDay(),
): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COALESCE(SUM(count), 0) AS n FROM auth_budgets WHERE scope = ?1 AND key = ?2 AND day = ?3",
  )
    .bind(scope, key, day)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Increment one randomly chosen shard — the write half of the hot-row split. */
export async function incrementBudget(
  env: Env,
  scope: string,
  key = "",
  day: number = budgetDay(),
): Promise<void> {
  const shard = Math.floor(Math.random() * BUDGET_SHARDS);
  await env.DB.prepare(
    `INSERT INTO auth_budgets (scope, key, day, shard, count) VALUES (?1, ?2, ?3, ?4, 1)
     ON CONFLICT (scope, key, day, shard) DO UPDATE SET count = count + 1`,
  )
    .bind(scope, key, day, shard)
    .run();
}

/** Which global slice a charge landed in. Operator-facing only — never a response. */
export type BudgetSlice = "known" | "unknown";

export interface SendBudgetDecision {
  allowed: boolean;
  slice: BudgetSlice;
  /** Which limit refused, for the operator log. Absent when allowed. */
  refusedBy?: "address" | "global";
}

/**
 * Budget limits parse differently from `intVar`'s positive-only timeouts: **0
 * is meaningful here.** It is the operator's kill switch — "stop sending mail
 * right now" — so it has to survive parsing rather than being rounded up to
 * the default. Anything that is not a whole non-negative number is malformed
 * config, which is what the default exists for.
 */
function budgetVar(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  if (trimmed === "") return fallback;
  const n = Number(trimmed);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

function addressLimit(env: Env): number {
  return budgetVar(env.AUTH_SEND_BUDGET_ADDRESS, DEFAULT_ADDRESS_BUDGET);
}

function globalLimit(env: Env, slice: BudgetSlice): number {
  return slice === "known"
    ? budgetVar(env.AUTH_SEND_BUDGET_KNOWN, DEFAULT_GLOBAL_KNOWN_BUDGET)
    : budgetVar(env.AUTH_SEND_BUDGET_UNKNOWN, DEFAULT_GLOBAL_UNKNOWN_BUDGET);
}

/**
 * The one call `/v1/auth/request` makes **inline, before responding** (R2, R4).
 *
 * `known` says whether the address already has an account and `deliverable`
 * whether a mail is actually going out; the caller establishes both. They
 * select *which* counters are charged and nothing else: every combination runs
 * the same reads and the same writes in the same order against differently
 * named scopes, so the inline path has no branch an observer can time or count.
 *
 * **Both counters are read before either is written.** The address key is
 * attacker-chosen with unbounded cardinality, so charging it ahead of the
 * global slice would insert one persisted `auth_budgets` row per unique
 * address for as long as anyone cares to POST — the global cap would bound
 * emails and nothing about D1. Reading the global slice first means a spent
 * cap writes nothing at all.
 *
 * The address key is a SHA-256 of the normalized address, so `auth_budgets` is
 * not a plaintext list of everyone who ever tried to sign in.
 *
 * Deliberately not serializable: two concurrent charges at the boundary can
 * both pass, so a limit of N admits N+1 in the worst case. That is the correct
 * trade for a rate limit — the alternative is a transaction on the hot row the
 * sharding exists to avoid.
 */
export async function chargeSendBudget(
  env: Env,
  email: string,
  opts: { known: boolean; deliverable?: boolean },
): Promise<SendBudgetDecision> {
  const slice: BudgetSlice = opts.known ? "known" : "unknown";
  const suffix = opts.deliverable === false ? REFUSED_SCOPE_SUFFIX : "";
  const addressScope = SEND_ADDRESS_SCOPE + suffix;
  const globalScope = (opts.known ? SEND_GLOBAL_KNOWN_SCOPE : SEND_GLOBAL_UNKNOWN_SCOPE) + suffix;
  const key = await hashToken(normalizeEmail(email));

  const addressUsed = await readBudget(env, addressScope, key);
  const globalUsed = await readBudget(env, globalScope, "");
  if (globalUsed >= globalLimit(env, slice)) return { allowed: false, slice, refusedBy: "global" };
  if (addressUsed >= addressLimit(env)) return { allowed: false, slice, refusedBy: "address" };

  // A failure between the two increments leaves the address charged and the
  // slice not. Accepted: over-charging one address is the harmless direction to
  // be wrong in, and the alternative is the transaction sharding exists to avoid.
  await incrementBudget(env, addressScope, key);
  await incrementBudget(env, globalScope, "");
  return { allowed: true, slice };
}

/* -------------------------------------------------------------------------- */
/* Delivery and the failure counter                                            */
/* -------------------------------------------------------------------------- */

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Remove anything token-shaped that came from `source` before `text` is logged.
 *
 * The threat is narrow and real: a provider that echoes the offending request
 * body in its error response would otherwise put a live, unexpired sign-in
 * token into the operator's log, where console mode's deliberate line is
 * supposed to be the only one. Candidates are high-entropy runs from the
 * message we just tried to send, so unrelated error text survives intact.
 */
export function scrubSecrets(text: string, source: string): string {
  let out = text;
  for (const candidate of source.match(/[A-Za-z0-9_-]{16,}/g) ?? []) {
    out = out.split(candidate).join("[redacted]");
  }
  return out;
}

/**
 * Count a failed send. A `waitUntil` send that throws is otherwise a silent
 * 200 — the response has already gone out, so this counter is the only place
 * an operator can see that sign-in mail has stopped leaving the building.
 * Keyed by provider, in the same sharded table as the budgets.
 */
export async function recordSendFailure(env: Env, provider: EmailProviderName): Promise<void> {
  await incrementBudget(env, SEND_FAILURE_SCOPE, provider);
}

/** Today's send failures, for one provider or all of them. */
export async function readSendFailures(
  env: Env,
  provider?: EmailProviderName,
  day: number = budgetDay(),
): Promise<number> {
  if (provider) return readBudget(env, SEND_FAILURE_SCOPE, provider, day);
  const row = await env.DB.prepare(
    "SELECT COALESCE(SUM(count), 0) AS n FROM auth_budgets WHERE scope = ?1 AND day = ?2",
  )
    .bind(SEND_FAILURE_SCOPE, day)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * The function `/v1/auth/request` hands to `waitUntil`. **Never throws** — a
 * rejected `waitUntil` promise is an unhandled rejection in the isolate and
 * tells nobody anything — and instead records the failure on the observable
 * counter and warns with the message text scrubbed out.
 */
export async function deliver(
  sender: EmailSender,
  env: Env,
  message: OutboundEmail,
  deps: EmailDeps = {},
): Promise<EmailSendResult> {
  try {
    return await sender.send(message, deps);
  } catch (err) {
    const detail = scrubSecrets(errorText(err), message.text);
    (deps.warn ?? console.warn)(`[email] send failed provider=${sender.provider} detail=${detail}`);
    try {
      await recordSendFailure(env, sender.provider);
    } catch (counterErr) {
      // The counter must never mask the delivery failure it exists to report.
      (deps.warn ?? console.warn)(
        `[email] failure counter write failed: ${truncate(errorText(counterErr))}`,
      );
    }
    return { provider: sender.provider, ok: false };
  }
}
