import { describe, expect, test } from "vitest";
import { COIN_COUNT, COIN_RADIUS, CUP_RADIUS, CUPS, MAX_SHOTS, TABLE_CENTER, TABLE_RADIUS } from "./constants";
import { simulateShot } from "./physics";
import { mulberry32 } from "./rng";
import { freeCoinIds, isFree, legalShot, newGame, resolveShot } from "./rules";
import type { Coin, Cup, GameState, Shot, ShotResult } from "./types";

const coin = (id: number, x: number, y: number): Coin => ({ id, x, y, vx: 0, vy: 0 });

function stateWith(coins: Coin[], extra: Partial<GameState> = {}, cups: Cup[] = []): GameState {
  return {
    seed: 1,
    difficulty: "easy",
    coins,
    cups,
    scores: [0, 0],
    turn: 0,
    shooter: null,
    shots: 0,
    status: "playing",
    winner: null,
    ...extra,
  };
}

function play(state: GameState, shot: Shot) {
  return resolveShot(state, shot, simulateShot(state, shot));
}

describe("newGame", () => {
  test.each(["easy", "hard"] as const)("%s: lays out coins and cups the same way for the same seed", (difficulty) => {
    const g = newGame(42, difficulty);
    expect(g.coins).toHaveLength(COIN_COUNT);
    expect(g.cups).toHaveLength(CUPS[difficulty]);
    expect(freeCoinIds(g.coins).size).toBe(COIN_COUNT);
    for (const c of g.coins) {
      expect(Math.hypot(c.x - TABLE_CENTER, c.y - TABLE_CENTER)).toBeLessThan(TABLE_RADIUS - COIN_RADIUS * 2);
      for (const cup of g.cups) {
        expect(Math.hypot(c.x - cup.x, c.y - cup.y)).toBeGreaterThan(CUP_RADIUS + COIN_RADIUS);
      }
    }
    expect(newGame(42, difficulty)).toEqual(g);
    expect(newGame(43, difficulty)).not.toEqual(g);
  });

  test("can choose who goes first without changing the layout", () => {
    const a = newGame(7, "easy", 0);
    const b = newGame(7, "easy", 1);
    expect([a.turn, b.turn]).toEqual([0, 1]);
    expect(a.coins).toEqual(b.coins);
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

  test("touching exactly one coin keeps it and keeps the turn", () => {
    const { state, outcome } = play(stateWith(spread), { coinId: 0, angle: 0, power: 0.5 });
    expect(outcome).toEqual({ captured: 1, touched: 1, fallen: [], again: true, blocked: false });
    expect(state.coins.map((c) => c.id)).not.toContain(1);
    expect(state.scores).toEqual([1, 0]);
    expect(state.turn).toBe(0);
    expect(state.shots).toBe(1);
  });

  test("after a capture you must shoot the same coin; a new turn frees the choice", () => {
    const first = play(stateWith(spread), { coinId: 0, angle: 0, power: 0.5 });
    expect(first.state.shooter).toBe(0);
    expect(legalShot(first.state, 0, { coinId: 2, angle: 0, power: 0.5 })).toBe(false);
    expect(legalShot(first.state, 0, { coinId: 0, angle: Math.PI / 2, power: 0.3 })).toBe(true);

    const miss = play(first.state, { coinId: 0, angle: Math.PI / 2, power: 0.3 });
    expect(miss.state.turn).toBe(1);
    expect(miss.state.shooter).toBeNull();
    expect(legalShot(miss.state, 1, { coinId: 2, angle: 0, power: 0.5 })).toBe(true);
  });

  test("if your coin stops touching another after a capture, the turn passes", () => {
    const coins = [coin(0, 200, 500), coin(1, 400, 500), coin(2, 330, 640), coin(3, 800, 150)];
    // Hand-made result: the shooter hit coin 1 and came to rest touching coin 2.
    const result: ShotResult = {
      coins: [coin(0, 330, 500), coin(1, 600, 500), coin(2, 330, 500 + COIN_RADIUS * 2), coin(3, 800, 150)],
      fallen: [],
      events: [{ type: "hit", step: 10, a: 0, b: 1, impulse: 500 }],
      steps: 60,
    };
    const { state, outcome } = resolveShot(stateWith(coins), { coinId: 0, angle: 0, power: 0.5 }, result);
    expect(outcome).toEqual({ captured: 1, touched: 1, fallen: [], again: false, blocked: true });
    expect(state.turn).toBe(1);
    expect(state.shooter).toBeNull();
    expect(state.scores).toEqual([1, 0]);
  });

  test("touching nothing passes the turn", () => {
    const { state, outcome } = play(stateWith(spread), { coinId: 0, angle: Math.PI / 2, power: 0.3 });
    expect(outcome).toEqual({ captured: null, touched: 0, fallen: [], again: false, blocked: false });
    expect(state.turn).toBe(1);
    expect(state.coins).toHaveLength(4);
  });

  test("touching two coins passes the turn and keeps nothing", () => {
    // Two targets side by side; aim between them so the shooter hits both.
    const gap = COIN_RADIUS + 2;
    const coins = [coin(0, 200, 500), coin(1, 400, 500 - gap), coin(2, 400, 500 + gap), coin(3, 800, 150)];
    const { state, outcome } = play(stateWith(coins), { coinId: 0, angle: 0, power: 0.6 });
    expect(outcome.touched).toBe(2);
    expect(outcome.captured).toBeNull();
    expect(state.turn).toBe(1);
    expect(state.scores).toEqual([0, 0]);
  });

  test("a bank shot off a cup into one coin keeps it", () => {
    // Shoot right into the cup; the rebound carries the shooter back into coin 1.
    const coins = [coin(0, 300, 500), coin(1, 224, 500), coin(2, 800, 850)];
    const cups = [{ x: 500, y: 500 }];
    const shot = { coinId: 0, angle: 0, power: 0.8 };
    const result = simulateShot({ coins, cups }, shot);
    expect(result.events.some((e) => e.type === "cup")).toBe(true);
    const { outcome } = resolveShot(stateWith(coins, {}, cups), shot, result);
    expect(outcome).toEqual({ captured: 1, touched: 1, fallen: [], again: true, blocked: false });
  });

  test("if the coin you hit falls off, your opponent gets it and the turn", () => {
    const coins = [coin(0, 700, 500), coin(1, 850, 500), coin(2, 200, 200), coin(3, 200, 800)];
    const { state, outcome } = play(stateWith(coins), { coinId: 0, angle: 0, power: 0.8 });
    expect(outcome).toEqual({ captured: null, touched: 1, fallen: [1], again: false, blocked: false });
    expect(state.scores).toEqual([0, 1]);
    expect(state.turn).toBe(1);
  });

  test("if your own coin falls off, your opponent gets it and the turn", () => {
    const coins = [coin(0, 800, 500), coin(1, 200, 200), coin(2, 200, 800)];
    const { state, outcome } = play(stateWith(coins), { coinId: 0, angle: 0, power: 0.6 });
    expect(outcome).toEqual({ captured: null, touched: 0, fallen: [0], again: false, blocked: false });
    expect(state.scores).toEqual([0, 1]);
    expect(state.turn).toBe(1);
  });

  test("keeping a coin while another is knocked off scores both ways and passes the turn", () => {
    const coins = [coin(0, 300, 500), coin(1, 500, 500), coin(2, 880, 500), coin(3, 200, 150)];
    const { state, outcome } = play(stateWith(coins), { coinId: 0, angle: 0, power: 1 });
    expect(outcome).toEqual({ captured: 1, touched: 1, fallen: [2], again: false, blocked: false });
    expect(state.scores).toEqual([1, 1]);
    expect(state.turn).toBe(1);
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
  test.each(["easy", "hard"] as const)("%s: random play always reaches a result and every coin is accounted for", (difficulty) => {
    for (let seed = 1; seed <= 30; seed++) {
      const rng = mulberry32(seed * 7919);
      let state = newGame(seed, difficulty);
      while (state.status === "playing") {
        const free = [...freeCoinIds(state.coins)];
        const shot: Shot = {
          coinId: state.shooter ?? free[Math.floor(rng() * free.length)],
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
