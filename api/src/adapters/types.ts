// The spec's adapter seam — keep it this narrow (docs/plans/01-guiding-spec.md).
export interface Arrival {
  routeId: string;
  time: number; // epoch seconds
  /**
   * The trip's terminal stop (last stop_time_update): branched routes need
   * per-train headsigns, and a dominant per-direction label is wrong for
   * roughly half of southbound A trains. Absent when the feed omits it.
   */
  terminalStopId?: string;
}

export interface FeedAdapter {
  /** Reduce a raw realtime feed to per-stop upcoming arrivals (time >= now). */
  parse(buf: Uint8Array, now: number): Map<string, Arrival[]>;
}

/** Typed decode failure so callers can distinguish garbage input from bugs. */
export class ParseError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ParseError";
    this.cause = cause;
  }
}
