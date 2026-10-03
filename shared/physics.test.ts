import { describe, expect, test } from "vitest";
import { BOARD_SIZE, COIN_RADIUS, DEFAULT_PHYSICS, MAX_STEPS } from "./constants";
import { shotSpeed, simulateShot } from "./physics";
import { touchedBy } from "./rules";
import type { Coin } from "./types";

const coin = (id: number, x: number, y: number): Coin => ({ id, x, y, vx: 0, vy: 0 });

describe("simulateShot", () => {
  test("a lone coin slides about v²/2a and stops", () => {
    const power = 0.5;
    const v = shotSpeed(power);
    const expected = (v * v) / (2 * DEFAULT_PHYSICS.friction);
    const r = simulateShot([coin(0, 100, 500)], { coinId: 0, angle: 0, power });
    expect(r.steps).toBeLessThan(MAX_STEPS);
    expect(r.coins[0].x - 100).toBeGreaterThan(expected * 0.97);
    expect(r.coins[0].x - 100).toBeLessThan(expected * 1.03);
    expect(r.coins[0].y).toBeCloseTo(500);
  });

  test("never mutates the input", () => {
    const input = [coin(0, 200, 500), coin(1, 400, 500)];
    const copy = structuredClone(input);
    simulateShot(input, { coinId: 0, angle: 0, power: 1 });
    expect(input).toEqual(copy);
  });

  test("is deterministic", () => {
    const input = [coin(0, 200, 500), coin(1, 400, 520), coin(2, 600, 480)];
    const shot = { coinId: 0, angle: 0.05, power: 0.9 };
    expect(simulateShot(input, shot)).toEqual(simulateShot(input, shot));
  });

  test("head-on hit passes most of the speed to the target", () => {
    const r = simulateShot([coin(0, 200, 500), coin(1, 400, 500)], { coinId: 0, angle: 0, power: 0.6 });
    const [shooter, target] = r.coins;
    const contactX = 400 - COIN_RADIUS * 2;
    // After contact the target should travel far further than the shooter, which nearly stops.
    expect(target.x - 400).toBeGreaterThan(10 * (shooter.x - contactX));
    expect(shooter.y).toBeCloseTo(500);
    expect([...touchedBy(r.events, 0)]).toEqual([1]);
  });

  test("full power into a corner stays on the board and ends within the step cap", () => {
    const r = simulateShot([coin(0, 500, 500)], { coinId: 0, angle: Math.PI / 4, power: 1 });
    const c = r.coins[0];
    expect(r.steps).toBeLessThanOrEqual(MAX_STEPS);
    for (const v of [c.x, c.y]) {
      expect(v).toBeGreaterThanOrEqual(COIN_RADIUS);
      expect(v).toBeLessThanOrEqual(BOARD_SIZE - COIN_RADIUS);
    }
    expect(r.events.some((e) => e.type === "wall")).toBe(true);
  });

  test("coins don't end up overlapping after a crowded break", () => {
    const pack: Coin[] = [coin(0, 150, 500)];
    for (let i = 0; i < 9; i++) pack.push(coin(i + 1, 500 + (i % 3) * (COIN_RADIUS * 2 + 2), 440 + Math.floor(i / 3) * (COIN_RADIUS * 2 + 2)));
    const r = simulateShot(pack, { coinId: 0, angle: 0, power: 1 });
    for (let i = 0; i < r.coins.length; i++) {
      for (let j = i + 1; j < r.coins.length; j++) {
        const d = Math.hypot(r.coins[i].x - r.coins[j].x, r.coins[i].y - r.coins[j].y);
        expect(d).toBeGreaterThan(COIN_RADIUS * 2 - 1);
      }
    }
  });

  test("records one frame per step when asked", () => {
    const r = simulateShot([coin(0, 200, 500), coin(1, 400, 500)], { coinId: 0, angle: 0, power: 0.5 }, DEFAULT_PHYSICS, true);
    expect(r.frames).toHaveLength(r.steps);
    const last = r.frames!.at(-1)!;
    expect(last[2]).toBeCloseTo(r.coins[1].x, 3);
  });
});
