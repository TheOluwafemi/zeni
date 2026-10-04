// The launch numbers, read from tables the app already keeps. Used by `npm run report`.

import type { Db } from "./accounts";
import { dayOf } from "./stats";

export interface DayRow {
  day: string;
  /** Anonymous app opens. */
  opens: number;
  /** Signed-in players seen that day. */
  activePlayers: number;
  newPlayers: number;
  computerGames: number;
  /** Online games that began, by how the players met. */
  startedQuick: number;
  startedFriend: number;
  /** Online games that finished, however they ended. */
  finished: number;
  /** Average length of finished games, in minutes, or null if none had a recorded start. */
  avgMinutes: number | null;
}

export interface Report {
  totals: { players: number; playersWhoPlayedOnline: number; onlineGames: number; feedback: number };
  /** Newest day first. */
  days: DayRow[];
  /** How finished online games ended. */
  endings: { reason: string; count: number }[];
  /** The most frequent errors in the window, newest build last seen. */
  errors: { source: string; message: string; count: number; lastAt: number; version: string | null; screen: string | null }[];
  feedback: { at: number; nickname: string | null; message: string; contact: string | null; version: string | null; screen: string | null }[];
}

const num = (v: unknown): number => Number(v ?? 0);

async function all<T>(db: Db, sql: string, ...values: unknown[]): Promise<T[]> {
  return (await db.prepare(sql).bind(...values).all<T>()).results;
}

export async function report(db: Db, { days = 14, feedbackCount = 20, now = Date.now() } = {}): Promise<Report> {
  const since = dayOf(now - (days - 1) * 86_400_000);
  const sinceMs = Date.parse(`${since}T00:00:00Z`);

  const [counters, active, joined, finished] = await Promise.all([
    all<{ day: string; name: string; count: number }>(db, "SELECT day, name, count FROM daily_counters WHERE day >= ?1", since),
    all<{ day: string; n: number }>(db, "SELECT day, COUNT(*) AS n FROM daily_active WHERE day >= ?1 GROUP BY day", since),
    all<{ day: string; n: number }>(
      db,
      "SELECT date(created_at / 1000, 'unixepoch') AS day, COUNT(*) AS n FROM players WHERE created_at >= ?1 GROUP BY day",
      sinceMs,
    ),
    all<{ day: string; n: number; avg_minutes: number | null }>(
      db,
      `SELECT date(created_at / 1000, 'unixepoch') AS day, COUNT(*) AS n,
              AVG(CASE WHEN started_at IS NOT NULL THEN (created_at - started_at) / 60000.0 END) AS avg_minutes
         FROM matches WHERE created_at >= ?1 GROUP BY day`,
      sinceMs,
    ),
  ]);

  const rows: DayRow[] = [];
  for (let i = 0; i < days; i++) {
    const day = dayOf(now - i * 86_400_000);
    const count = (name: string) => num(counters.find((c) => c.day === day && c.name === name)?.count);
    const fin = finished.find((f) => f.day === day);
    rows.push({
      day,
      opens: count("open"),
      activePlayers: num(active.find((a) => a.day === day)?.n),
      newPlayers: num(joined.find((j) => j.day === day)?.n),
      computerGames: count("computer_game"),
      startedQuick: count("game_start_quick"),
      startedFriend: count("game_start_friend"),
      finished: num(fin?.n),
      avgMinutes: fin?.avg_minutes == null ? null : Math.round(Number(fin.avg_minutes) * 10) / 10,
    });
  }

  const one = async (sql: string) => num(Object.values((await db.prepare(sql).bind().first<Record<string, unknown>>()) ?? {})[0]);

  const errors = await all<{ source: string; message: string; count: number; last_at: number; version: string | null; screen: string | null }>(
    db,
    `SELECT source, message, SUM(count) AS count, MAX(last_at) AS last_at, MAX(version) AS version, MAX(screen) AS screen
       FROM error_log WHERE day >= ?1 GROUP BY fingerprint ORDER BY count DESC, last_at DESC LIMIT 15`,
    since,
  );
  const feedback = await all<{ at: number; nickname: string | null; message: string; contact: string | null; version: string | null; screen: string | null }>(
    db,
    "SELECT at, nickname, message, contact, version, screen FROM feedback ORDER BY at DESC LIMIT ?1",
    feedbackCount,
  );

  return {
    totals: {
      players: await one("SELECT COUNT(*) FROM players"),
      playersWhoPlayedOnline: await one("SELECT COUNT(*) FROM players WHERE games > 0"),
      onlineGames: await one("SELECT COUNT(*) FROM matches"),
      feedback: await one("SELECT COUNT(*) FROM feedback"),
    },
    days: rows,
    endings: (await all<{ reason: string; n: number }>(db, "SELECT reason, COUNT(*) AS n FROM matches GROUP BY reason ORDER BY n DESC, reason")).map((e) => ({
      reason: e.reason,
      count: num(e.n),
    })),
    errors: errors.map((e) => ({ source: e.source, message: e.message, count: num(e.count), lastAt: num(e.last_at), version: e.version, screen: e.screen })),
    feedback,
  };
}
