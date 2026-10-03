// Computer opponent. Pure and deterministic for a given rng, so it runs the same
// in a browser Worker, in tests and in the simulator.
//
// It tries a few hundred real shots on a copy of the table (every legal coin, aimed at
// each target with several cut angles and powers), scores what actually happens, then
// fires the best one with human-like aim error. Stronger levels also check that a shot
// still works when their own aim is a little off, and avoid leaving easy shots behind.

import { COIN_RADIUS, CUP_RADIUS, DEFAULT_PHYSICS, MIN_POWER, type PhysicsConfig } from "./constants";
import { simulateShot } from "./physics";
import { isFree, other, resolveShot } from "./rules";
import type { Coin, Cup, GameState, Seat, Shot } from "./types";

export type AiLevel = "beginner" | "skilled" | "master";
export const AI_LEVELS: AiLevel[] = ["beginner", "skilled", "master"];

interface LevelSpec {
  /** Aim error when the shot is actually fired (radians, 1 SD). */
  aimNoise: number;
  /** Power error when fired (fraction, 1 SD). */
  powerNoise: number;
  /** Pick at random among this many of the best shots. 1 = always the best. */
  pickFrom: number;
  /** Re-check this many of the best shots under the level's own aim error... */
  robustTop: number;
  /** ...using this many noisy samples each. */
  robustSamples: number;
  /** How much to avoid leaving easy shots for the opponent (0 = not at all). */
  defend: number;
}

const LEVELS: Record<AiLevel, LevelSpec> = {
  // Tuned against real play: earlier Master kept ~3 coins a turn and felt unbeatable.
  // Targets: about 0.6 / 1.0 / 1.6 coins kept per turn.
  beginner: { aimNoise: 0.18, powerNoise: 0.3, pickFrom: 6, robustTop: 0, robustSamples: 0, defend: 0 },
  skilled: { aimNoise: 0.09, powerNoise: 0.16, pickFrom: 2, robustTop: 6, robustSamples: 3, defend: 0.5 },
  master: { aimNoise: 0.08, powerNoise: 0.14, pickFrom: 1, robustTop: 12, robustSamples: 5, defend: 1 },
};

const CUT_FRACTIONS = [-0.5, -0.25, 0, 0.25, 0.5];
const FOLLOW_THROUGH = [40, 160, 360];
const MAX_REACH = 900;
const EASY_SHOT = 450;

// --- Aiming helpers (also used by the tuning bot) ------------------------------

/** Standard normal sample from a uniform rng (Box–Muller). */
export function gaussian(rng: () => number): number {
  const u = 1 - rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** True if a coin sliding from `from` to `to` wouldn't clip any other coin or cup on the way. */
export function clearPath(coins: readonly Coin[], cups: readonly Cup[], from: Coin, to: Coin): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len2 = dx * dx + dy * dy;
  const blocked = (x: number, y: number, reach: number) => {
    const t = Math.max(0, Math.min(1, ((x - from.x) * dx + (y - from.y) * dy) / len2));
    const px = from.x + dx * t - x;
    const py = from.y + dy * t - y;
    return px * px + py * py < reach * reach;
  };
  for (const c of coins) {
    if (c.id !== from.id && c.id !== to.id && blocked(c.x, c.y, COIN_RADIUS * 2)) return false;
  }
  return cups.every((cup) => !blocked(cup.x, cup.y, COIN_RADIUS + CUP_RADIUS));
}

/** Power needed for a coin to slide `distance` units before stopping. */
export function powerFor(distance: number, cfg: PhysicsConfig): number {
  const speed = Math.sqrt(2 * cfg.friction * Math.max(0, distance));
  return Math.pow(speed / cfg.maxSpeed, 1 / cfg.powerExponent);
}

/** Coins the player to move may shoot. */
export function shootable(state: GameState): Coin[] {
  return state.shooter !== null
    ? state.coins.filter((c) => c.id === state.shooter)
    : state.coins.filter((c) => isFree(state.coins, c));
}

// --- Search -------------------------------------------------------------------

function clampPower(p: number): number {
  return Math.min(1, Math.max(MIN_POWER, p));
}

function candidates(state: GameState, cfg: PhysicsConfig): Shot[] {
  const shots: Shot[] = [];
  for (const s of shootable(state)) {
    for (const t of state.coins) {
      if (t.id === s.id) continue;
      const d = Math.hypot(t.x - s.x, t.y - s.y);
      if (d > MAX_REACH) continue;
      const base = Math.atan2(t.y - s.y, t.x - s.x);
      // Widest angle that still clips the target, so cuts send it in different directions.
      const maxCut = Math.asin(Math.min(1, (COIN_RADIUS * 2) / d));
      for (const f of CUT_FRACTIONS) {
        for (const extra of FOLLOW_THROUGH) {
          shots.push({
            coinId: s.id,
            angle: base + f * maxCut,
            power: clampPower(powerFor(d - COIN_RADIUS * 2 + extra, cfg)),
          });
        }
      }
    }
    // Always have a safe fallback: a gentle nudge toward the middle of the table.
    shots.push({ coinId: s.id, angle: Math.atan2(500 - s.y, 500 - s.x), power: 0.15 });
  }
  return shots;
}

/** How many coins the given player could shoot at a nearby target with a clear line. */
function easyShots(state: GameState): number {
  let n = 0;
  for (const s of shootable(state)) {
    const ok = state.coins.some(
      (t) =>
        t.id !== s.id && Math.hypot(t.x - s.x, t.y - s.y) < EASY_SHOT && clearPath(state.coins, state.cups, s, t),
    );
    if (ok) n++;
  }
  return n;
}

/** Value of a shot for `me`: coins gained minus coins given, plus position. */
function evaluate(state: GameState, shot: Shot, me: Seat, spec: LevelSpec, cfg: PhysicsConfig): number {
  const result = simulateShot(state, shot, cfg);
  const { state: next, outcome } = resolveShot(state, shot, result);
  const them = other(me);
  let v = (next.scores[me] - state.scores[me] - (next.scores[them] - state.scores[them])) * 100;

  if (next.status === "over") {
    if (next.winner === me) v += 1000;
    else if (next.winner === them) v -= 1000;
  } else if (outcome.again) {
    v += easyShots(next) > 0 ? 25 : 0; // a run that can continue is worth more
  } else if (spec.defend > 0) {
    v -= spec.defend * 15 * Math.min(3, easyShots(next));
  }
  return v;
}

function perturb(shot: Shot, spec: LevelSpec, rng: () => number): Shot {
  return {
    coinId: shot.coinId,
    angle: shot.angle + gaussian(rng) * spec.aimNoise,
    power: clampPower(shot.power * (1 + gaussian(rng) * spec.powerNoise)),
  };
}

/** Pick and return the computer's shot for the player whose turn it is. */
export function chooseShot(
  state: GameState,
  level: AiLevel,
  rng: () => number,
  cfg: PhysicsConfig = DEFAULT_PHYSICS,
): Shot {
  const spec = LEVELS[level];
  const me = state.turn;
  const scored = candidates(state, cfg)
    .map((shot) => ({ shot, v: evaluate(state, shot, me, spec, cfg) }))
    .sort((a, b) => b.v - a.v);

  // Prefer shots that still work when our own aim is slightly off.
  if (spec.robustTop > 0) {
    const top = scored.slice(0, spec.robustTop);
    for (const c of top) {
      let sum = 0;
      for (let i = 0; i < spec.robustSamples; i++) sum += evaluate(state, perturb(c.shot, spec, rng), me, spec, cfg);
      c.v = sum / spec.robustSamples;
    }
    top.sort((a, b) => b.v - a.v);
    scored.splice(0, top.length, ...top);
  }

  const pick = scored[Math.floor(rng() * Math.min(spec.pickFrom, scored.length))];
  return perturb(pick.shot, spec, rng);
}
