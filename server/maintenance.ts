// A small daily cleanup, run by a Cron Trigger. It's what makes the privacy page's promise true:
// short-lived records (which hold internet addresses) really are gone within a day or so.

import type { Db } from "./accounts";
import { dayOf } from "./stats";

const DAY = 24 * 60 * 60 * 1000;

/** Rate-limit counters are only useful for an hour; keep them for a day, then delete. */
export const RATE_LIMIT_KEEP_MS = DAY;
/** Crash reports older than this are no use for debugging today's build. */
export const ERROR_LOG_KEEP_DAYS = 90;

export async function maintenance(db: Db, now = Date.now()): Promise<void> {
  await db.prepare("DELETE FROM rate_limits WHERE window_start < ?1").bind(now - RATE_LIMIT_KEEP_MS).run();
  await db.prepare("DELETE FROM error_log WHERE day < ?1").bind(dayOf(now - ERROR_LOG_KEEP_DAYS * DAY)).run();
}
