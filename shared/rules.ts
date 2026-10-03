import {
  BOARD_SIZE,
  COIN_COUNT,
  COIN_RADIUS,
  FREE_GAP,
  MAX_SHOTS,
  MIN_POWER,
} from "./constants";
import { mulberry32 } from "./rng";
import type { Coin, GameState, Seat, Shot, ShotOutcome, ShotResult, SimEvent } from "./types";

const SCATTER_MARGIN = 150;
const SCATTER_MIN_DIST = COIN_RADIUS * 2 + 40;
const FREE_DIST = COIN_RADIUS * 2 + FREE_GAP;

export function newGame(seed: number): GameState {
  const rng = mulberry32(seed);
  const span = BOARD_SIZE - SCATTER_MARGIN * 2;
  const coins: Coin[] = [];

  let attempts = 0;
  while (coins.length < COIN_COUNT) {
    if (++attempts > 10_000) throw new Error("Could not place coins");
    const x = SCATTER_MARGIN + rng() * span;
    const y = SCATTER_MARGIN + rng() * span;
    const clear = coins.every((c) => (c.x - x) ** 2 + (c.y - y) ** 2 >= SCATTER_MIN_DIST ** 2);
    if (clear) coins.push({ id: coins.length, x, y, vx: 0, vy: 0 });
  }

  return {
    seed,
    coins,
    scores: [0, 0],
    turn: rng() < 0.5 ? 0 : 1,
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
  const coin = state.coins.find((c) => c.id === shot.coinId);
  return coin !== undefined && isFree(state.coins, coin);
}

/** Every coin the shooter touched during the shot. */
export function touchedBy(events: readonly SimEvent[], shooterId: number): Set<number> {
  const touched = new Set<number>();
  for (const e of events) {
    if (e.type !== "hit") continue;
    if (e.a === shooterId) touched.add(e.b);
    else if (e.b === shooterId) touched.add(e.a);
  }
  return touched;
}

/** Apply a finished shot: capture if the shooter touched exactly one coin, otherwise pass the turn. */
export function resolveShot(
  state: GameState,
  shot: Shot,
  result: ShotResult,
): { state: GameState; outcome: ShotOutcome } {
  const touched = touchedBy(result.events, shot.coinId);
  const scores: [number, number] = [state.scores[0], state.scores[1]];
  let coins = result.coins.map((c) => ({ ...c }));
  let turn = state.turn;
  let outcome: ShotOutcome;

  if (touched.size === 1) {
    const [target] = touched;
    coins = coins.filter((c) => c.id !== target);
    scores[turn]++;
    outcome = { kind: "capture", target };
  } else {
    turn = other(turn);
    outcome = { kind: "miss", touched: touched.size };
  }

  const next: GameState = { ...state, coins, scores, turn, shots: state.shots + 1 };
  return { state: finishIfOver(next), outcome };
}

function finishIfOver(state: GameState): GameState {
  const noShotsLeft = state.coins.length <= 1 || freeCoinIds(state.coins).size === 0;
  if (!noShotsLeft && state.shots < MAX_SHOTS) return state;

  const [a, b] = state.scores;
  const winner: GameState["winner"] = a === b ? "draw" : a > b ? 0 : 1;
  return { ...state, status: "over", winner };
}
