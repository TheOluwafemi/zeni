// Recording a finished online game: Elo for both players, win/loss counts, and a match row.

import { eloChange } from "../shared/elo";
import type { OverReason } from "../shared/protocol";
import type { Seat } from "../shared/types";
import type { Db } from "./accounts";

export interface RatingResult {
  before: [number, number];
  after: [number, number];
}

/**
 * Update both players and log the match in one atomic batch. Returns the ratings before and after,
 * or null if either player no longer exists. Every online game counts, however it ended.
 */
export async function recordResult(
  db: Db,
  players: [string, string],
  scores: [number, number],
  winner: Seat | "draw",
  reason: OverReason,
  now = Date.now(),
  matchId: string = crypto.randomUUID(),
): Promise<RatingResult | null> {
  const read = (id: string) => db.prepare("SELECT rating FROM players WHERE id = ?1").bind(id).first<{ rating: number }>();
  const [a, b] = await Promise.all([read(players[0]), read(players[1])]);
  if (!a || !b) return null;

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
      .prepare("INSERT INTO matches (id, p0, p1, score0, score1, winner, reason, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)")
      .bind(matchId, players[0], players[1], scores[0], scores[1], winner === "draw" ? null : players[winner], reason, now),
  ]);

  return { before: [a.rating, b.rating], after: [a.rating + delta, b.rating - delta] };
}
