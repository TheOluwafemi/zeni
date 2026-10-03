// Shared by the client and the server.

export const GAME_NAME = "Zeni";
export const PROTOCOL_VERSION = 1;

// Table and pieces, in logical units. The table is round, centred in a BOARD_SIZE square,
// with an open edge: a coin whose centre crosses the edge falls off.
export const BOARD_SIZE = 1000;
export const TABLE_RADIUS = BOARD_SIZE / 2;
export const TABLE_CENTER = BOARD_SIZE / 2;
export const COIN_RADIUS = 36;
export const COIN_COUNT = 10;
export const CUP_RADIUS = 56;

/** Cups on the table per difficulty. Cups never move and block lines of sight. */
export const CUPS = { easy: 2, hard: 4 } as const;
export type Difficulty = keyof typeof CUPS;

// Rules
export const MAX_SHOTS = 40; // safety net so a game can't go on forever
export const FREE_GAP = 4; // a coin is free if no other coin is within 2R + FREE_GAP
export const MIN_POWER = 0.05; // releasing below this cancels the shot

// Simulation
export const DT = 1 / 120; // fixed timestep in seconds
export const MAX_STEPS = 960; // hard cap: 8 seconds of simulated time
export const STOP_SPEED = 5; // units/s; below this every coin counts as stopped

// The values that decide how the game feels. Tune these with ?tune in the client,
// then copy the result back here.
export interface PhysicsConfig {
  maxSpeed: number; // units/s at full power
  friction: number; // units/s² of sliding deceleration
  coinRestitution: number; // bounciness of coin-to-coin hits
  cupRestitution: number; // bounciness of coin-to-cup hits
  powerExponent: number; // speed = maxSpeed * power^powerExponent
}

export const DEFAULT_PHYSICS: PhysicsConfig = {
  maxSpeed: 1600,
  friction: 850,
  coinRestitution: 0.92,
  cupRestitution: 0.6,
  powerExponent: 1.4,
};
