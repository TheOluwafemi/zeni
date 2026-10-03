import { describe, expect, test } from "vitest";
import { allowedGap, ANYONE_AFTER_MS, BASE_GAP, nextRetry, pickPairs, type Waiting } from "./matchmaking";

const w = (id: string, rating: number, since = 0): Waiting => ({ id, rating, since });
const ids = (pairs: [Waiting, Waiting][]) => pairs.map(([a, b]) => [a.id, b.id].sort().join("+")).sort();

describe("allowedGap", () => {
  test("starts narrow, widens with waiting, then disappears", () => {
    expect(allowedGap(0)).toBe(BASE_GAP);
    expect(allowedGap(10_000)).toBeGreaterThan(allowedGap(5000));
    expect(allowedGap(ANYONE_AFTER_MS - 1)).toBeLessThan(Infinity);
    expect(allowedGap(ANYONE_AFTER_MS)).toBe(Infinity);
  });
});

describe("pickPairs", () => {
  test("pairs two players who are close in rating straight away", () => {
    expect(ids(pickPairs([w("a", 1000), w("b", 1080)], 0))).toEqual(["a+b"]);
  });

  test("does not pair strangers far apart, until one has waited long enough", () => {
    const queue = [w("novice", 1000, 0), w("legend", 1800, 0)];
    expect(pickPairs(queue, 0)).toEqual([]);
    expect(pickPairs(queue, 10_000)).toEqual([]);
    expect(ids(pickPairs(queue, ANYONE_AFTER_MS))).toEqual(["legend+novice"]);
  });

  test("picks the closest rating, not the first in line", () => {
    const queue = [w("a", 1200, 0), w("far", 1100, 5), w("near", 1190, 9)];
    expect(ids(pickPairs(queue, 10))).toEqual(["a+near"]);
  });

  test("serves whoever has waited longest first, even if two others are closer to each other", () => {
    // y and z are only 10 apart, but x has waited longest, so x gets served (and takes the closer of y and z).
    const queue = [w("z", 1040, 20), w("x", 1000, 0), w("y", 1050, 10)];
    expect(ids(pickPairs(queue, 100))).toEqual(["x+z"]);
  });

  test("a player is in at most one pair, and an odd one out waits", () => {
    const queue = [w("a", 1000), w("b", 1010), w("c", 1020), w("d", 1030), w("e", 1040)];
    const pairs = pickPairs(queue, 0);
    const seen = pairs.flat().map((p) => p.id);
    expect(pairs).toHaveLength(2);
    expect(new Set(seen).size).toBe(4);
  });

  test("a lone player, or an empty queue, makes no pairs", () => {
    expect(pickPairs([], 0)).toEqual([]);
    expect(pickPairs([w("a", 1000)], 0)).toEqual([]);
  });

  test("is deterministic when ratings and wait times tie", () => {
    const queue = [w("b", 1000), w("a", 1000), w("c", 1000), w("d", 1000)];
    expect(ids(pickPairs(queue, 0))).toEqual(ids(pickPairs([...queue].reverse(), 0)));
  });
});

describe("nextRetry", () => {
  test("only needs to look again while two or more are waiting", () => {
    expect(nextRetry([], 0)).toBeNull();
    expect(nextRetry([w("a", 1000)], 0)).toBeNull();
    expect(nextRetry([w("a", 1000), w("b", 2000)], 5000)).toBeGreaterThan(5000);
  });
});
