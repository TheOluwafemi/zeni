// The daily puzzle: the same table for everyone each day. Keep as many coins as you can in three
// turns; a clean hit lets you go again with the same coin, as always. Coins that fall off are lost.
// No one needs to be online, and nothing is sent anywhere.

import { lookSeed } from "./avatar";
import { COIN_COUNT, type Difficulty } from "./constants";

/** Puzzle #1 was 1 October 2026 (UTC). A new one starts at midnight UTC, the same moment everywhere. */
const FIRST_DAY = Date.UTC(2026, 9, 1);
const DAY_MS = 24 * 60 * 60 * 1000;

export const DAILY_TURNS = 3;
export const DAILY_TABLE: Difficulty = "easy";

export function dailyNumber(now = Date.now()): number {
  return Math.floor((now - FIRST_DAY) / DAY_MS) + 1;
}

/** The table for a puzzle: the same seed for everyone. */
export function dailySeed(n: number): number {
  return lookSeed(`zeni-daily-${n}`);
}

/** "Zeni #27 · 5/14 🪙🪙🪙🪙🪙", to paste anywhere. */
export function shareLine(n: number, kept: number, total = COIN_COUNT): string {
  return `Zeni #${n} · ${kept}/${total} ${"🪙".repeat(kept) || "—"}`;
}
