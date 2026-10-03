import {
  COIN_RADIUS,
  DEFAULT_PHYSICS,
  DT,
  MIN_POWER,
  type Difficulty,
  type PhysicsConfig,
} from "../../shared/constants";
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
export const GHOST_MS = { capture: 450, fall: 500 } as const;

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

/** A coin leaving the table: floating up when kept, dropping when it falls off. */
export interface Ghost {
  kind: "capture" | "fall";
  x: number;
  y: number;
  vx: number;
  vy: number;
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
  /** Fall events not yet shown. */
  pendingFalls: { step: number; id: number; vx: number; vy: number }[];
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
  private hidden = new Set<number>();
  private rotation = new Map<number, number>();
  private metal = new Map<number, number>();

  constructor(seed: number, difficulty: Difficulty) {
    this.reset(seed, difficulty);
  }

  reset(seed: number, difficulty: Difficulty): void {
    this.state = newGame(seed, difficulty);
    this.aim = null;
    this.anim = null;
    this.ghosts = [];
    this.hidden.clear();
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
      if (!this.playable(c.id)) continue;
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d <= bestD) {
        best = c;
        bestD = d;
      }
    }
    return best;
  }

  /** During a run of captures only the same coin may be shot; otherwise any free coin. */
  private playable(id: number): boolean {
    const forced = this.state.shooter;
    return forced === null ? this.free.has(id) : id === forced;
  }

  /** The coin the current player must shoot, if their choice is restricted. */
  get forcedCoin(): number | null {
    return this.canAim ? this.state.shooter : null;
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
    const result = simulateShot(this.state, shot, this.physics, true);
    const pendingFalls = result.events.flatMap((e) => (e.type === "fall" ? [e] : []));
    this.anim = { shot, result, frame: 0, acc: 0, pendingFalls };
  }

  /** Advance playback. Returns true while anything is still moving. */
  update(dtSeconds: number, now: number): boolean {
    this.ghosts = this.ghosts.filter((g) => now - g.start < GHOST_MS[g.kind]);
    const anim = this.anim;
    if (!anim) return this.ghosts.length > 0;

    const frames = anim.result.frames!;
    anim.acc += Math.min(dtSeconds, 0.1);
    const before = anim.frame;
    while (anim.acc >= DT && anim.frame < frames.length) {
      anim.frame++;
      anim.acc -= DT;
    }
    if (anim.frame > before) {
      this.spin(before, anim.frame);
      this.showFalls(anim, now);
    }
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

  /** Once playback reaches a fall, swap the frozen coin for a dropping ghost. */
  private showFalls(anim: Anim, now: number): void {
    const frame = anim.result.frames![anim.frame - 1];
    anim.pendingFalls = anim.pendingFalls.filter((f) => {
      if (f.step >= anim.frame) return true;
      const i = this.state.coins.findIndex((c) => c.id === f.id);
      this.hidden.add(f.id);
      this.ghosts.push({ kind: "fall", x: frame[i * 2], y: frame[i * 2 + 1], vx: f.vx, vy: f.vy, ...this.look(f.id), start: now });
      return false;
    });
  }

  private look(id: number): { rotation: number; metal: number } {
    return { rotation: this.rotation.get(id)!, metal: this.metal.get(id)! };
  }

  private finish(anim: Anim, now: number): void {
    const shooter = this.state.turn;
    const { state, outcome } = resolveShot(this.state, anim.shot, anim.result);
    if (outcome.captured !== null) {
      const t = anim.result.coins.find((c) => c.id === outcome.captured)!;
      this.ghosts.push({ kind: "capture", x: t.x, y: t.y, vx: 0, vy: 0, ...this.look(t.id), start: now });
    }
    this.state = state;
    this.anim = null;
    this.hidden.clear();
    this.free = freeCoinIds(state.coins);
    this.onResolved({ shooter, outcome });
  }

  coins(): DrawCoin[] {
    const anim = this.anim;
    const frame = anim && anim.frame > 0 ? anim.result.frames![anim.frame - 1] : null;
    const showFree = this.canAim;
    const out: DrawCoin[] = [];
    this.state.coins.forEach((c, i) => {
      if (this.hidden.has(c.id)) return;
      out.push({
        id: c.id,
        x: frame ? frame[i * 2] : c.x,
        y: frame ? frame[i * 2 + 1] : c.y,
        ...this.look(c.id),
        dimmed: showFree && !this.playable(c.id),
      });
    });
    return out;
  }

  coinPosition(id: number): Point | null {
    const c = this.state.coins.find((k) => k.id === id);
    return c ? { x: c.x, y: c.y } : null;
  }
}
