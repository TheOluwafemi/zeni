import type { Difficulty } from "./constants";

export interface Coin {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** A fixed obstacle. */
export interface Cup {
  x: number;
  y: number;
}

/** What a shot is simulated against. */
export interface Table {
  coins: readonly Coin[];
  cups: readonly Cup[];
}

export type Seat = 0 | 1;

export interface GameState {
  seed: number;
  difficulty: Difficulty;
  coins: Coin[];
  cups: Cup[];
  scores: [number, number];
  turn: Seat;
  /** During a run of captures, the coin that must be shot next. Null when a new turn starts. */
  shooter: number | null;
  shots: number;
  status: "playing" | "over";
  winner: Seat | "draw" | null;
}

/** Angle is the direction of travel in board coordinates (y points down). Power is 0..1. */
export interface Shot {
  coinId: number;
  angle: number;
  power: number;
}

export type SimEvent =
  | { type: "hit"; step: number; a: number; b: number; impulse: number }
  | { type: "cup"; step: number; id: number; impulse: number }
  | { type: "fall"; step: number; id: number; vx: number; vy: number };

export interface ShotResult {
  /** Coins still on the table, at rest, in input order. */
  coins: Coin[];
  /** Ids of coins that fell off the table, in the order they fell. */
  fallen: number[];
  events: SimEvent[];
  steps: number;
  /** Per step, [x0, y0, x1, y1, ...] in input coin order. Fallen coins stay frozen where they fell. */
  frames?: Float32Array[];
  /** Per step, how far each coin has turned since the shot began (radians), in input coin order. */
  turns?: Float32Array[];
}

export interface ShotOutcome {
  /** The coin the shooter kept, if any. */
  captured: number | null;
  /** How many coins the shooter touched. */
  touched: number;
  /** Coins that fell off; they go to the opponent. */
  fallen: number[];
  /** True if the same player shoots again, with the same coin. */
  again: boolean;
  /** True if a capture's run ended because the shooter stopped touching another coin. */
  blocked: boolean;
}
