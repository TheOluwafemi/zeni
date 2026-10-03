// Who plays whom in Quick Match. Pure, so the fairness rules are easy to test.
//
// The player who has waited longest is served first and gets the closest rating among the others
// within a gap. The gap starts narrow and widens the longer they wait, so a strong player isn't
// thrown at a beginner straight away, but nobody waits long for lack of a "perfect" opponent.

export interface Waiting {
  id: string;
  rating: number;
  /** When they joined the queue (ms). */
  since: number;
}

export const BASE_GAP = 150;
/** The acceptable rating gap grows by this much per second of waiting... */
export const GAP_PER_SECOND = 30;
/** ...and disappears entirely after this long: anyone will do. */
export const ANYONE_AFTER_MS = 30_000;

/** How far apart in rating the longest-waiting player will accept an opponent. */
export function allowedGap(waitedMs: number): number {
  if (waitedMs >= ANYONE_AFTER_MS) return Infinity;
  return BASE_GAP + (GAP_PER_SECOND * waitedMs) / 1000;
}

/** Pair up as many waiting players as the rules allow. A player appears in at most one pair. */
export function pickPairs(queue: readonly Waiting[], now: number): [Waiting, Waiting][] {
  const byWait = [...queue].sort((a, b) => a.since - b.since || a.id.localeCompare(b.id));
  const taken = new Set<string>();
  const pairs: [Waiting, Waiting][] = [];

  for (const first of byWait) {
    if (taken.has(first.id)) continue;
    const gap = allowedGap(now - first.since);
    let best: Waiting | null = null;
    for (const other of byWait) {
      if (other.id === first.id || taken.has(other.id)) continue;
      const diff = Math.abs(other.rating - first.rating);
      if (diff <= gap && (best === null || diff < Math.abs(best.rating - first.rating))) best = other;
    }
    if (best) {
      taken.add(first.id);
      taken.add(best.id);
      pairs.push([first, best]);
    }
  }
  return pairs;
}

/** When to look again, if anyone is left waiting: the soonest moment a currently-too-far pair becomes acceptable. */
export function nextRetry(queue: readonly Waiting[], now: number): number | null {
  if (queue.length < 2) return null;
  return now + 2000; // simple and cheap: re-check every couple of seconds while two or more wait
}
