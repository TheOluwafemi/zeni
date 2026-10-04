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
import type { Coin, GameState, Seat, Shot, ShotOutcome, ShotResult, SimEvent } from "../../shared/types";
import { aimSettled, approachAim, type AimUpdate } from "../aim-relay";
import { METAL_COUNT } from "./sprites";
import type { Point } from "./view";

/** How far past the coin's edge you drag for full power, in board units. */
const MAX_DRAG = 320;
/** Touch target is bigger than the coin so it's easy to grab with a finger. */
const PICK_RADIUS = COIN_RADIUS * 1.6;
export const FALL_MS = 500;

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

/** A coin dropping off the edge of the table. */
export interface Ghost {
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
  /** Where the kept coin was and how it looked, so it can fly to the player's tray. */
  kept: { x: number; y: number; metal: number } | null;
}

interface Anim {
  shot: Shot;
  result: ShotResult;
  frame: number;
  acc: number;
  /** Fall events not yet shown. */
  pendingFalls: { step: number; id: number; vx: number; vy: number }[];
  /** The server's verdict on this shot, once known. Online play adopts it when playback ends. */
  auth: Authoritative | null;
  /** True for a shot this player just took: playback waits at the end until the server answers. */
  mine: boolean;
}

/** What the server says happened. */
export interface Authoritative {
  state: GameState;
  outcome: ShotOutcome;
}

/** Two players on one device. Owns the game state, aiming and shot playback. */
export class LocalGame {
  state!: GameState;
  physics: PhysicsConfig = { ...DEFAULT_PHYSICS };
  aim: Aim | null = null;
  /** Online: the other player's live aim, smoothed for drawing. */
  remoteAim: Aim | null = null;
  ghosts: Ghost[] = [];
  onResolved: (r: Resolved) => void = () => {};
  /** A shot was fired (for the flick sound). */
  onFire: (shot: Shot) => void = () => {};
  /** Physics events, delivered as playback reaches them (for hit sounds). */
  onSimEvents: (events: SimEvent[]) => void = () => {};
  /** The player took a shot on this device. Online play sends it to the server from here. */
  onLocalShot: (shot: Shot, seq: number) => void = () => {};
  /**
   * Which seat this device plays. Null means every turn is played here (hot-seat or computer).
   * Online, it's the player's own seat: they can only aim on their turn.
   */
  controlledSeat: Seat | null = null;
  /** Online: hold a shot's playback at its end until the server confirms the result. */
  awaitServer = false;

  private anim: Anim | null = null;
  private remoteTarget: AimUpdate | null = null;
  private remoteShown: AimUpdate | null = null;
  private free = new Set<number>();
  private hidden = new Set<number>();
  private rotation = new Map<number, number>();
  private metal = new Map<number, number>();

  constructor(seed: number, difficulty: Difficulty) {
    this.reset(seed, difficulty);
  }

  reset(seed: number, difficulty: Difficulty, first?: Seat): void {
    this.load(newGame(seed, difficulty, first));
  }

  /** Adopt a position wholesale: a new game, or the server's word after a reconnect. */
  load(state: GameState): void {
    this.state = state;
    this.aim = null;
    this.setRemoteAim(null);
    this.anim = null;
    this.ghosts = [];
    this.hidden.clear();
    this.free = freeCoinIds(state.coins);
    // Looks come from the game's seed, so both players see the same coins.
    const rng = mulberry32(state.seed ^ 0x9e3779b9);
    const count = Math.max(0, ...state.coins.map((c) => c.id + 1));
    this.rotation.clear();
    this.metal.clear();
    for (let id = 0; id < count; id++) {
      this.rotation.set(id, rng() * Math.PI * 2);
      this.metal.set(id, Math.floor(rng() * METAL_COUNT));
    }
  }

  /** True while a shot is playing (or waiting at its end for the server). */
  get animating(): boolean {
    return this.anim !== null;
  }

  get canAim(): boolean {
    if (this.state.status !== "playing" || this.anim !== null) return false;
    return this.controlledSeat === null || this.state.turn === this.controlledSeat;
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

  /** Show someone else's shot being lined up: `t` runs 0→1 as the pull draws back. */
  previewAim(shot: Shot, t: number): void {
    this.aim = this.aimFrom({ coinId: shot.coinId, angle: shot.angle, power: shot.power * t });
  }

  /** The other player's latest aim from the server, or null when they stop aiming. */
  setRemoteAim(update: AimUpdate | null): void {
    this.remoteTarget = update;
    if (!update) this.remoteShown = this.remoteAim = null;
  }

  /** An aim as if a finger were pulling back from the coin. */
  private aimFrom(u: AimUpdate): Aim | null {
    const c = this.state.coins.find((k) => k.id === u.coinId);
    if (!c) return null;
    const pull = COIN_RADIUS + u.power * MAX_DRAG;
    return { ...u, pointer: { x: c.x - Math.cos(u.angle) * pull, y: c.y - Math.sin(u.angle) * pull } };
  }

  fire(shot: Shot): void {
    this.aim = null;
    if (!legalShot(this.state, this.state.turn, shot)) return;
    const seq = this.state.shots;
    this.play(shot, null, true);
    this.onLocalShot(shot, seq);
  }

  /** Start playing a shot. Online, `auth` is the server's result when it's already known. */
  private play(shot: Shot, auth: Authoritative | null, mine: boolean): void {
    this.setRemoteAim(null); // the shot replaces whatever aim was showing
    const result = simulateShot(this.state, shot, this.physics, true);
    const pendingFalls = result.events.flatMap((e) => (e.type === "fall" ? [e] : []));
    this.anim = { shot, result, frame: 0, acc: 0, pendingFalls, auth, mine };
    this.onFire(shot);
  }

  /**
   * The server announced a shot. If it's ours coming back, attach the verdict to the animation
   * already playing. If it's the opponent's, animate it now. If we're out of step, just adopt
   * the server's position.
   */
  serverShot(msg: { seq: number; shot: Shot; state: GameState; outcome: ShotOutcome }): "played" | "snapped" {
    const auth = { state: msg.state, outcome: msg.outcome };
    const a = this.anim;
    if (a?.mine && this.state.shots === msg.seq && a.shot.coinId === msg.shot.coinId) {
      a.auth = auth;
      return "played";
    }
    if (!a && this.state.shots === msg.seq) {
      this.play(msg.shot, auth, false);
      return "played";
    }
    this.load(msg.state);
    return "snapped";
  }

  /** Advance playback. Returns true while anything is still moving. */
  update(dtSeconds: number, now: number): boolean {
    this.ghosts = this.ghosts.filter((g) => now - g.start < FALL_MS);
    let remoteMoving = false;
    if (this.remoteTarget) {
      const was = this.remoteShown;
      this.remoteShown = approachAim(was, this.remoteTarget, dtSeconds);
      this.remoteAim = this.aimFrom(this.remoteShown);
      remoteMoving = !was || !aimSettled(was, this.remoteTarget);
    }
    const anim = this.anim;
    if (!anim) return this.ghosts.length > 0 || remoteMoving;

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
      const due = anim.result.events.filter((e) => e.step >= before && e.step < anim.frame);
      if (due.length > 0) this.onSimEvents(due);
    }
    if (anim.frame >= frames.length && !(anim.mine && this.awaitServer && !anim.auth)) this.finish(anim);
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
      this.ghosts.push({ x: frame[i * 2], y: frame[i * 2 + 1], vx: f.vx, vy: f.vy, ...this.look(f.id), start: now });
      return false;
    });
  }

  private look(id: number): { rotation: number; metal: number } {
    return { rotation: this.rotation.get(id)!, metal: this.metal.get(id)! };
  }

  private finish(anim: Anim): void {
    const shooter = this.state.turn;
    const { state, outcome } = anim.auth ?? resolveShot(this.state, anim.shot, anim.result);
    let kept: Resolved["kept"] = null;
    if (outcome.captured !== null) {
      // Where the kept coin ended up on this device; fall back to where it started if we disagree.
      const t = anim.result.coins.find((c) => c.id === outcome.captured) ?? this.state.coins.find((c) => c.id === outcome.captured);
      if (t) kept = { x: t.x, y: t.y, metal: this.metal.get(t.id)! };
    }
    this.state = state;
    this.anim = null;
    this.hidden.clear();
    this.free = freeCoinIds(state.coins);
    this.onResolved({ shooter, outcome, kept });
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
