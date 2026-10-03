/** Elo rating change for player A. B's change is the exact opposite, so rating is conserved. */
export function eloChange(ratingA: number, ratingB: number, resultForA: 1 | 0.5 | 0, k = 32): number {
  const expected = 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
  return Math.round(k * (resultForA - expected));
}
