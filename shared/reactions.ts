// The reactions players can send each other online. Fixed phrases, so there's nothing to moderate.

export const REACTIONS = {
  nice: "Nice shot!",
  close: "So close",
  gg: "Good game",
  clap: "👏",
} as const;

export type ReactionId = keyof typeof REACTIONS;

export const isReactionId = (x: unknown): x is ReactionId => typeof x === "string" && Object.hasOwn(REACTIONS, x);

/** One reaction per player this often, at most. */
export const REACT_GAP_MS = 1500;
