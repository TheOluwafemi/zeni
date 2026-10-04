// "Who's around right now", kept in memory only. Each open copy of the app pings with a random id
// made fresh for that tab; nothing ties it to a player, and nothing is written to storage.

import type { Difficulty } from "../shared/constants";

/** Someone counts as online if they pinged within this window (the app pings every 30 seconds). */
export const ONLINE_WINDOW_MS = 90_000;
/** A ceiling on how many tabs are tracked, so a flood of fake ids can't exhaust memory. */
export const MAX_TRACKED = 50_000;
const PRUNE_EVERY_MS = 5_000;

export interface PresenceInfo {
  /** Open copies of the app in the last 90 seconds. */
  online: number;
  /** Players waiting in Quick Match right now, by table. */
  searching: Record<Difficulty, number>;
}

export const isSessionId = (id: unknown): id is string => typeof id === "string" && /^[A-Za-z0-9-]{8,40}$/.test(id);

export class PresenceBook {
  private seen = new Map<string, number>();
  private searching: Record<Difficulty, number> = { easy: 0, hard: 0 };
  private lastPrune = 0;

  ping(session: unknown, now: number): PresenceInfo {
    if (isSessionId(session) && (this.seen.has(session) || this.seen.size < MAX_TRACKED)) this.seen.set(session, now);
    this.prune(now);
    return this.info(now);
  }

  setSearching(table: Difficulty, count: number): void {
    this.searching[table] = Math.max(0, Math.floor(count));
  }

  info(now: number): PresenceInfo {
    this.prune(now);
    return { online: this.seen.size, searching: { ...this.searching } };
  }

  private prune(now: number): void {
    if (now - this.lastPrune < PRUNE_EVERY_MS) return;
    this.lastPrune = now;
    for (const [id, at] of this.seen) if (now - at > ONLINE_WINDOW_MS) this.seen.delete(id);
  }
}
