// Phone and server must agree on every shot. These replay fixed games through the physics and pin
// the results, so any change to how coins move fails here first and is updated on purpose
// (`npx vitest run shared/determinism.test.ts -u`), never by accident.

import { describe, expect, test } from "vitest";
import { DEFAULT_PHYSICS } from "./constants";
import { simulateShot } from "./physics";
import { mulberry32 } from "./rng";
import { freeCoinIds, newGame, resolveShot } from "./rules";
import type { GameState, Shot } from "./types";

/** A short fingerprint of a game state: where every coin is, the scores and whose turn it is. */
function fingerprint(state: GameState): string {
  let h = 0x811c9dc5;
  const mix = (n: number) => {
    const s = n.toFixed(6);
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  };
  for (const c of state.coins) {
    mix(c.id);
    mix(c.x);
    mix(c.y);
  }
  mix(state.scores[0]);
  mix(state.scores[1]);
  mix(state.turn);
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Play a whole game with shots chosen from a seeded random sequence. */
function replay(seed: number, difficulty: "easy" | "hard", frames = false): string[] {
  let state = newGame(seed, difficulty);
  const rng = mulberry32(seed * 7 + 1);
  const prints: string[] = [];
  while (state.status === "playing" && prints.length < 40) {
    const free = [...freeCoinIds(state.coins)];
    const shot: Shot = {
      coinId: state.shooter ?? free[Math.floor(rng() * free.length)] ?? state.coins[0].id,
      angle: rng() * Math.PI * 2,
      power: 0.15 + rng() * 0.85,
    };
    const result = simulateShot(state, shot, DEFAULT_PHYSICS, frames);
    state = resolveShot(state, shot, result).state;
    prints.push(fingerprint(state));
  }
  return prints;
}

describe("the same shots always give the same game", () => {
  test("on the easy table", () => {
    expect(replay(11, "easy").slice(-1)[0]).toMatchInlineSnapshot(`"5a61394c"`);
  });

  test("on the hard table", () => {
    expect(replay(42, "hard").slice(-1)[0]).toMatchInlineSnapshot(`"e2fc447b"`);
  });

  test("recording frames for the screen doesn't change the result", () => {
    expect(replay(7, "hard", true)).toEqual(replay(7, "hard", false));
  });
});

describe("how coins move", () => {
  const two = (bx: number, by: number) => ({
    coins: [
      { id: 0, x: 300, y: 500, vx: 0, vy: 0 },
      { id: 1, x: bx, y: by, vx: 0, vy: 0 },
    ],
    cups: [],
  });

  test("a glancing hit throws the struck coin a little along the striker's path, and spins both", () => {
    const table = two(420, 540); // struck off-centre, below the line of the shot
    const grip = simulateShot(table, { coinId: 0, angle: 0, power: 0.6 }, DEFAULT_PHYSICS, true);
    const slick = simulateShot(table, { coinId: 0, angle: 0, power: 0.6 }, { ...DEFAULT_PHYSICS, contactFriction: 0 }, true);
    const dir = (r: typeof grip) => {
      const b = r.coins.find((c) => c.id === 1)!;
      return Math.atan2(b.y - 540, b.x - 420);
    };
    // Without grip it leaves along the line of centres; with grip it's dragged toward the shot direction (0).
    expect(Math.abs(dir(grip))).toBeLessThan(Math.abs(dir(slick)));
    const lastTurns = grip.turns![grip.turns!.length - 1];
    expect(Math.abs(lastTurns[0])).toBeGreaterThan(0.05);
    expect(Math.abs(lastTurns[1])).toBeGreaterThan(0.05);
  });

  test("a head-on hit doesn't spin anything", () => {
    const r = simulateShot(two(420, 500), { coinId: 0, angle: 0, power: 0.6 }, DEFAULT_PHYSICS, true);
    const last = r.turns![r.turns!.length - 1];
    expect(Math.abs(last[0]) + Math.abs(last[1])).toBeLessThan(1e-6);
  });

  test("a gentle tap is softer than the coins' full bounce", () => {
    const hit = (soft: number) => {
      const r = simulateShot(two(380, 500), { coinId: 0, angle: 0, power: 0.12 }, { ...DEFAULT_PHYSICS, softSpeed: soft });
      return r.coins.find((c) => c.id === 1)!.x;
    };
    expect(hit(DEFAULT_PHYSICS.softSpeed)).toBeLessThan(hit(0));
  });

  test("a glancing bounce off a cup sets the coin spinning", () => {
    const r = simulateShot(
      { coins: [{ id: 0, x: 300, y: 500, vx: 0, vy: 0 }], cups: [{ x: 450, y: 560 }] },
      { coinId: 0, angle: 0, power: 0.6 },
      DEFAULT_PHYSICS,
      true,
    );
    expect(r.events.some((e) => e.type === "cup")).toBe(true);
    expect(Math.abs(r.turns![r.turns!.length - 1][0])).toBeGreaterThan(0.05);
  });
});
