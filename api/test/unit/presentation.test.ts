import { describe, expect, it } from "vitest";

import {
  FALLBACK_PALETTE,
  bulletShape,
  normalizeColor,
  paletteColor,
  textColorFor,
} from "../../src/presentation";

describe("bulletShape", () => {
  it("gives short rail names a circle, long names a pill, no name a disc", () => {
    expect(bulletShape("A")).toBe("circle");
    expect(bulletShape("GS")).toBe("circle");
    expect(bulletShape("M15-SBS")).toBe("pill");
    expect(bulletShape("SIR")).toBe("pill");
    expect(bulletShape("")).toBe("disc");
    expect(bulletShape(null)).toBe("disc");
    expect(bulletShape(undefined)).toBe("disc");
  });
});

describe("paletteColor", () => {
  it("is deterministic and stays inside the design's 8-color palette", () => {
    const first = paletteColor("Q70");
    expect(paletteColor("Q70")).toBe(first);
    expect(FALLBACK_PALETTE).toContain(first);
  });

  it("spreads distinct route ids across more than one palette slot", () => {
    const picks = new Set(
      ["B41", "B45", "B57", "B62", "B67", "Q70", "M15", "X27"].map(paletteColor),
    );
    expect(picks.size).toBeGreaterThan(1);
  });
});

describe("normalizeColor", () => {
  it("normalizes GTFS color fields to #RRGGBB", () => {
    expect(normalizeColor("EE352E")).toBe("#EE352E");
    expect(normalizeColor("#ee352e")).toBe("#EE352E");
  });

  it("rejects garbage and empties", () => {
    expect(normalizeColor("")).toBeNull();
    expect(normalizeColor(null)).toBeNull();
    expect(normalizeColor("EE352")).toBeNull();
    expect(normalizeColor("not-hex")).toBeNull();
  });
});

describe("textColorFor", () => {
  it("honors the feed's declared text color", () => {
    expect(textColorFor("#EE352E", "FFFFFF")).toBe("#FFFFFF");
  });

  it("falls back to black on light backgrounds and white on dark", () => {
    expect(textColorFor("#FCCC0A", null)).toBe("#000000"); // NQRW yellow
    expect(textColorFor("#0039A6", null)).toBe("#FFFFFF"); // ACE blue
    expect(textColorFor("#EE352E", null)).toBe("#FFFFFF"); // 123 red
  });
});
