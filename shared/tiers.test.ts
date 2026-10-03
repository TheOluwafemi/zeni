import { describe, expect, test } from "vitest";
import { nextTier, progressToNext, tierChange, tierFor, TIERS } from "./tiers";

describe("tierFor", () => {
  test("everyone starts as an Amateur", () => {
    expect(tierFor(1000).name).toBe("Amateur");
    expect(tierFor(0).name).toBe("Amateur");
  });

  test("a tier begins exactly at its threshold", () => {
    for (const t of TIERS) {
      expect(tierFor(t.min).id).toBe(t.id);
      if (t.min > 0) expect(tierFor(t.min - 1).id).not.toBe(t.id);
    }
  });

  test("Legend has no ceiling", () => {
    expect(tierFor(1700).name).toBe("Legend");
    expect(tierFor(9999).name).toBe("Legend");
    expect(nextTier(2500)).toBeNull();
  });

  test("thresholds only go up", () => {
    for (let i = 1; i < TIERS.length; i++) expect(TIERS[i].min).toBeGreaterThan(TIERS[i - 1].min);
  });
});

describe("progressToNext", () => {
  test("measures the climb from where the tier starts", () => {
    expect(progressToNext(1100)).toBe(0); // just reached Apprentice
    expect(progressToNext(1175)).toBeCloseTo(0.5); // halfway to Adept at 1250
    expect(progressToNext(1249)).toBeLessThan(1);
  });

  test("Amateurs climb from the 1000 everyone starts on, not from zero", () => {
    expect(progressToNext(1000)).toBe(0);
    expect(progressToNext(1050)).toBeCloseTo(0.5);
    expect(progressToNext(900)).toBe(0); // below the start line, still no progress
  });

  test("Legend is always full", () => {
    expect(progressToNext(1700)).toBe(1);
    expect(progressToNext(2100)).toBe(1);
  });
});

describe("tierChange", () => {
  test("spots promotions and demotions across a boundary", () => {
    expect(tierChange(1095, 1105)).toBe("up");
    expect(tierChange(1105, 1095)).toBe("down");
    expect(tierChange(1100, 1120)).toBe("same");
    expect(tierChange(1000, 984)).toBe("same");
  });
});
