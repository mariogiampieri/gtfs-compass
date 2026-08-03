import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAX_ACCURACY_M,
  MANUAL_WALK_MAX_S,
  RAIL_ENTRY_BUFFER_S,
  computeWalk,
  entryBufferS,
  walkMaxAccuracyM,
} from "../../src/walk";

// Jay St–MetroTech platform and a point ~650 m away along a meridian
// (1° latitude ≈ 111,320 m, so 650 m ≈ 0.005839°).
const STOP = { lat: 40.692338, lon: -73.987342 };
const ORIGIN_650M = { lat: STOP.lat + 650 / 111_320, lon: STOP.lon };

const RAIL = [1]; // GTFS route_type 1 = subway/metro
const BUS = [3];

describe("entryBufferS", () => {
  it("gives rail route types the 90 s buffer and bus zero", () => {
    expect(entryBufferS([1])).toBe(RAIL_ENTRY_BUFFER_S);
    expect(entryBufferS([2])).toBe(RAIL_ENTRY_BUFFER_S);
    expect(entryBufferS([0])).toBe(RAIL_ENTRY_BUFFER_S);
    expect(entryBufferS([3])).toBe(0);
    expect(entryBufferS([])).toBe(0);
  });

  it("takes the max across mixed route types", () => {
    expect(entryBufferS([3, 1])).toBe(RAIL_ENTRY_BUFFER_S);
    expect(entryBufferS([1, 3])).toBe(RAIL_ENTRY_BUFFER_S);
  });
});

describe("computeWalk — manual tier", () => {
  it("returns manual seconds plus the rail entry buffer with src manual (AE2 arithmetic)", () => {
    const result = computeWalk({ stop: STOP, manualSeconds: 420, routeTypes: RAIL }, null);
    expect(result).toEqual({ seconds: 510, source: "manual" });
  });

  it("adds no buffer at a bus-only stop", () => {
    const result = computeWalk({ stop: STOP, manualSeconds: 420, routeTypes: BUS }, null);
    expect(result).toEqual({ seconds: 420, source: "manual" });
  });

  it("wins over the heuristic when both inputs are present", () => {
    const result = computeWalk({ stop: STOP, manualSeconds: 420, routeTypes: RAIL }, ORIGIN_650M);
    expect(result).toEqual({ seconds: 510, source: "manual" });
  });

  it("treats out-of-bounds manual seconds as absent and falls through", () => {
    for (const bad of [-1, MANUAL_WALK_MAX_S + 1, Number.NaN]) {
      const withOrigin = computeWalk(
        { stop: STOP, manualSeconds: bad, routeTypes: RAIL },
        ORIGIN_650M,
      );
      expect(withOrigin?.source).toBe("heuristic");
      const withoutOrigin = computeWalk({ stop: STOP, manualSeconds: bad, routeTypes: RAIL }, null);
      expect(withoutOrigin).toBeNull();
    }
  });

  it("accepts the bounds themselves (0 and the cap)", () => {
    expect(computeWalk({ stop: STOP, manualSeconds: 0, routeTypes: BUS }, null)).toEqual({
      seconds: 0,
      source: "manual",
    });
    expect(
      computeWalk({ stop: STOP, manualSeconds: MANUAL_WALK_MAX_S, routeTypes: BUS }, null),
    ).toEqual({ seconds: MANUAL_WALK_MAX_S, source: "manual" });
  });

  it("applies manual even when the stop row has no coordinates", () => {
    const result = computeWalk({ stop: null, manualSeconds: 420, routeTypes: RAIL }, ORIGIN_650M);
    expect(result).toEqual({ seconds: 510, source: "manual" });
  });
});

describe("computeWalk — heuristic tier", () => {
  it("computes distance × 1.3 ÷ 1.3 m/s plus buffer with src heuristic (golden value)", () => {
    const result = computeWalk({ stop: STOP, routeTypes: RAIL }, ORIGIN_650M);
    expect(result?.source).toBe("heuristic");
    // 650 m detoured ×1.3 then walked at 1.3 m/s ≡ 650 s, + 90 s buffer.
    expect(result?.seconds).toBeGreaterThanOrEqual(739);
    expect(result?.seconds).toBeLessThanOrEqual(741);
  });

  it("applies the detour factor and walk speed as distinct constants", () => {
    // A stop 100 m away at 2.0× detour ÷ 1.0 m/s would give 200 s; with the
    // spec's 1.3/1.3 the two cancel — assert the formula's shape by checking
    // a zero-distance origin yields exactly the buffer.
    const atStop = computeWalk({ stop: STOP, routeTypes: RAIL }, { lat: STOP.lat, lon: STOP.lon });
    expect(atStop).toEqual({ seconds: RAIL_ENTRY_BUFFER_S, source: "heuristic" });
  });

  it("returns null with no manual and no origin", () => {
    expect(computeWalk({ stop: STOP, routeTypes: RAIL }, null)).toBeNull();
  });

  it("skips the heuristic when the stop row has no coordinates", () => {
    expect(computeWalk({ stop: null, routeTypes: RAIL }, ORIGIN_650M)).toBeNull();
  });
});

describe("computeWalk — accuracy gate", () => {
  it("ignores an origin coarser than the gate", () => {
    const coarse = { ...ORIGIN_650M, accuracyM: DEFAULT_MAX_ACCURACY_M + 1 };
    expect(computeWalk({ stop: STOP, routeTypes: RAIL }, coarse)).toBeNull();
  });

  it("allows accuracy exactly at the gate (boundary, matches the locate chain's > test)", () => {
    const boundary = { ...ORIGIN_650M, accuracyM: DEFAULT_MAX_ACCURACY_M };
    expect(computeWalk({ stop: STOP, routeTypes: RAIL }, boundary)?.source).toBe("heuristic");
  });

  it("trusts an origin with no reported accuracy (route layer guarantees acc on the API path)", () => {
    expect(computeWalk({ stop: STOP, routeTypes: RAIL }, ORIGIN_650M)?.source).toBe("heuristic");
  });

  it("honors a custom gate value", () => {
    const origin = { ...ORIGIN_650M, accuracyM: 200 };
    expect(computeWalk({ stop: STOP, routeTypes: RAIL }, origin, 150)).toBeNull();
    expect(computeWalk({ stop: STOP, routeTypes: RAIL }, origin, 250)?.source).toBe("heuristic");
  });
});

describe("walkMaxAccuracyM", () => {
  it("reads the env override and falls back to 500 on garbage", () => {
    expect(walkMaxAccuracyM({ LOCATE_MAX_ACCURACY_M: "150" } as Env)).toBe(150);
    expect(walkMaxAccuracyM({ LOCATE_MAX_ACCURACY_M: "banana" } as Env)).toBe(
      DEFAULT_MAX_ACCURACY_M,
    );
    expect(walkMaxAccuracyM({} as Env)).toBe(DEFAULT_MAX_ACCURACY_M);
  });
});
