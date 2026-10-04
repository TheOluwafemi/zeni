// Tiny anonymous counters, kept in a leaf module so any part of the server can use them.

import type { Db } from "./accounts";

/** UTC day, e.g. "2026-10-04". */
export const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Add one to today's count for `name`. No identifier is stored, just a number per day. */
export async function bump(db: Db, name: string, now = Date.now()): Promise<void> {
  await db
    .prepare("INSERT INTO daily_counters (day, name, count) VALUES (?1, ?2, 1) ON CONFLICT(day, name) DO UPDATE SET count = count + 1")
    .bind(dayOf(now), name)
    .run();
}

/** Note that a signed-in player was around today. Idempotent: one row per player per day. */
export async function markActive(db: Db, playerId: string, now = Date.now()): Promise<void> {
  await db.prepare("INSERT OR IGNORE INTO daily_active (day, player_id) VALUES (?1, ?2)").bind(dayOf(now), playerId).run();
}
