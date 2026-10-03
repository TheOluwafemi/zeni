import {
  COIN_COUNT,
  COIN_RADIUS,
  CUP_RADIUS,
  CUPS,
  FREE_GAP,
  MAX_SHOTS,
  MIN_POWER,
  TABLE_CENTER,
  TABLE_RADIUS,
  type Difficulty,
} from "./constants";
import { mulberry32 } from "./rng";
import type { Coin, Cup, GameState, Seat, Shot, ShotOutcome, ShotResult, SimEvent } from "./types";

const COIN_MARGIN = 140; // keep the starting coins away from the edge
const CUP_MARGIN = 200;
const COIN_SPACING = COIN_RADIUS * 2 + 40;
const CUP_SPACING = CUP_RADIUS * 2 + COIN_RADIUS * 2; // a coin can always pass between two cups
const CUP_CLEARANCE = CUP_RADIUS + COIN_RADIUS + 30;
const FREE_DIST = COIN_RADIUS * 2 + FREE_GAP;

export function newGame(seed: number, difficulty: Difficulty = "easy"): GameState {
  const rng = mulberry32(seed);
  // Uniform over a disc, `margin` in from the table edge.
  const place = (margin: number) => {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * (TABLE_RADIUS - margin);
    return { x: TABLE_CENTER + Math.cos(a) * r, y: TABLE_CENTER + Math.sin(a) * r };
  };
  const far = (a: { x: number; y: number }, b: { x: number; y: number }, d: number) =>
    (a.x - b.x) ** 2 + (a.y - b.y) ** 2 >= d * d;

  let attempts = 0;
  const guard = () => {
    if (++attempts > 20_000) throw new Error("Could not lay out the table");
  };

  const cups: Cup[] = [];
  while (cups.length < CUPS[difficulty]) {
    guard();
    const p = place(CUP_MARGIN);
    if (cups.every((c) => far(c, p, CUP_SPACING))) cups.push(p);
  }

  const coins: Coin[] = [];
  while (coins.length < COIN_COUNT) {
    guard();
    const p = place(COIN_MARGIN);
    if (coins.every((c) => far(c, p, COIN_SPACING)) && cups.every((c) => far(c, p, CUP_CLEARANCE))) {
      coins.push({ id: coins.length, ...p, vx: 0, vy: 0 });
    }
  }

  return {
    seed,
    difficulty,
    coins,
    cups,
    scores: [0, 0],
    turn: rng() < 0.5 ? 0 : 1,
    shooter: null,
    shots: 0,
    status: "playing",
    winner: null,
  };
}

export function other(seat: Seat): Seat {
  return seat === 0 ? 1 : 0;
}

/** A coin is free if it isn't touching (or nearly touching) any other coin. */
export function isFree(coins: readonly Coin[], coin: Coin): boolean {
  return coins.every(
    (c) => c.id === coin.id || (c.x - coin.x) ** 2 + (c.y - coin.y) ** 2 >= FREE_DIST ** 2,
  );
}

export function freeCoinIds(coins: readonly Coin[]): Set<number> {
  return new Set(coins.filter((c) => isFree(coins, c)).map((c) => c.id));
}

export function legalShot(state: GameState, seat: Seat, shot: Shot): boolean {
  if (state.status !== "playing" || state.turn !== seat) return false;
  if (!Number.isFinite(shot.angle) || !Number.isFinite(shot.power)) return false;
  if (shot.power < MIN_POWER || shot.power > 1) return false;
  if (state.shooter !== null && shot.coinId !== state.shooter) return false;
  const coin = state.coins.find((c) => c.id === shot.coinId);
  return coin !== undefined && isFree(state.coins, coin);
}

/** Every coin the shooter touched during the shot. Cups don't count. */
export function touchedBy(events: readonly SimEvent[], shooterId: number): Set<number> {
  const touched = new Set<number>();
  for (const e of events) {
    if (e.type !== "hit") continue;
    if (e.a === shooterId) touched.add(e.b);
    else if (e.b === shooterId) touched.add(e.a);
  }
  return touched;
}

/**
 * Apply a finished shot.
 * - Touch exactly one coin and it stays on the table: you keep it.
 * - Any coin that falls off (including your shooter) goes to your opponent.
 * - You shoot again only if you kept a coin and nothing fell off, and you must shoot
 *   the same coin from where it stopped. If it stopped touching another coin, the turn passes.
 * - Only a new turn lets a player pick any coin.
 */
export function resolveShot(
  state: GameState,
  shot: Shot,
  result: ShotResult,
): { state: GameState; outcome: ShotOutcome } {
  const shooter = state.turn;
  const touched = touchedBy(result.events, shot.coinId);
  const scores: [number, number] = [state.scores[0], state.scores[1]];
  let coins = result.coins.map((c) => ({ ...c }));

  let captured: number | null = null;
  if (touched.size === 1) {
    const [target] = touched;
    if (!result.fallen.includes(target)) {
      captured = target;
      coins = coins.filter((c) => c.id !== target);
      scores[shooter]++;
    }
  }
  scores[other(shooter)] += result.fallen.length;

  const earned = captured !== null && result.fallen.length === 0;
  const own = coins.find((c) => c.id === shot.coinId);
  const blocked = earned && (own === undefined || !isFree(coins, own));
  const again = earned && !blocked;
  const outcome: ShotOutcome = { captured, touched: touched.size, fallen: result.fallen, again, blocked };
  const next: GameState = {
    ...state,
    coins,
    scores,
    turn: again ? shooter : other(shooter),
    shooter: again ? shot.coinId : null,
    shots: state.shots + 1,
  };
  return { state: finishIfOver(next), outcome };
}

function finishIfOver(state: GameState): GameState {
  const noShotsLeft = state.coins.length <= 1 || freeCoinIds(state.coins).size === 0;
  if (!noShotsLeft && state.shots < MAX_SHOTS) return state;

  const [a, b] = state.scores;
  const winner: GameState["winner"] = a === b ? "draw" : a > b ? 0 : 1;
  return { ...state, status: "over", winner };
}
