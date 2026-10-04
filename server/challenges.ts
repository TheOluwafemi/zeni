// Challenges and recent opponents: "Bea challenged you" and "Play Bea again".
//
// A challenge opens a room reserved for the two players straight away. Both see it on Home: the
// challenged player can play or say no thanks, the challenger can open the room or cancel. The game
// starts once both are in the room, and the room marks the challenge as started.
//
// Players are named by nickname (already public on the leaderboard), so player ids never leave the
// server.

import { ROOM_IDLE_MS } from "../shared/protocol";
import { authenticate, allow, type Db, type Player } from "./accounts";

/** A challenge lasts a little less than an unused room, so its room is always still there. */
export const CHALLENGE_MS = ROOM_IDLE_MS - 5 * 60_000;
/** After someone says no thanks, the same player can't challenge them again for this long. */
export const DECLINED_COOLDOWN_MS = 24 * 3600_000;
/** Open challenges one player may have sent at once. */
export const MAX_OUTGOING = 5;
export const CHALLENGE_LIMIT = [20, 3600] as const; // new challenges per player per hour
const RECENT_DAYS = 30;
const RECENT_COUNT = 5;

/** Opens a room reserved for two players. False if that code is taken. */
export type OpenRoom = (code: string, table: "easy" | "hard", players: [string, string]) => Promise<boolean>;

const json = (body: unknown, status = 200): Response => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const fail = (status: number, error: string): Response => json({ error }, status);

interface Row {
  id: string;
  room: string;
  table_kind: "easy" | "hard";
  status: string;
  expires_at: number;
  nickname: string;
  rating: number;
}

const view = (r: Row, now: number, who: "from" | "to") => ({
  id: r.id,
  room: r.room,
  table: r.table_kind,
  status: r.status as "open" | "accepted",
  expiresIn: Math.max(0, r.expires_at - now),
  [who]: { nickname: r.nickname, rating: r.rating },
});

/** Returns a Response for challenge and opponent routes, or null if the path isn't one of them. */
export async function handleChallenges(
  request: Request,
  url: URL,
  db: Db,
  openRoom: OpenRoom,
  newRoomCode: () => string,
  now = Date.now(),
): Promise<Response | null> {
  const { pathname } = url;
  const method = request.method;
  if (!pathname.startsWith("/api/challenges") && pathname !== "/api/me/challenges" && pathname !== "/api/me/opponents") return null;
  const me = await authenticate(db, request.headers.get("Authorization"));
  if (!me) return fail(401, "unauthorized");

  // GET /api/me/challenges → open challenges to and from me
  if (pathname === "/api/me/challenges" && method === "GET") {
    const incoming = await db
      .prepare(
        `SELECT c.id, c.room, c.table_kind, c.status, c.expires_at, p.nickname, p.rating
         FROM challenges c JOIN players p ON p.id = c.from_id
         WHERE c.to_id = ?1 AND c.status IN ('open', 'accepted') AND c.expires_at > ?2
         ORDER BY c.created_at DESC`,
      )
      .bind(me.id, now)
      .all<Row>();
    const outgoing = await db
      .prepare(
        `SELECT c.id, c.room, c.table_kind, c.status, c.expires_at, p.nickname, p.rating
         FROM challenges c JOIN players p ON p.id = c.to_id
         WHERE c.from_id = ?1 AND c.status IN ('open', 'accepted') AND c.expires_at > ?2
         ORDER BY c.created_at DESC`,
      )
      .bind(me.id, now)
      .all<Row>();
    return json({
      incoming: incoming.results.map((r) => view(r, now, "from")),
      outgoing: outgoing.results.map((r) => view(r, now, "to")),
    });
  }

  // GET /api/me/opponents → the last few people I played, with my record against each
  if (pathname === "/api/me/opponents" && method === "GET") {
    const rows = await db
      .prepare(
        `SELECT p.nickname, p.rating,
                MAX(m.created_at) AS last_at,
                SUM(CASE WHEN m.winner = ?1 THEN 1 ELSE 0 END) AS wins,
                SUM(CASE WHEN m.winner = p.id THEN 1 ELSE 0 END) AS losses,
                SUM(CASE WHEN m.winner IS NULL THEN 1 ELSE 0 END) AS draws
         FROM matches m
         JOIN players p ON p.id = CASE WHEN m.p0 = ?1 THEN m.p1 ELSE m.p0 END
         WHERE (m.p0 = ?1 OR m.p1 = ?1) AND m.created_at > ?2
         GROUP BY p.id
         ORDER BY last_at DESC
         LIMIT ?3`,
      )
      .bind(me.id, now - RECENT_DAYS * 24 * 3600_000, RECENT_COUNT)
      .all<{ nickname: string; rating: number; last_at: number; wins: number; losses: number; draws: number }>();
    return json({
      opponents: rows.results.map((r) => ({ nickname: r.nickname, rating: r.rating, lastPlayed: r.last_at, record: { wins: r.wins, losses: r.losses, draws: r.draws } })),
    });
  }

  // POST /api/challenges {to: nickname, table} → a new challenge (or the one already open to them)
  if (pathname === "/api/challenges" && method === "POST") {
    const body = (await request.json().catch(() => null)) as { to?: unknown; table?: unknown } | null;
    const table = body?.table === "hard" ? "hard" : "easy";
    if (typeof body?.to !== "string" || body.to.length > 32) return fail(400, "unknown_player");
    const them = await db.prepare("SELECT id, nickname, rating FROM players WHERE nickname = ?1").bind(body.to).first<Pick<Player, "id" | "nickname" | "rating">>();
    if (!them) return fail(404, "unknown_player");
    if (them.id === me.id) return fail(400, "self");

    const existing = await db
      .prepare(
        `SELECT c.id, c.room, c.table_kind, c.status, c.expires_at, p.nickname, p.rating FROM challenges c JOIN players p ON p.id = c.to_id
         WHERE c.from_id = ?1 AND c.to_id = ?2 AND c.status IN ('open', 'accepted') AND c.expires_at > ?3`,
      )
      .bind(me.id, them.id, now)
      .first<Row>();
    if (existing) return json(view(existing, now, "to"));

    const declined = await db
      .prepare("SELECT 1 AS x FROM challenges WHERE from_id = ?1 AND to_id = ?2 AND status = 'declined' AND created_at > ?3")
      .bind(me.id, them.id, now - DECLINED_COOLDOWN_MS)
      .first();
    if (declined) return fail(409, "declined_recently");
    const open = await db
      .prepare("SELECT COUNT(*) AS n FROM challenges WHERE from_id = ?1 AND status IN ('open', 'accepted') AND expires_at > ?2")
      .bind(me.id, now)
      .first<{ n: number }>();
    if ((open?.n ?? 0) >= MAX_OUTGOING) return fail(409, "too_many");
    if (!(await allow(db, `challenge:${me.id}`, CHALLENGE_LIMIT, now))) return fail(429, "rate_limited");

    let room: string | null = null;
    for (let attempt = 0; attempt < 3 && !room; attempt++) {
      const code = newRoomCode();
      if (await openRoom(code, table, [me.id, them.id])) room = code;
    }
    if (!room) return fail(503, "no_room");

    const id = crypto.randomUUID();
    await db
      .prepare("INSERT INTO challenges (id, from_id, to_id, room, table_kind, status, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, 'open', ?6, ?7)")
      .bind(id, me.id, them.id, room, table, now, now + CHALLENGE_MS)
      .run();
    return json({ id, room, table, status: "open", expiresIn: CHALLENGE_MS, to: { nickname: them.nickname, rating: them.rating } }, 201);
  }

  // POST /api/challenges/:id/accept (the challenged player) → the room to join
  // POST /api/challenges/:id/decline (the challenged player) → no thanks
  // DELETE /api/challenges/:id (the challenger) → cancel
  const m = pathname.match(/^\/api\/challenges\/([0-9a-f-]{36})(\/accept|\/decline)?$/);
  if (!m) return fail(404, "not_found");
  const [, id, action] = m;
  const c = await db
    .prepare("SELECT from_id, to_id, room, status, expires_at FROM challenges WHERE id = ?1")
    .bind(id)
    .first<{ from_id: string; to_id: string; room: string; status: string; expires_at: number }>();
  const live = c && (c.status === "open" || c.status === "accepted") && c.expires_at > now;

  if (method === "POST" && (action === "/accept" || action === "/decline")) {
    if (!c || c.to_id !== me.id) return fail(404, "not_found");
    if (!live) return fail(410, "expired");
    await db.prepare("UPDATE challenges SET status = ?1 WHERE id = ?2").bind(action === "/accept" ? "accepted" : "declined", id).run();
    return json(action === "/accept" ? { room: c.room } : { ok: true });
  }
  if (method === "DELETE" && !action) {
    if (!c || c.from_id !== me.id) return fail(404, "not_found");
    if (live) await db.prepare("UPDATE challenges SET status = 'cancelled' WHERE id = ?1").bind(id).run();
    return json({ ok: true });
  }
  return fail(404, "not_found");
}

/** A room's game began: its challenge is done and leaves both players' lists. */
export async function challengeStarted(db: Db, room: string): Promise<void> {
  await db.prepare("UPDATE challenges SET status = 'started' WHERE room = ?1 AND status IN ('open', 'accepted')").bind(room).run();
}
