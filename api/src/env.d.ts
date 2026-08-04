import type { AlertDO } from "./alerts_do";
import type { SendEmailBinding } from "./email";
import type { FeedDO } from "./feed_do";
import type { GbfsDO } from "./gbfs_do";

declare global {
  interface Env {
    DB: D1Database;
    FEED_DO: DurableObjectNamespace<FeedDO>;
    GBFS_DO: DurableObjectNamespace<GbfsDO>;
    ALERT_DO: DurableObjectNamespace<AlertDO>;
    /** Curated-feed allowlist (wrangler vars, JSON array of feed ids). */
    CURATED_FEEDS?: string[];
    /** Accuracy gate for locate results, meters (default 500). */
    LOCATE_MAX_ACCURACY_M?: string;
    /** Abort timeout for locate provider fetches, ms (default 2000). */
    LOCATE_TIMEOUT_MS?: string;
    /** Shared secret gating the locate diagnostics surfaces (wrangler secret). */
    DIAG_TOKEN?: string;
    /** JSON map of feed id → realtime API key for rt_needs_key feeds
     * (wrangler secret, e.g. {"mta-bus": "..."}). */
    RT_FEED_KEYS?: string;
    /**
     * Auth bypass (R5). The **exact** string "single" binds every request to
     * the synthetic user `usr_single` and skips login; anything unset or
     * unrecognized fails closed to multi-user. Browser-only controls still
     * apply, so this is safe only behind a network-level control.
     */
    AUTH_MODE?: string;
    /** Sliding session window in days (default 30, renewed at half-life). */
    SESSION_TTL_DAYS?: string;
    /** Absolute session lifetime in days from created_at (default 180). */
    SESSION_ABSOLUTE_TTL_DAYS?: string;
    /**
     * Magic-link delivery provider (R1). Exact match on `resend`,
     * `cloudflare-routing`, or `console`; anything unset or unrecognized is a
     * hard failure, never a silent downgrade to printing tokens.
     */
    AUTH_EMAIL_PROVIDER?: string;
    /** Envelope sender for sign-in mail. Required by `resend` and `cloudflare-routing`. */
    AUTH_EMAIL_FROM?: string;
    /** Resend API key (wrangler secret). Required when AUTH_EMAIL_PROVIDER=resend. */
    RESEND_API_KEY?: string;
    /**
     * Cloudflare Email Routing `send_email` binding, used when
     * AUTH_EMAIL_PROVIDER=cloudflare-routing. Delivers only to addresses
     * already verified as destinations in the zone's Email Routing settings.
     */
    EMAIL_ROUTING?: SendEmailBinding;
    /**
     * Registration allowlist (R4b), comma- or whitespace-separated. **Unset or
     * empty means open sign-up — anyone on the internet can register**, which
     * is the shipped default; an unlisted address gets the same silent 200.
     * Also the unconditional second condition for AUTH_EMAIL_PROVIDER=console.
     */
    AUTH_ALLOWED_EMAILS?: string;
    /**
     * Per-address sign-in sends per UTC day (default 5). `0` stops sends
     * outright — it is the kill switch, not a fall back to the default.
     */
    AUTH_SEND_BUDGET_ADDRESS?: string;
    /** Daily global send slice reserved for addresses with accounts (default 80; 0 stops sends). */
    AUTH_SEND_BUDGET_KNOWN?: string;
    /** Daily global send slice for unknown addresses (default 20; 0 stops sends). */
    AUTH_SEND_BUDGET_UNKNOWN?: string;
    /**
     * Origin the emailed sign-in link points at, e.g. `https://compass.example`.
     * Optional: defaults to the origin of the request that asked for the link,
     * which is derived from the `Host` header — set this to pin links to the
     * real front door on a deployment reachable under more than one hostname.
     */
    AUTH_PUBLIC_ORIGIN?: string;
    /**
     * Pairing starts one client **network** may request per UTC day (R7,
     * default 20). The key is the /24 (IPv4) or /64 (IPv6), not the address, so
     * a subscriber cannot buy more budget by changing addresses. Bounds an
     * unauthenticated INSERT, so `0` disables device pairing outright — it is a
     * kill switch, not a fall back to the default.
     */
    PAIR_START_BUDGET_IP?: string;
    /**
     * Deployment-wide starts per UTC day from networks still within their first
     * few of the day (default 400) — where an honest board pairing for the
     * first time lands. Reserved from PAIR_START_BUDGET_REPEAT so that a caller
     * hammering one network cannot switch pairing off for everybody else. `0`
     * refuses every such start.
     */
    PAIR_START_BUDGET_FRESH?: string;
    /**
     * Deployment-wide starts per UTC day from a network that has already spent
     * its fresh allowance (default 100) — retry storms and abuse. `0` allows a
     * network its first few starts per day and nothing more.
     */
    PAIR_START_BUDGET_REPEAT?: string;
    /**
     * Claim attempts one signed-in account may make per UTC day (R7, default
     * 10), counting attempts against codes that do not exist. This is the
     * anti-spray control; `0` disables claiming.
     */
    PAIR_CLAIM_BUDGET_CLAIMER?: string;
    /**
     * Claim attempts one client network (/24 or /64) may make per UTC day
     * (default 20; 0 disables claiming).
     */
    PAIR_CLAIM_BUDGET_IP?: string;
    /**
     * Deployment-wide claim attempts per UTC day from accounts still within
     * their first few of the day (default 400), and from accounts past them
     * (default 100). Split for the same reason as the start slices: one abuser
     * exhausting a shared counter would lock every other account out of pairing
     * until 00:00 UTC. `0` on either refuses that class.
     */
    PAIR_CLAIM_BUDGET_FRESH?: string;
    PAIR_CLAIM_BUDGET_REPEAT?: string;
    /**
     * Retention tier one (R20): days after which `locate_log` raw coordinates
     * are nulled and `device_fixes` rows are deleted (default 14). The derived
     * metrics survive to LOCATE_LOG_RETENTION_DAYS.
     */
    LOCATE_LOG_PRECISE_DAYS?: string;
    /** Retention tier two (R20): days after which a `locate_log` row is deleted (default 90). */
    LOCATE_LOG_RETENTION_DAYS?: string;
    /** Rows per purge statement (default 500). */
    RETENTION_BATCH_LIMIT?: string;
    /** Statements per purge phase per cron invocation (default 20). */
    RETENTION_MAX_BATCHES?: string;
  }
  // `cloudflare:test`'s env (and workers-types' import { env }) are typed as
  // Cloudflare.Env; bridge the project Env into it.
  namespace Cloudflare {
    interface Env extends globalThis.Env {}
  }
}

export {};
