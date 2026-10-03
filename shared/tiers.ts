// Rank tiers: a label worked out from the Elo rating. Nothing is stored; change a threshold here and
// everyone's tier follows. Everyone starts at 1000, which is Amateur.

export interface Tier {
  id: "amateur" | "apprentice" | "adept" | "expert" | "master" | "legend";
  name: string;
  /** The lowest rating in this tier. */
  min: number;
}

/** Lowest to highest. The thresholds are starting guesses: after launch, look at the spread of ratings
 *  and adjust so that Legend stays rare. */
export const TIERS: readonly Tier[] = [
  { id: "amateur", name: "Amateur", min: 0 },
  { id: "apprentice", name: "Apprentice", min: 1100 },
  { id: "adept", name: "Adept", min: 1250 },
  { id: "expert", name: "Expert", min: 1400 },
  { id: "master", name: "Master", min: 1550 },
  { id: "legend", name: "Legend", min: 1700 },
];

export function tierIndex(rating: number): number {
  let index = 0;
  TIERS.forEach((t, i) => {
    if (rating >= t.min) index = i;
  });
  return index;
}

export function tierFor(rating: number): Tier {
  return TIERS[tierIndex(rating)];
}

export function nextTier(rating: number): Tier | null {
  return TIERS[tierIndex(rating) + 1] ?? null;
}

/** How far through the current tier a rating is, 0 to 1. Legend, with nowhere to go, is always 1. */
export function progressToNext(rating: number): number {
  const next = nextTier(rating);
  if (!next) return 1;
  // Amateur starts at 0 in the table, but the climb that matters starts from the 1000 everyone begins on.
  const floor = tierIndex(rating) === 0 ? 1000 : tierFor(rating).min;
  return Math.min(1, Math.max(0, (rating - floor) / (next.min - floor)));
}

/** What changed between two ratings: a promotion, a demotion, or neither. */
export function tierChange(before: number, after: number): "up" | "down" | "same" {
  const a = tierIndex(before);
  const b = tierIndex(after);
  return b > a ? "up" : b < a ? "down" : "same";
}
