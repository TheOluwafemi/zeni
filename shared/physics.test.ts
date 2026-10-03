import { describe, expect, test } from "vitest";
import { COIN_RADIUS, CUP_RADIUS, DEFAULT_PHYSICS, MAX_STEPS } from "./constants";
import { shotSpeed, simulateShot } from "./physics";
import { touchedBy } from "./rules";
import type { Coin, Cup } from "./types";

const coin = (id: number, x: number, y: number): Coin => ({ id, x, y, vx: 0, vy: 0 });
const table = (coins: Coin[], cups: Cup[] = []) => ({ coins, cups });

describe("simulateShot", () => {
  test("a lone coin slides about v²/2a and stops", () => {
    const power = 0.5;
    const v = shotSpeed(power);
    const expected = (v * v) / (2 * DEFAULT_PHYSICS.friction);
    const r = simulateShot(table([coin(0, 100, 500)]), { coinId: 0, angle: 0, power });
    expect(r.steps).toBeLessThan(MAX_STEPS);
    expect(r.coins[0].x - 100).toBeGreaterThan(expected * 0.97);
    expect(r.coins[0].x - 100).toBeLessThan(expected * 1.03);
    expect(r.coins[0].y).toBeCloseTo(500);
  });

  test("never mutates the input", () => {
    const t = table([coin(0, 200, 500), coin(1, 400, 500)], [{ x: 700, y: 500 }]);
    const copy = structuredClone(t);
    simulateShot(t, { coinId: 0, angle: 0, power: 1 });
    expect(t).toEqual(copy);
  });

  test("is deterministic", () => {
    const t = table([coin(0, 200, 500), coin(1, 400, 520), coin(2, 600, 480)], [{ x: 500, y: 300 }]);
    const shot = { coinId: 0, angle: 0.05, power: 0.9 };
    expect(simulateShot(t, shot)).toEqual(simulateShot(t, shot));
  });

  test("head-on hit passes most of the speed to the target", () => {
    const r = simulateShot(table([coin(0, 200, 500), coin(1, 400, 500)]), { coinId: 0, angle: 0, power: 0.6 });
    const [shooter, target] = r.coins;
    const contactX = 400 - COIN_RADIUS * 2;
    // After contact the target should travel far further than the shooter, which nearly stops.
    expect(target.x - 400).toBeGreaterThan(10 * (shooter.x - contactX));
    expect([...touchedBy(r.events, 0)]).toEqual([1]);
  });

  test("a coin that crosses the edge falls off and is reported", () => {
    const r = simulateShot(table([coin(0, 500, 500), coin(1, 500, 100)]), { coinId: 0, angle: 0, power: 1 });
    expect(r.fallen).toEqual([0]);
    expect(r.coins.map((c) => c.id)).toEqual([1]);
    expect(r.events.some((e) => e.type === "fall" && e.id === 0)).toBe(true);
    expect(r.steps).toBeLessThan(MAX_STEPS);
  });

  test("cups don't move and bounce coins back", () => {
    const cup = { x: 500, y: 500 };
    const t = table([coin(0, 200, 500)], [cup]);
    const r = simulateShot(t, { coinId: 0, angle: 0, power: 0.6 });
    expect(r.events.some((e) => e.type === "cup")).toBe(true);
    expect(r.coins[0].x).toBeLessThan(cup.x - CUP_RADIUS - COIN_RADIUS);
    expect(t.cups[0]).toEqual(cup);
    expect(touchedBy(r.events, 0).size).toBe(0);
  });

  test("coins don't end up overlapping after a crowded break", () => {
    const pack: Coin[] = [coin(0, 150, 500)];
    const gap = COIN_RADIUS * 2 + 2;
    for (let i = 0; i < 9; i++) pack.push(coin(i + 1, 450 + (i % 3) * gap, 430 + Math.floor(i / 3) * gap));
    const r = simulateShot(table(pack), { coinId: 0, angle: 0, power: 0.7 });
    for (let i = 0; i < r.coins.length; i++) {
      for (let j = i + 1; j < r.coins.length; j++) {
        const d = Math.hypot(r.coins[i].x - r.coins[j].x, r.coins[i].y - r.coins[j].y);
        expect(d).toBeGreaterThan(COIN_RADIUS * 2 - 1);
      }
    }
  });

  test("records one frame per step, with fallen coins frozen where they fell", () => {
    const r = simulateShot(table([coin(0, 700, 500), coin(1, 300, 300)]), { coinId: 0, angle: 0, power: 1 }, DEFAULT_PHYSICS, true);
    expect(r.frames).toHaveLength(r.steps);
    const last = r.frames!.at(-1)!;
    expect(last[0]).toBeGreaterThan(1000);
    expect(last[0]).toBeLessThan(1000 + 40);
    expect(last[2]).toBeCloseTo(300);
  });
});
