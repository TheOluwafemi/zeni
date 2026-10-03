import { describe, expect, test } from "vitest";
import { BOARD_SIZE, COIN_COUNT, COIN_RADIUS, MAX_SHOTS } from "./constants";
import { simulateShot } from "./physics";
import { mulberry32 } from "./rng";
import { freeCoinIds, isFree, legalShot, newGame, resolveShot } from "./rules";
import type { Coin, GameState, Shot } from "./types";

const coin = (id: number, x: number, y: number): Coin => ({ id, x, y, vx: 0, vy: 0 });

function stateWith(coins: Coin[], extra: Partial<GameState> = {}): GameState {
  return { seed: 1, coins, scores: [0, 0], turn: 0, shots: 0, status: "playing", winner: null, ...extra };
}

function play(state: GameState, shot: Shot) {
  return resolveShot(state, shot, simulateShot(state.coins, shot));
}

describe("newGame", () => {
  test("places every coin on the board, free, and the same way for the same seed", () => {
    const g = newGame(42);
    expect(g.coins).toHaveLength(COIN_COUNT);
    expect(freeCoinIds(g.coins).size).toBe(COIN_COUNT);
    for (const c of g.coins) {
      expect(c.x).toBeGreaterThan(COIN_RADIUS);
      expect(c.x).toBeLessThan(BOARD_SIZE - COIN_RADIUS);
    }
    expect(newGame(42)).toEqual(g);
    expect(newGame(43)).not.toEqual(g);
  });
});

describe("isFree / legalShot", () => {
  const coins = [coin(0, 200, 200), coin(1, 200 + COIN_RADIUS * 2 + 1, 200), coin(2, 600, 600)];
  const state = stateWith(coins);

  test("touching coins are not free", () => {
    expect(isFree(coins, coins[0])).toBe(false);
    expect(isFree(coins, coins[2])).toBe(true);
  });

  test("rejects wrong turn, non-free coin, bad power and bad angle", () => {
    const ok: Shot = { coinId: 2, angle: 0, power: 0.5 };
    expect(legalShot(state, 0, ok)).toBe(true);
    expect(legalShot(state, 1, ok)).toBe(false);
    expect(legalShot(state, 0, { ...ok, coinId: 0 })).toBe(false);
    expect(legalShot(state, 0, { ...ok, coinId: 99 })).toBe(false);
    expect(legalShot(state, 0, { ...ok, power: 0.01 })).toBe(false);
    expect(legalShot(state, 0, { ...ok, power: 1.5 })).toBe(false);
    expect(legalShot(state, 0, { ...ok, angle: NaN })).toBe(false);
  });
});

describe("resolveShot", () => {
  const spread = [coin(0, 200, 500), coin(1, 400, 500), coin(2, 800, 150), coin(3, 150, 850)];

  test("touching exactly one coin captures it and keeps the turn", () => {
    const { state, outcome } = play(stateWith(spread), { coinId: 0, angle: 0, power: 0.5 });
    expect(outcome).toEqual({ kind: "capture", target: 1 });
    expect(state.coins.map((c) => c.id)).not.toContain(1);
    expect(state.scores).toEqual([1, 0]);
    expect(state.turn).toBe(0);
    expect(state.shots).toBe(1);
  });

  test("touching nothing passes the turn", () => {
    const { state, outcome } = play(stateWith(spread), { coinId: 0, angle: Math.PI / 2, power: 0.3 });
    expect(outcome).toEqual({ kind: "miss", touched: 0 });
    expect(state.turn).toBe(1);
    expect(state.coins).toHaveLength(4);
  });

  test("touching two coins passes the turn and captures nothing", () => {
    // Two targets side by side; aim between them so the shooter hits both.
    const gap = COIN_RADIUS + 2;
    const coins = [coin(0, 200, 500), coin(1, 400, 500 - gap), coin(2, 400, 500 + gap), coin(3, 800, 150)];
    const { state, outcome } = play(stateWith(coins), { coinId: 0, angle: 0, power: 0.6 });
    expect(outcome).toEqual({ kind: "miss", touched: 2 });
    expect(state.turn).toBe(1);
    expect(state.scores).toEqual([0, 0]);
  });

  test("the game ends when one coin is left", () => {
    const { state } = play(stateWith([coin(0, 200, 500), coin(1, 400, 500)], { scores: [4, 4] }), {
      coinId: 0,
      angle: 0,
      power: 0.5,
    });
    expect(state.status).toBe("over");
    expect(state.winner).toBe(0);
    expect(state.scores).toEqual([5, 4]);
  });

  test("the game ends at the shot limit, and equal scores draw", () => {
    const { state } = play(stateWith(spread, { shots: MAX_SHOTS - 1, scores: [2, 2] }), {
      coinId: 0,
      angle: Math.PI / 2,
      power: 0.3,
    });
    expect(state.status).toBe("over");
    expect(state.winner).toBe("draw");
  });
});

describe("full games", () => {
  test("random play always reaches a result within the shot limit", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const rng = mulberry32(seed * 7919);
      let state = newGame(seed);
      while (state.status === "playing") {
        const free = [...freeCoinIds(state.coins)];
        const shot: Shot = {
          coinId: free[Math.floor(rng() * free.length)],
          angle: rng() * Math.PI * 2,
          power: 0.1 + rng() * 0.9,
        };
        expect(legalShot(state, state.turn, shot)).toBe(true);
        state = play(state, shot).state;
      }
      expect(state.shots).toBeLessThanOrEqual(MAX_SHOTS);
      expect(state.scores[0] + state.scores[1] + state.coins.length).toBe(COIN_COUNT);
      expect(state.winner).not.toBeNull();
    }
  });
});
