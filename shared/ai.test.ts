import { describe, expect, test } from "vitest";
import { AI_LEVELS, chooseShot } from "./ai";
import { simulateShot } from "./physics";
import { mulberry32 } from "./rng";
import { legalShot, newGame, resolveShot } from "./rules";
import type { Coin, GameState } from "./types";

const coin = (id: number, x: number, y: number): Coin => ({ id, x, y, vx: 0, vy: 0 });

describe("chooseShot", () => {
  test.each(AI_LEVELS)("%s always returns a legal shot", (level) => {
    for (const difficulty of ["easy", "hard"] as const) {
      for (let seed = 1; seed <= 5; seed++) {
        const state = newGame(seed, difficulty);
        const shot = chooseShot(state, level, mulberry32(seed));
        expect(legalShot(state, state.turn, shot)).toBe(true);
      }
    }
  });

  test("during a run it only shoots the required coin", () => {
    const state: GameState = { ...newGame(3), shooter: 4 };
    for (const level of AI_LEVELS) expect(chooseShot(state, level, mulberry32(1)).coinId).toBe(4);
  });

  test("master takes an easy capture that doesn't risk a fall", () => {
    // Coin 0 sits right next to coin 1 in the middle; everything else is far away.
    const state: GameState = {
      ...newGame(1),
      coins: [coin(0, 420, 500), coin(1, 540, 500), coin(2, 250, 250), coin(3, 750, 750)],
      cups: [],
      turn: 0,
      shooter: null,
    };
    let kept = 0;
    for (let i = 0; i < 10; i++) {
      const shot = chooseShot(state, "master", mulberry32(i + 1));
      const { outcome } = resolveShot(state, shot, simulateShot(state, shot));
      if (outcome.captured !== null && outcome.fallen.length === 0) kept++;
    }
    expect(kept).toBeGreaterThanOrEqual(8);
  });
});
