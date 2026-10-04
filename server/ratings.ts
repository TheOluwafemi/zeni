// Recording a finished online game: Elo for both players, win/loss counts, and a match row.

import { eloChange } from "../shared/elo";
import type { OverReason } from "../shared/protocol";
import type { Seat } from "../shared/types";
import type { Db } from "./accounts";

export interface RatingResult {
  before: [number, number];
  after: [number, number];
}

/** Why a game didn't move ratings. */
export type Unrated = { unrated: "short" | "repeat" };

/** Games shorter than this many shots aren't rated: an instant resignation proves nothing. */
export const MIN_RATED_SHOTS = 2;
/** The same two players get at most this many rated games in a day; more are friendlies. */
export const PAIR_RATED_PER_DAY = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Update both players and log the match in one atomic batch. Returns the ratings before and after,
 * null if either player no longer exists, or why the game wasn't rated.
 *
 * Not every game is rated, so a second account can't feed rating to a main one: games of fewer than
 * MIN_RATED_SHOTS shots, and beyond PAIR_RATED_PER_DAY rated games between the same two players in a
 * day. Those are still logged (rated = 0) but don't change ratings or win/loss records.
 */
export async function recordResult(
  db: Db,
  players: [string, string],
  scores: [number, number],
  winner: Seat | "draw",
  reason: OverReason,
  now = Date.now(),
  matchId: string = crypto.randomUUID(),
  startedAt: number | null = null,
  shots: number | null = null,
): Promise<RatingResult | Unrated | null> {
  const read = (id: string) => db.prepare("SELECT rating FROM players WHERE id = ?1").bind(id).first<{ rating: number }>();
  const [a, b] = await Promise.all([read(players[0]), read(players[1])]);
  if (!a || !b) return null;

  const logUnrated = async (why: Unrated["unrated"]): Promise<Unrated> => {
    await db
      .prepare("INSERT INTO matches (id, p0, p1, score0, score1, winner, reason, created_at, started_at, rated) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0)")
      .bind(matchId, players[0], players[1], scores[0], scores[1], winner === "draw" ? null : players[winner], reason, now, startedAt)
      .run();
    return { unrated: why };
  };
  if (shots !== null && shots < MIN_RATED_SHOTS) return logUnrated("short");
  const recent = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM matches WHERE rated = 1 AND created_at > ?3
         AND ((p0 = ?1 AND p1 = ?2) OR (p0 = ?2 AND p1 = ?1))`,
    )
    .bind(players[0], players[1], now - DAY_MS)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= PAIR_RATED_PER_DAY) return logUnrated("repeat");

  const resultForFirst = winner === "draw" ? 0.5 : winner === 0 ? 1 : 0;
  const delta = eloChange(a.rating, b.rating, resultForFirst);

  // Relative updates (rating = rating + ?) so a game finishing elsewhere at the same moment isn't overwritten.
  const update = (id: string, change: number, win: number, loss: number, draw: number) =>
    db
      .prepare(
        `UPDATE players SET rating = rating + ?1, games = games + 1,
           wins = wins + ?2, losses = losses + ?3, draws = draws + ?4, updated_at = ?5 WHERE id = ?6`,
      )
      .bind(change, win, loss, draw, now, id);

  const draw = winner === "draw" ? 1 : 0;
  await db.batch([
    update(players[0], delta, winner === 0 ? 1 : 0, winner === 1 ? 1 : 0, draw),
    update(players[1], -delta, winner === 1 ? 1 : 0, winner === 0 ? 1 : 0, draw),
    db
      .prepare("INSERT INTO matches (id, p0, p1, score0, score1, winner, reason, created_at, started_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)")
      .bind(matchId, players[0], players[1], scores[0], scores[1], winner === "draw" ? null : players[winner], reason, now, startedAt),
  ]);

  return { before: [a.rating, b.rating], after: [a.rating + delta, b.rating - delta] };
}
