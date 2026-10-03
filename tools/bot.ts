import { COIN_RADIUS, CUP_RADIUS, MIN_POWER, type PhysicsConfig } from "../shared/constants";
import { isFree } from "../shared/rules";
import type { Coin, Cup, GameState, Shot } from "../shared/types";

/** Standard normal sample from a uniform rng (Box–Muller). */
export function gaussian(rng: () => number): number {
  const u = 1 - rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** True if a coin sliding from `from` to `to` wouldn't clip any other coin or cup on the way. */
export function clearPath(coins: readonly Coin[], cups: readonly Cup[], from: Coin, to: Coin): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len2 = dx * dx + dy * dy;
  const blocked = (x: number, y: number, reach: number) => {
    const t = Math.max(0, Math.min(1, ((x - from.x) * dx + (y - from.y) * dy) / len2));
    const px = from.x + dx * t - x;
    const py = from.y + dy * t - y;
    return px * px + py * py < reach * reach;
  };
  for (const c of coins) {
    if (c.id !== from.id && c.id !== to.id && blocked(c.x, c.y, COIN_RADIUS * 2)) return false;
  }
  return cups.every((cup) => !blocked(cup.x, cup.y, COIN_RADIUS + CUP_RADIUS));
}

/** Power needed for a coin to slide `distance` units before stopping. */
export function powerFor(distance: number, cfg: PhysicsConfig): number {
  const speed = Math.sqrt(2 * cfg.friction * distance);
  return Math.pow(speed / cfg.maxSpeed, 1 / cfg.powerExponent);
}

/**
 * A simple human stand-in for tuning: aim straight at a nearby coin with a clear line,
 * with aim and power error scaled by `noise` (radians of aim error, 1 SD).
 */
export function botShot(state: GameState, rng: () => number, noise: number, cfg: PhysicsConfig): Shot {
  // During a run of captures only the same coin may be shot.
  const free = state.coins.filter((c) => (state.shooter === null ? isFree(state.coins, c) : c.id === state.shooter));
  const options: { s: Coin; t: Coin; d: number }[] = [];
  for (const s of free) {
    for (const t of state.coins) {
      if (t.id !== s.id && clearPath(state.coins, state.cups, s, t)) {
        options.push({ s, t, d: Math.hypot(t.x - s.x, t.y - s.y) });
      }
    }
  }

  if (options.length === 0) {
    // Nothing lined up: flick something somewhere.
    const s = free[Math.floor(rng() * free.length)];
    return { coinId: s.id, angle: rng() * Math.PI * 2, power: 0.3 + rng() * 0.5 };
  }

  // People mostly take short, easy shots: pick among the closest few.
  options.sort((a, b) => a.d - b.d);
  const pick = options[Math.floor(rng() * Math.min(3, options.length))];
  const angle = Math.atan2(pick.t.y - pick.s.y, pick.t.x - pick.s.x) + gaussian(rng) * noise;
  const travel = pick.d - COIN_RADIUS * 2 + 80 + rng() * 200; // reach the target plus some follow-through
  const power = powerFor(travel, cfg) * (1 + gaussian(rng) * noise * 2);
  return { coinId: pick.s.id, angle, power: Math.min(1, Math.max(MIN_POWER, power)) };
}
