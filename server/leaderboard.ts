// GET /api/leaderboard: the top 100 players who have played at least one online game.

import type { Db } from "./accounts";

export const LEADERBOARD_SIZE = 100;
/** How long a copy of the board may be reused, so a busy launch doesn't hammer the database. */
export const LEADERBOARD_TTL_SECONDS = 30;

export interface LeaderboardRow {
  /** Players on equal ratings share a rank, like a sports table (1, 2, 2, 4). */
  rank: number;
  nickname: string;
  rating: number;
  games: number;
}

export async function leaderboard(db: Db): Promise<LeaderboardRow[]> {
  const { results } = await db
    .prepare("SELECT nickname, rating, games FROM players WHERE games > 0 ORDER BY rating DESC, games DESC, nickname LIMIT ?1")
    .bind(LEADERBOARD_SIZE)
    .all<{ nickname: string; rating: number; games: number }>();

  let rank = 1;
  return results.map((row, i) => {
    if (i > 0 && row.rating !== results[i - 1].rating) rank = i + 1;
    return { rank, ...row };
  });
}

export async function handleLeaderboard(request: Request, url: URL, db: Db): Promise<Response | null> {
  if (url.pathname !== "/api/leaderboard" || request.method !== "GET") return null;
  return Response.json(
    { players: await leaderboard(db) },
    { headers: { "cache-control": `public, max-age=${LEADERBOARD_TTL_SECONDS}` } },
  );
}
