// Avatars: a modern character in a colourful shirt, generated in code. No photos, ever.
//
// Online players get a look made from a number the server derives from their player id, so they
// always look the same and the id itself never leaves the server. The computer opponents are three
// fixed characters.

import { mulberry32 } from "./rng";

export const SKIN = ["#f6d7c3", "#eac0a0", "#d9a27a", "#bf8259", "#9a6440", "#6e4529"] as const;
export const HAIR_COLORS = ["#1f1a17", "#3b2618", "#6b3f22", "#a8692f", "#d9b06a", "#8c8c8c", "#c2462e", "#2f3f7a"] as const;
export const HAIR_STYLES = ["short", "curly", "bun", "long", "buzz", "sidepart", "afro"] as const;
export const PATTERNS = ["solid", "stripes", "dots", "floral", "geometric", "print"] as const;
/** Bright shirt colours. Each is also the player's colour for their aim line and coin stack. */
export const SHIRT_COLORS = ["#f2743c", "#2bb3a3", "#f2c230", "#e8547a", "#5b7cf0", "#8fcf4a", "#a66ee0", "#ef4b4b"] as const;
const ACCENTS = ["#fff4dc", "#24313f", "#ffd27a", "#ffffff", "#1d6b62"] as const;

export type HairStyle = (typeof HAIR_STYLES)[number];
export type Pattern = (typeof PATTERNS)[number];
export type Expression = "neutral" | "pleased" | "dismayed";

export interface Look {
  skin: string;
  hair: HairStyle;
  hairColor: string;
  glasses: boolean;
  cap: boolean;
  pattern: Pattern;
  shirt: string;
  accent: string;
}

/** A 32-bit number from a player id (FNV-1a). Enough to pick a look; can't be turned back into the id. */
export function lookSeed(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function lookFromSeed(seed: number): Look {
  const r = mulberry32(seed ^ 0x5eed1e55);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
  const hair = pick(HAIR_STYLES);
  return {
    skin: pick(SKIN),
    hair,
    hairColor: pick(HAIR_COLORS),
    glasses: r() < 0.3,
    cap: hair !== "bun" && hair !== "afro" && r() < 0.15,
    pattern: pick(PATTERNS),
    shirt: pick(SHIRT_COLORS),
    accent: pick(ACCENTS),
  };
}

export interface Character {
  name: string;
  /** Said before the game starts. */
  line: string;
  look: Look;
}

/** The computer opponents, one per level. */
export const CHARACTERS = {
  beginner: {
    name: "Kenta",
    line: "I just learned this yesterday. Go easy on me?",
    look: { skin: "#eac0a0", hair: "sidepart", hairColor: "#1f1a17", glasses: false, cap: false, pattern: "floral", shirt: "#f2743c", accent: "#fff4dc" },
  },
  skilled: {
    name: "Mei",
    line: "Best of luck. You'll need it.",
    look: { skin: "#f6d7c3", hair: "bun", hairColor: "#1f1a17", glasses: true, cap: false, pattern: "geometric", shirt: "#2bb3a3", accent: "#ffffff" },
  },
  master: {
    name: "Uncle Hiro",
    line: "I was flicking coins before you were born.",
    look: { skin: "#d9a27a", hair: "short", hairColor: "#8c8c8c", glasses: true, cap: false, pattern: "print", shirt: "#f2c230", accent: "#24313f" },
  },
} as const satisfies Record<"beginner" | "skilled" | "master", Character>;
