// Shared by the client and the server.

export const GAME_NAME = "Zeni";
export const PROTOCOL_VERSION = 1;

// Board and pieces, in logical units. The board is BOARD_SIZE square with rim walls.
export const BOARD_SIZE = 1000;
export const COIN_RADIUS = 36;
export const COIN_COUNT = 10;

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
  wallRestitution: number; // bounciness of rim hits
  powerExponent: number; // speed = maxSpeed * power^powerExponent
}

export const DEFAULT_PHYSICS: PhysicsConfig = {
  maxSpeed: 1600,
  friction: 850,
  coinRestitution: 0.92,
  wallRestitution: 0.6,
  powerExponent: 1.4,
};
