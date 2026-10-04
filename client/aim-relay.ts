// Live aim in online games: sending your own aim without flooding the room, and smoothing the
// opponent's so 8 updates a second still look fluid. No DOM here, so it can be tested in Node.

export interface AimUpdate {
  coinId: number;
  angle: number;
  power: number;
}

export interface Clock {
  now(): number;
  later(fn: () => void, ms: number): unknown;
  cancel(handle: unknown): void;
}

const realClock: Clock = {
  now: () => performance.now(),
  later: (fn, ms) => setTimeout(fn, ms),
  cancel: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** Sends at most one update per `gapMs`, always including the latest (a trailing send). */
export class AimThrottle {
  private lastSent = -Infinity;
  private pending: AimUpdate | null = null;
  private timer: unknown = null;

  constructor(
    private readonly send: (aim: AimUpdate) => void,
    private readonly gapMs: number,
    private readonly clock: Clock = realClock,
  ) {}

  update(aim: AimUpdate): void {
    const wait = this.lastSent + this.gapMs - this.clock.now();
    if (wait <= 0) return this.flush(aim);
    this.pending = aim;
    this.timer ??= this.clock.later(() => {
      this.timer = null;
      if (this.pending) this.flush(this.pending);
    }, wait);
  }

  /** Aiming stopped: forget anything not yet sent. */
  stop(): void {
    if (this.timer !== null) this.clock.cancel(this.timer);
    this.timer = null;
    this.pending = null;
  }

  private flush(aim: AimUpdate): void {
    this.pending = null;
    this.lastSent = this.clock.now();
    this.send(aim);
  }
}

/** Move the shown aim part of the way to the latest update. A different coin jumps straight there. */
export function approachAim(shown: AimUpdate | null, target: AimUpdate, dtSeconds: number): AimUpdate {
  if (!shown || shown.coinId !== target.coinId) return { ...target };
  const k = 1 - Math.exp(-dtSeconds * 18); // about 90% of the way in 125ms, one update's gap
  let turn = target.angle - shown.angle;
  turn = Math.atan2(Math.sin(turn), Math.cos(turn)); // the short way round
  return { coinId: target.coinId, angle: shown.angle + turn * k, power: shown.power + (target.power - shown.power) * k };
}

/** Close enough to stop redrawing. */
export function aimSettled(shown: AimUpdate, target: AimUpdate): boolean {
  const turn = Math.atan2(Math.sin(target.angle - shown.angle), Math.cos(target.angle - shown.angle));
  return shown.coinId === target.coinId && Math.abs(turn) < 0.002 && Math.abs(target.power - shown.power) < 0.002;
}
