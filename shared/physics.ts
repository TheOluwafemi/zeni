import {
  COIN_RADIUS,
  CUP_RADIUS,
  DEFAULT_PHYSICS,
  DT,
  MAX_STEPS,
  STOP_SPEED,
  TABLE_CENTER,
  TABLE_RADIUS,
  type PhysicsConfig,
} from "./constants";
import type { Coin, Cup, Shot, ShotResult, SimEvent, Table } from "./types";

const CONTACT = COIN_RADIUS * 2;
const CUP_CONTACT = COIN_RADIUS + CUP_RADIUS;

/** A coin in the simulation. `off` coins have fallen and no longer take part. */
interface Body extends Coin {
  off: boolean;
}

/** Advance the world by one fixed timestep. Mutates `bodies` and appends to `events`. */
function step(bodies: Body[], cups: readonly Cup[], cfg: PhysicsConfig, events: SimEvent[], stepIndex: number): void {
  const decel = cfg.friction * DT;

  for (const c of bodies) {
    if (c.off) continue;
    const speed = Math.hypot(c.vx, c.vy);
    if (speed === 0) continue;
    const k = Math.max(0, speed - decel) / speed;
    c.vx *= k;
    c.vy *= k;
    c.x += c.vx * DT;
    c.y += c.vy * DT;
  }

  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i];
    if (a.off) continue;
    for (let j = i + 1; j < bodies.length; j++) {
      if (!bodies[j].off) collide(a, bodies[j], cfg, events, stepIndex);
    }
    for (const cup of cups) bounceCup(a, cup, cfg, events, stepIndex);
  }

  // The table has no rim: a coin whose centre crosses the edge falls off.
  for (const c of bodies) {
    if (c.off) continue;
    if ((c.x - TABLE_CENTER) ** 2 + (c.y - TABLE_CENTER) ** 2 > TABLE_RADIUS ** 2) {
      c.off = true;
      events.push({ type: "fall", step: stepIndex, id: c.id, vx: c.vx, vy: c.vy });
      c.vx = 0;
      c.vy = 0;
    }
  }
}

function collide(a: Body, b: Body, cfg: PhysicsConfig, events: SimEvent[], stepIndex: number): void {
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

/** Cups are immovable: push the coin out and reflect it. */
function bounceCup(c: Body, cup: Cup, cfg: PhysicsConfig, events: SimEvent[], stepIndex: number): void {
  const dx = c.x - cup.x;
  const dy = c.y - cup.y;
  const d2 = dx * dx + dy * dy;
  if (d2 >= CUP_CONTACT * CUP_CONTACT || d2 === 0) return;

  const d = Math.sqrt(d2);
  const nx = dx / d;
  const ny = dy / d;
  c.x = cup.x + nx * CUP_CONTACT;
  c.y = cup.y + ny * CUP_CONTACT;

  const into = c.vx * nx + c.vy * ny;
  if (into >= 0) return;
  const j = -(1 + cfg.cupRestitution) * into;
  c.vx += nx * j;
  c.vy += ny * j;
  events.push({ type: "cup", step: stepIndex, id: c.id, impulse: -into });
}

export function shotSpeed(power: number, cfg: PhysicsConfig = DEFAULT_PHYSICS): number {
  const p = Math.min(1, Math.max(0, power));
  return cfg.maxSpeed * Math.pow(p, cfg.powerExponent);
}

/** Run a shot to completion. Never mutates the input. */
export function simulateShot(
  table: Table,
  shot: Shot,
  cfg: PhysicsConfig = DEFAULT_PHYSICS,
  recordFrames = false,
): ShotResult {
  const bodies: Body[] = table.coins.map((c) => ({ ...c, vx: 0, vy: 0, off: false }));
  const shooter = bodies.find((c) => c.id === shot.coinId);
  if (!shooter) throw new Error(`No coin with id ${shot.coinId}`);

  const speed = shotSpeed(shot.power, cfg);
  shooter.vx = Math.cos(shot.angle) * speed;
  shooter.vy = Math.sin(shot.angle) * speed;

  const events: SimEvent[] = [];
  const frames: Float32Array[] | undefined = recordFrames ? [] : undefined;
  const stop2 = STOP_SPEED * STOP_SPEED;

  let steps = 0;
  while (steps < MAX_STEPS) {
    step(bodies, table.cups, cfg, events, steps);
    steps++;
    if (frames) frames.push(snapshot(bodies));
    if (bodies.every((c) => c.off || c.vx * c.vx + c.vy * c.vy < stop2)) break;
  }

  const fallen: number[] = [];
  for (const e of events) if (e.type === "fall") fallen.push(e.id);
  const coins = bodies.filter((c) => !c.off).map(({ id, x, y }) => ({ id, x, y, vx: 0, vy: 0 }));
  return { coins, fallen, events, steps, frames };
}

function snapshot(bodies: Body[]): Float32Array {
  const f = new Float32Array(bodies.length * 2);
  for (let i = 0; i < bodies.length; i++) {
    f[i * 2] = bodies[i].x;
    f[i * 2 + 1] = bodies[i].y;
  }
  return f;
}
