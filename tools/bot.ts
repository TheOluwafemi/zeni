import { COIN_RADIUS, MIN_POWER, type PhysicsConfig } from "../shared/constants";
import { clearPath, gaussian, powerFor, shootable } from "../shared/ai";
import type { Coin, GameState, Shot } from "../shared/types";

/**
 * A simple human stand-in for tuning: aim straight at a nearby coin with a clear line,
 * with aim and power error scaled by `noise` (radians of aim error, 1 SD).
 * Deliberately simpler than the real AI so tuning numbers stay comparable.
 */
export function botShot(state: GameState, rng: () => number, noise: number, cfg: PhysicsConfig): Shot {
  const free = shootable(state);
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
