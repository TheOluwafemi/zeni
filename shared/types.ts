export interface Coin {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export type Seat = 0 | 1;

export interface GameState {
  seed: number;
  coins: Coin[];
  scores: [number, number];
  turn: Seat;
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
  | { type: "wall"; step: number; id: number; impulse: number };

export interface ShotResult {
  /** Final resting positions, in the same order as the input coins. */
  coins: Coin[];
  events: SimEvent[];
  steps: number;
  /** Per step, [x0, y0, x1, y1, ...] in coin order. Only when recording. */
  frames?: Float32Array[];
}

export type ShotOutcome =
  | { kind: "capture"; target: number }
  | { kind: "miss"; touched: number };
