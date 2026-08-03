/**
 * Lifecycle pieces shared *verbatim* by FeedDO and GbfsDO. Only code that is
 * identical between the two lives here (the plan forbids speculative
 * abstraction) — cadence, snapshot shape, config loading all stay per-DO.
 */

export const IDLE_SUSPEND_MS = 10 * 60_000;
export const FETCH_TIMEOUT_MS = 10_000; // safely under either poll cadence

/** "{feed_id}:{group}" addressing, persisted on first read. */
export interface DoIdentity {
  feedId: string;
  group: string;
}

export function doTag(identity: DoIdentity | null): string {
  return identity ? `[${identity.feedId}:${identity.group}]` : "[unbound]";
}

export class MissingFeedError extends Error {
  constructor(feedId: string) {
    super(`no feeds row for ${feedId}`);
    this.name = "MissingFeedError";
  }
}

/**
 * Batch `?ids=` parsing: split the RAW query value on ',' and then decode
 * each segment — the exact inverse of `map(encodeURIComponent).join(",")`,
 * so an id containing a comma survives the round trip. (URLSearchParams
 * decodes before we could split, corrupting such ids.) Null when absent.
 */
export function batchIdsParam(url: URL): string[] | null {
  const match = /[?&]ids=([^&]*)/.exec(url.search);
  if (!match) return null;
  return match[1]
    .split(",")
    .filter((segment) => segment !== "")
    .map(decodeURIComponent);
}
