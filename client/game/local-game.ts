import { COIN_RADIUS, DEFAULT_PHYSICS, DT, MIN_POWER, type PhysicsConfig } from "../../shared/constants";
import { simulateShot } from "../../shared/physics";
import { mulberry32 } from "../../shared/rng";
import { freeCoinIds, legalShot, newGame, resolveShot } from "../../shared/rules";
import type { Coin, GameState, Seat, Shot, ShotOutcome, ShotResult } from "../../shared/types";
import { METAL_COUNT } from "./sprites";
import type { Point } from "./view";

/** How far past the coin's edge you drag for full power, in board units. */
const MAX_DRAG = 320;
/** Touch target is bigger than the coin so it's easy to grab with a finger. */
const PICK_RADIUS = COIN_RADIUS * 1.6;
export const GHOST_MS = 450;

export interface Aim {
  coinId: number;
  pointer: Point;
  angle: number;
  power: number;
}

export interface DrawCoin {
  id: number;
  x: number;
  y: number;
  rotation: number;
  metal: number;
  dimmed: boolean;
}

export interface Ghost {
  x: number;
  y: number;
  rotation: number;
  metal: number;
  start: number;
}

export interface Resolved {
  shooter: Seat;
  outcome: ShotOutcome;
}

interface Anim {
  shot: Shot;
  result: ShotResult;
  frame: number;
  acc: number;
}

/** Two players on one device. Owns the game state, aiming and shot playback. */
export class LocalGame {
  state!: GameState;
  physics: PhysicsConfig = { ...DEFAULT_PHYSICS };
  aim: Aim | null = null;
  ghosts: Ghost[] = [];
  onResolved: (r: Resolved) => void = () => {};

  private anim: Anim | null = null;
  private free = new Set<number>();
  private rotation = new Map<number, number>();
  private metal = new Map<number, number>();

  constructor(seed: number) {
    this.reset(seed);
  }

  reset(seed: number): void {
    this.state = newGame(seed);
    this.aim = null;
    this.anim = null;
    this.ghosts = [];
    this.free = freeCoinIds(this.state.coins);
    const rng = mulberry32(seed ^ 0x9e3779b9);
    for (const c of this.state.coins) {
      this.rotation.set(c.id, rng() * Math.PI * 2);
      this.metal.set(c.id, Math.floor(rng() * METAL_COUNT));
    }
  }

  get canAim(): boolean {
    return this.state.status === "playing" && this.anim === null;
  }

  /** Nearest free coin under the pointer, if any. */
  coinAt(p: Point): Coin | null {
    if (!this.canAim) return null;
    let best: Coin | null = null;
    let bestD = PICK_RADIUS;
    for (const c of this.state.coins) {
      if (!this.free.has(c.id)) continue;
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d <= bestD) {
        best = c;
        bestD = d;
      }
    }
    return best;
  }

  startAim(p: Point): boolean {
    const c = this.coinAt(p);
    if (!c) return false;
    this.aim = { coinId: c.id, pointer: p, angle: 0, power: 0 };
    this.moveAim(p);
    return true;
  }

  moveAim(p: Point): void {
    if (!this.aim) return;
    const c = this.state.coins.find((k) => k.id === this.aim!.coinId)!;
    const vx = c.x - p.x;
    const vy = c.y - p.y;
    const pull = Math.hypot(vx, vy) - COIN_RADIUS; // releasing on the coin itself cancels
    this.aim.pointer = p;
    this.aim.angle = Math.atan2(vy, vx);
    this.aim.power = Math.min(1, Math.max(0, pull / MAX_DRAG));
  }

  releaseAim(): void {
    const aim = this.aim;
    this.aim = null;
    if (!aim || aim.power < MIN_POWER) return;
    this.fire({ coinId: aim.coinId, angle: aim.angle, power: aim.power });
  }

  cancelAim(): void {
    this.aim = null;
  }

  fire(shot: Shot): void {
    if (!legalShot(this.state, this.state.turn, shot)) return;
    const result = simulateShot(this.state.coins, shot, this.physics, true);
    this.anim = { shot, result, frame: 0, acc: 0 };
  }

  /** Advance playback. Returns true while anything is still moving. */
  update(dtSeconds: number, now: number): boolean {
    this.ghosts = this.ghosts.filter((g) => now - g.start < GHOST_MS);
    const anim = this.anim;
    if (!anim) return this.ghosts.length > 0;

    const frames = anim.result.frames!;
    anim.acc += Math.min(dtSeconds, 0.1);
    const before = anim.frame;
    while (anim.acc >= DT && anim.frame < frames.length) {
      anim.frame++;
      anim.acc -= DT;
    }
    if (anim.frame > before) this.spin(before, anim.frame);
    if (anim.frame >= frames.length) this.finish(anim, now);
    return true;
  }

  /** Coins roll a little as they slide. Visual only. */
  private spin(from: number, to: number): void {
    const frames = this.anim!.result.frames!;
    const a = from === 0 ? null : frames[from - 1];
    const b = frames[to - 1];
    this.state.coins.forEach((c, i) => {
      const x0 = a ? a[i * 2] : c.x;
      const y0 = a ? a[i * 2 + 1] : c.y;
      const d = Math.hypot(b[i * 2] - x0, b[i * 2 + 1] - y0);
      if (d > 0) this.rotation.set(c.id, this.rotation.get(c.id)! + d * 0.012 * (c.id % 2 ? 1 : -1));
    });
  }

  private finish(anim: Anim, now: number): void {
    const shooter = this.state.turn;
    const { state, outcome } = resolveShot(this.state, anim.shot, anim.result);
    if (outcome.kind === "capture") {
      const t = anim.result.coins.find((c) => c.id === outcome.target)!;
      this.ghosts.push({
        x: t.x,
        y: t.y,
        rotation: this.rotation.get(t.id)!,
        metal: this.metal.get(t.id)!,
        start: now,
      });
    }
    this.state = state;
    this.anim = null;
    this.free = freeCoinIds(state.coins);
    this.onResolved({ shooter, outcome });
  }

  coins(): DrawCoin[] {
    const frame = this.anim ? this.anim.result.frames![Math.max(0, this.anim.frame - 1)] : null;
    const showFree = this.canAim;
    return this.state.coins.map((c, i) => ({
      id: c.id,
      x: frame && this.anim!.frame > 0 ? frame[i * 2] : c.x,
      y: frame && this.anim!.frame > 0 ? frame[i * 2 + 1] : c.y,
      rotation: this.rotation.get(c.id)!,
      metal: this.metal.get(c.id)!,
      dimmed: showFree && !this.free.has(c.id),
    }));
  }

  coinPosition(id: number): Point | null {
    const c = this.state.coins.find((k) => k.id === id);
    return c ? { x: c.x, y: c.y } : null;
  }
}
