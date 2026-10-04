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
  /** Spin (rad/s) and how far it has turned. */
  w: number;
  turn: number;
}

/** A coin is a disc: moment of inertia per unit mass is R²/2, so R²/I = 2. */
const R = COIN_RADIUS;
const R2_OVER_I = 2;

/** Advance the world by one fixed timestep. Mutates `bodies` and appends to `events`. */
function step(bodies: Body[], cups: readonly Cup[], cfg: PhysicsConfig, events: SimEvent[], stepIndex: number): void {
  const decel = cfg.friction * DT;
  const spinDecel = cfg.spinDecay * DT;

  for (const c of bodies) {
    if (c.off) continue;
    if (c.w !== 0) {
      const s = Math.abs(c.w);
      c.w = s <= spinDecel ? 0 : c.w * ((s - spinDecel) / s);
      c.turn += c.w * DT;
    }
    const speed = Math.hypot(c.vx, c.vy);
    if (speed === 0) continue;
    // Two phases: a quick slide, then a gentler drift to a stop.
    const slow = speed < cfg.driftSpeed ? decel * cfg.driftFriction : decel;
    const k = Math.max(0, speed - slow) / speed;
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

  const j = ((1 + bounce(cfg.coinRestitution, rel, cfg)) * rel) / 2; // equal masses
  a.vx -= nx * j;
  a.vy -= ny * j;
  b.vx += nx * j;
  b.vy += ny * j;

  // Grip at the contact: the coins' surfaces slide past each other (sideways motion plus spin), and
  // friction resists it, up to a limit. Glancing hits throw the struck coin along and set both spinning.
  const tx = -ny;
  const ty = nx;
  const slip = (a.vx - b.vx) * tx + (a.vy - b.vy) * ty + R * (a.w + b.w);
  const limit = cfg.contactFriction * j;
  const jt = Math.max(-limit, Math.min(limit, -slip / (2 + 2 * R2_OVER_I)));
  a.vx += tx * jt;
  a.vy += ty * jt;
  b.vx -= tx * jt;
  b.vy -= ty * jt;
  a.w += (R2_OVER_I * jt) / R;
  b.w += (R2_OVER_I * jt) / R;

  events.push({ type: "hit", step: stepIndex, a: a.id, b: b.id, impulse: j });
}

/** Slow contacts are softer, so gentle taps don't ping off each other. */
function bounce(restitution: number, speed: number, cfg: PhysicsConfig): number {
  return speed >= cfg.softSpeed ? restitution : restitution * (0.35 + (0.65 * speed) / cfg.softSpeed);
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
  const j = -(1 + bounce(cfg.cupRestitution, -into, cfg)) * into;
  c.vx += nx * j;
  c.vy += ny * j;

  // The same grip against the cup, which doesn't move: a glancing bounce sets the coin spinning.
  const tx = -ny;
  const ty = nx;
  const slip = c.vx * tx + c.vy * ty - R * c.w;
  const limit = cfg.contactFriction * j;
  const jt = Math.max(-limit, Math.min(limit, -slip / (1 + R2_OVER_I)));
  c.vx += tx * jt;
  c.vy += ty * jt;
  c.w -= (R2_OVER_I * jt) / R;

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
  const bodies: Body[] = table.coins.map((c) => ({ ...c, vx: 0, vy: 0, off: false, w: 0, turn: 0 }));
  const shooter = bodies.find((c) => c.id === shot.coinId);
  if (!shooter) throw new Error(`No coin with id ${shot.coinId}`);

  const speed = shotSpeed(shot.power, cfg);
  shooter.vx = Math.cos(shot.angle) * speed;
  shooter.vy = Math.sin(shot.angle) * speed;

  const events: SimEvent[] = [];
  const frames: Float32Array[] | undefined = recordFrames ? [] : undefined;
  const turns: Float32Array[] | undefined = recordFrames ? [] : undefined;
  const stop2 = STOP_SPEED * STOP_SPEED;

  let steps = 0;
  while (steps < MAX_STEPS) {
    step(bodies, table.cups, cfg, events, steps);
    steps++;
    if (frames) frames.push(snapshot(bodies));
    if (turns) turns.push(Float32Array.from(bodies, (b) => b.turn));
    if (bodies.every((c) => c.off || c.vx * c.vx + c.vy * c.vy < stop2)) break;
  }

  const fallen: number[] = [];
  for (const e of events) if (e.type === "fall") fallen.push(e.id);
  const coins = bodies.filter((c) => !c.off).map(({ id, x, y }) => ({ id, x, y, vx: 0, vy: 0 }));
  return { coins, fallen, events, steps, frames, turns };
}

function snapshot(bodies: Body[]): Float32Array {
  const f = new Float32Array(bodies.length * 2);
  for (let i = 0; i < bodies.length; i++) {
    f[i * 2] = bodies[i].x;
    f[i * 2 + 1] = bodies[i].y;
  }
  return f;
}
