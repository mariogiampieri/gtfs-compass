import { describe, expect, it } from "vitest";

import {
  AGENCY_WIDE_KEY,
  type AlertItem,
  isActiveNow,
  parseMtaAlerts,
  severityFor,
} from "../../src/adapters/mta_alerts";
import { ParseError } from "../../src/adapters/types";

const MERCURY = "transit_realtime.mercury_alert";

function entity(overrides: {
  routes?: string[];
  stops?: string[];
  directions?: number[];
  agency?: boolean;
  alertType?: string;
  text?: string | null;
  periods?: { start?: number; end?: number }[];
  updatedAt?: number;
}): Record<string, unknown> {
  const informed: Record<string, unknown>[] = [];
  for (const r of overrides.routes ?? []) informed.push({ route_id: r });
  for (const s of overrides.stops ?? []) informed.push({ route_id: overrides.routes?.[0], stop_id: s });
  for (const d of overrides.directions ?? []) informed.push({ route_id: overrides.routes?.[0], direction_id: d });
  if (overrides.agency) informed.push({ agency_id: "MTASBWY" });
  return {
    id: "lmm:alert:1",
    alert: {
      informed_entity: informed,
      active_period: overrides.periods ?? [],
      header_text:
        overrides.text === null
          ? { translation: [{ language: "en-html", text: "<b>html only</b>" }] }
          : { translation: [
              { language: "en-html", text: "<b>html</b>" },
              { language: "en", text: overrides.text ?? "Trains are delayed" },
            ] },
      [MERCURY]: {
        alert_type: overrides.alertType ?? "Delays",
        updated_at: overrides.updatedAt ?? 1785700000,
        created_at: 1785600000,
      },
    },
  };
}

function feedOf(entities: Record<string, unknown>[]): string {
  return JSON.stringify({ header: { timestamp: 1785731836 }, entity: entities });
}

describe("severityFor", () => {
  it("maps the disruption band to delay and the rest to info", () => {
    expect(severityFor("Delays")).toBe("delay");
    expect(severityFor("Planned - Part Suspended")).toBe("delay");
    expect(severityFor("Planned - Stops Skipped")).toBe("delay");
    expect(severityFor("Reduced Service")).toBe("delay");
    expect(severityFor("Boarding Change")).toBe("info");
    expect(severityFor("Extra Service")).toBe("info");
    expect(severityFor("Planned - Reroute")).toBe("info");
    expect(severityFor("Some Future Type")).toBe("info"); // unseen → info
    expect(severityFor(undefined)).toBe("info");
  });
});

describe("parseMtaAlerts", () => {
  it("keys alerts by route with severity, text, and timestamp", () => {
    const parsed = parseMtaAlerts(feedOf([entity({ routes: ["A", "C"], alertType: "Delays" })]));
    expect(parsed.timestamp).toBe(1785731836);
    expect(parsed.byRoute.get("A")).toHaveLength(1);
    expect(parsed.byRoute.get("C")).toHaveLength(1); // both routes carry it
    const item = parsed.byRoute.get("A")![0];
    expect(item.severity).toBe("delay");
    expect(item.text).toBe("Trains are delayed");
    expect(item.updatedAt).toBe(1785700000);
    expect(parsed.entitiesParsed).toBe(1);
    expect(parsed.entitiesWithMercury).toBe(1);
  });

  it("routes agency-only alerts to the agency-wide sentinel, not doubled onto routes", () => {
    const parsed = parseMtaAlerts(
      feedOf([entity({ agency: true, text: "System suspended" }), entity({ routes: ["G"], agency: true })]),
    );
    expect(parsed.byRoute.get(AGENCY_WIDE_KEY)).toHaveLength(1);
    expect(parsed.byRoute.get(AGENCY_WIDE_KEY)![0].text).toBe("System suspended");
    expect(parsed.byRoute.get("G")).toHaveLength(1); // mixed → route key only
  });

  it("normalizes route aliases (SIR → SI)", () => {
    const parsed = parseMtaAlerts(feedOf([entity({ routes: ["SIR"] })]));
    expect(parsed.byRoute.has("SI")).toBe(true);
    expect(parsed.byRoute.has("SIR")).toBe(false);
  });

  it("derives direction from explicit selectors and platform suffixes, keeping raw stop ids", () => {
    const parsed = parseMtaAlerts(
      feedOf([entity({ routes: ["A"], stops: ["A33S", "A25"], directions: [] })]),
    );
    const item = parsed.byRoute.get("A")![0];
    expect(item.directionIds).toEqual([1]); // from the S suffix only
    expect(item.stopIds).toEqual(["A33S", "A25"]); // raw ids retained for scoping

    const explicit = parseMtaAlerts(feedOf([entity({ routes: ["A"], directions: [0] })]));
    expect(explicit.byRoute.get("A")![0].directionIds).toEqual([0]);

    const none = parseMtaAlerts(feedOf([entity({ routes: ["A"] })]));
    expect(none.byRoute.get("A")![0].directionIds).toEqual([]); // absent ≠ 0
  });

  it("picks the en translation over en-html and skips entities with no English copy", () => {
    const parsed = parseMtaAlerts(feedOf([entity({ routes: ["A"], text: null })]));
    expect(parsed.byRoute.size).toBe(0);
    expect(parsed.skipped).toBe(1);
  });

  it("skips entities with neither route nor agency selectors, counting them", () => {
    const bare = { id: "x", alert: { informed_entity: [{ stop_id: "A33" }], header_text: { translation: [{ language: "en", text: "orphan" }] } } };
    const parsed = parseMtaAlerts(feedOf([bare]));
    expect(parsed.byRoute.size).toBe(0);
    expect(parsed.skipped).toBe(1);
  });

  it("throws typed ParseError on garbage", () => {
    expect(() => parseMtaAlerts("not json")).toThrow(ParseError);
    expect(() => parseMtaAlerts("{}")).toThrow(ParseError);
  });

  it("tracks the mercury-presence ratio for the health warning", () => {
    const noMercury = {
      id: "y",
      alert: {
        informed_entity: [{ route_id: "A" }],
        header_text: { translation: [{ language: "en", text: "plain" }] },
      },
    };
    const parsed = parseMtaAlerts(feedOf([noMercury, entity({ routes: ["C"] })]));
    expect(parsed.entitiesParsed).toBe(2);
    expect(parsed.entitiesWithMercury).toBe(1);
  });

  it("coerces string epochs in active periods and header", () => {
    const parsed = parseMtaAlerts(
      JSON.stringify({
        header: { timestamp: "1785731836" },
        entity: [entity({ routes: ["A"], periods: [{ start: 100, end: 200 }] })],
      }),
    );
    expect(parsed.timestamp).toBe(1785731836);
    expect(parsed.byRoute.get("A")![0].activePeriods).toEqual([{ start: 100, end: 200 }]);
  });
});

describe("isActiveNow", () => {
  const base: AlertItem = {
    severity: "info",
    text: "x",
    directionIds: [],
    stopIds: [],
    activePeriods: [],
    updatedAt: 0,
  };

  it("treats no periods as always active", () => {
    expect(isActiveNow(base, 1000)).toBe(true);
  });

  it("evaluates windows against now", () => {
    const item = { ...base, activePeriods: [{ start: 100, end: 200 }] };
    expect(isActiveNow(item, 150)).toBe(true);
    expect(isActiveNow(item, 50)).toBe(false); // before start
    expect(isActiveNow(item, 250)).toBe(false); // after end
  });

  it("treats an open-ended window as active after start", () => {
    const item = { ...base, activePeriods: [{ start: 100 }] };
    expect(isActiveNow(item, 999_999)).toBe(true);
    expect(isActiveNow(item, 50)).toBe(false);
  });

  it("is active when any of several windows covers now", () => {
    const item = { ...base, activePeriods: [{ start: 100, end: 200 }, { start: 300, end: 400 }] };
    expect(isActiveNow(item, 350)).toBe(true);
    expect(isActiveNow(item, 250)).toBe(false);
  });
});

describe("per-route selector scoping (review ADV-1)", () => {
  it("keeps each route's stop and direction selectors separate", () => {
    const body = JSON.stringify({
      header: { timestamp: 1785731836 },
      entity: [
        {
          id: "multi",
          alert: {
            informed_entity: [
              { route_id: "A", stop_id: "A41N" },
              { route_id: "D", stop_id: "D14S" },
            ],
            active_period: [],
            header_text: { translation: [{ language: "en", text: "two routes, two scopes" }] },
            [MERCURY]: { alert_type: "Delays", updated_at: 1 },
          },
        },
      ],
    });
    const parsed = parseMtaAlerts(body);
    const a = parsed.byRoute.get("A")![0];
    const d = parsed.byRoute.get("D")![0];
    expect(a.stopIds).toEqual(["A41N"]);
    expect(a.directionIds).toEqual([0]); // N suffix — A's selector only
    expect(d.stopIds).toEqual(["D14S"]);
    expect(d.directionIds).toEqual([1]); // S suffix — D's selector only
  });

  it("shares routeless selectors with every route", () => {
    const body = JSON.stringify({
      header: {},
      entity: [
        {
          id: "shared",
          alert: {
            informed_entity: [
              { route_id: "A" },
              { route_id: "C" },
              { stop_id: "A41S" }, // no route: shared pool
            ],
            header_text: { translation: [{ language: "en", text: "shared scope" }] },
          },
        },
      ],
    });
    const parsed = parseMtaAlerts(body);
    expect(parsed.byRoute.get("A")![0].stopIds).toEqual(["A41S"]);
    expect(parsed.byRoute.get("C")![0].stopIds).toEqual(["A41S"]);
  });

  it("drops out-of-range direction_id values from the untrusted body", () => {
    const parsed = parseMtaAlerts(
      feedOf([
        {
          id: "dirs",
          alert: {
            informed_entity: [
              { route_id: "A", direction_id: 2 },
              { route_id: "A", direction_id: -1 },
              { route_id: "A", direction_id: 1.5 },
              { route_id: "A", direction_id: 1 },
            ],
            header_text: { translation: [{ language: "en", text: "dirs" }] },
          },
        },
      ]),
    );
    expect(parsed.byRoute.get("A")![0].directionIds).toEqual([1]); // only the valid 0|1 survives
  });

  it("counts present-but-uncoercible active_period values and caps stored text", () => {
    const parsed = parseMtaAlerts(
      feedOf([
        {
          id: "drift",
          alert: {
            informed_entity: [{ route_id: "A" }],
            active_period: [{ start: "2026-08-03T00:00:00Z", end: "not-a-number" }],
            header_text: { translation: [{ language: "en", text: "x".repeat(1000) }] },
          },
        },
      ]),
    );
    expect(parsed.unparseablePeriodValues).toBe(1); // counted per period with any bad bound
    expect(parsed.byRoute.get("A")![0].text.length).toBe(400); // stored cap
    expect(parsed.byRoute.get("A")![0].activePeriods).toEqual([{}]); // degrades to always-active
  });
});
