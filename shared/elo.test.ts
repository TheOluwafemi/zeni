import { describe, expect, test } from "vitest";
import { eloChange } from "./elo";

describe("eloChange", () => {
  test("equal players: the winner gains half of K", () => {
    expect(eloChange(1000, 1000, 1)).toBe(16);
    expect(eloChange(1000, 1000, 0)).toBe(-16);
    expect(eloChange(1000, 1000, 0.5)).toBe(0);
  });

  test("beating a stronger player pays more than beating a weaker one", () => {
    expect(eloChange(1000, 1400, 1)).toBeGreaterThan(eloChange(1000, 1000, 1));
    expect(eloChange(1400, 1000, 1)).toBeLessThan(eloChange(1000, 1000, 1));
  });

  test("a draw moves points toward the lower-rated player", () => {
    expect(eloChange(1000, 1400, 0.5)).toBeGreaterThan(0);
    expect(eloChange(1400, 1000, 0.5)).toBeLessThan(0);
  });

  test("never moves more than K", () => {
    for (const [a, b] of [[1000, 3000], [3000, 1000], [0, 0]]) {
      for (const r of [1, 0.5, 0] as const) expect(Math.abs(eloChange(a, b, r))).toBeLessThanOrEqual(32);
    }
  });
});
