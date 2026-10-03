import {
  BOARD_SIZE,
  COIN_RADIUS,
  DEFAULT_PHYSICS,
  DT,
  MAX_STEPS,
  STOP_SPEED,
  type PhysicsConfig,
} from "./constants";
import type { Coin, Shot, ShotResult, SimEvent } from "./types";

const MIN_POS = COIN_RADIUS;
const MAX_POS = BOARD_SIZE - COIN_RADIUS;
const CONTACT = COIN_RADIUS * 2;

/** Advance the world by one fixed timestep. Mutates `coins` and appends to `events`. */
export function step(coins: Coin[], cfg: PhysicsConfig, events: SimEvent[], stepIndex: number): void {
  const decel = cfg.friction * DT;

  for (const c of coins) {
    const speed = Math.hypot(c.vx, c.vy);
    if (speed > 0) {
      const k = Math.max(0, speed - decel) / speed;
      c.vx *= k;
      c.vy *= k;
      c.x += c.vx * DT;
      c.y += c.vy * DT;
    }
    bounceWalls(c, cfg, events, stepIndex);
  }

  for (let i = 0; i < coins.length; i++) {
    for (let j = i + 1; j < coins.length; j++) {
      collide(coins[i], coins[j], cfg, events, stepIndex);
    }
  }

  // Separating overlapping coins can push one into the rim.
  for (const c of coins) clampInside(c);
}

function bounceWalls(c: Coin, cfg: PhysicsConfig, events: SimEvent[], stepIndex: number): void {
  const e = cfg.wallRestitution;
  if (c.x < MIN_POS) {
    c.x = MIN_POS;
    if (c.vx < 0) {
      events.push({ type: "wall", step: stepIndex, id: c.id, impulse: -c.vx });
      c.vx = -c.vx * e;
    }
  } else if (c.x > MAX_POS) {
    c.x = MAX_POS;
    if (c.vx > 0) {
      events.push({ type: "wall", step: stepIndex, id: c.id, impulse: c.vx });
      c.vx = -c.vx * e;
    }
  }
  if (c.y < MIN_POS) {
    c.y = MIN_POS;
    if (c.vy < 0) {
      events.push({ type: "wall", step: stepIndex, id: c.id, impulse: -c.vy });
      c.vy = -c.vy * e;
    }
  } else if (c.y > MAX_POS) {
    c.y = MAX_POS;
    if (c.vy > 0) {
      events.push({ type: "wall", step: stepIndex, id: c.id, impulse: c.vy });
      c.vy = -c.vy * e;
    }
  }
}

function collide(a: Coin, b: Coin, cfg: PhysicsConfig, events: SimEvent[], stepIndex: number): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d2 = dx * dx + dy * dy;
  if (d2 >= CONTACT * CONTACT || d2 === 0) return;

  const d = Math.sqrt(d2);
  const nx = dx / d;
  const ny = dy / d;

  const half = (CONTACT - d) / 2;
  a.x -= nx * half;
  a.y -= ny * half;
  b.x += nx * half;
  b.y += ny * half;

  // Only respond if the coins are moving toward each other.
  const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
  if (rel <= 0) return;

  const j = ((1 + cfg.coinRestitution) * rel) / 2; // equal masses
  a.vx -= nx * j;
  a.vy -= ny * j;
  b.vx += nx * j;
  b.vy += ny * j;
  events.push({ type: "hit", step: stepIndex, a: a.id, b: b.id, impulse: j });
}

function clampInside(c: Coin): void {
  c.x = Math.min(MAX_POS, Math.max(MIN_POS, c.x));
  c.y = Math.min(MAX_POS, Math.max(MIN_POS, c.y));
}

export function shotSpeed(power: number, cfg: PhysicsConfig = DEFAULT_PHYSICS): number {
  const p = Math.min(1, Math.max(0, power));
  return cfg.maxSpeed * Math.pow(p, cfg.powerExponent);
}

/** Run a shot to completion. Never mutates the input coins. */
export function simulateShot(
  coins: readonly Coin[],
  shot: Shot,
  cfg: PhysicsConfig = DEFAULT_PHYSICS,
  recordFrames = false,
): ShotResult {
  const world = coins.map((c) => ({ ...c, vx: 0, vy: 0 }));
  const shooter = world.find((c) => c.id === shot.coinId);
  if (!shooter) throw new Error(`No coin with id ${shot.coinId}`);

  const speed = shotSpeed(shot.power, cfg);
  shooter.vx = Math.cos(shot.angle) * speed;
  shooter.vy = Math.sin(shot.angle) * speed;

  const events: SimEvent[] = [];
  const frames: Float32Array[] | undefined = recordFrames ? [] : undefined;
  const stop2 = STOP_SPEED * STOP_SPEED;

  let steps = 0;
  while (steps < MAX_STEPS) {
    step(world, cfg, events, steps);
    steps++;
    if (frames) frames.push(snapshot(world));
    if (world.every((c) => c.vx * c.vx + c.vy * c.vy < stop2)) break;
  }

  for (const c of world) {
    c.vx = 0;
    c.vy = 0;
  }
  return { coins: world, events, steps, frames };
}

function snapshot(coins: Coin[]): Float32Array {
  const f = new Float32Array(coins.length * 2);
  for (let i = 0; i < coins.length; i++) {
    f[i * 2] = coins[i].x;
    f[i * 2 + 1] = coins[i].y;
  }
  return f;
}
