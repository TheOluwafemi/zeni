// Tier badges: a small coin in the tier's metal. The look is in style.css (.badge.tier-*).

import { nextTier, progressToNext, tierFor } from "../shared/tiers";

export function tierBadge(rating: number, size: "small" | "large" = "small"): HTMLElement {
  const tier = tierFor(rating);
  const el = document.createElement("span");
  el.className = `badge tier-${tier.id}${size === "large" ? " large" : ""}`;
  el.title = tier.name;
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", `${tier.name} tier`);
  return el;
}

/** "75 to Adept", or a note that there's nowhere higher to go. */
export function nextTierNote(rating: number): string {
  const next = nextTier(rating);
  return next ? `${Math.max(1, next.min - rating)} to ${next.name}` : "Top tier";
}

export { progressToNext, tierFor };
