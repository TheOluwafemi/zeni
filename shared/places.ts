// Places: where the table stands. Each is a painted backdrop, a floor, a table finish and the colour
// of the light, all drawn in code. Reaching a rank tier unlocks its place. Cosmetic only: the game is
// the same everywhere, and each player sees the place they picked.

import { TIERS, tierIndex, type Tier } from "./tiers";

export interface Place {
  id: "kitchen" | "cafe";
  name: string;
  /** Unlocked on reaching this tier. */
  tier: Tier["id"];
}

export const PLACES: readonly Place[] = [
  { id: "kitchen", name: "Kitchen", tier: "amateur" },
  { id: "cafe", name: "Café", tier: "apprentice" },
];

export type PlaceId = Place["id"];

/** Whether a player with this rating (or no player yet: null) has reached a place's tier. */
export function unlocked(place: Place, rating: number | null): boolean {
  const need = TIERS.findIndex((t) => t.id === place.tier);
  return need <= (rating === null ? 0 : tierIndex(rating));
}

/** The place to show: the one picked, if it's still unlocked, else the first. */
export function placeFor(picked: string | null, rating: number | null): Place {
  const p = PLACES.find((x) => x.id === picked);
  return p && unlocked(p, rating) ? p : PLACES[0];
}
