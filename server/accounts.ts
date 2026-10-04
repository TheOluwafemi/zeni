// Account endpoints: nickname + secret player code. No passwords, no email, no personal data.
//
// A nickname is a public label picked when a player is created; it never signs anyone in.
// The player code is the secret. The device stores it and sends it as `Authorization: Bearer <code>`.

import { formatCode, hashCode, newCode, normalizeCode, validateNickname } from "./auth";
import { markActive } from "./stats";
import { readJson } from "./http";

/** The slice of D1 this file uses. Declared here so tests can supply a SQLite stand-in. */
export interface Db {
  prepare(sql: string): Stmt;
  /** Run statements together: all take effect or none do. */
  batch(statements: Stmt[]): Promise<unknown[]>;
}
export interface Stmt {
  bind(...values: unknown[]): Stmt;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

export interface Player {
  id: string;
  nickname: string;
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
}

const PLAYER_COLUMNS = "id, nickname, rating, games, wins, losses, draws";

const json = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });
const fail = (status: number, error: string, extra: Record<string, unknown> = {}): Response =>
  json({ error, ...extra }, status);

// --- Rate limits ------------------------------------------------------------

/** Abuse limits as [max requests, window in seconds]. */
export const LIMITS = {
  register: [10, 3600], // new players per IP per hour
  restore: [5, 900], // code guesses per IP per 15 minutes
  nicknameCheck: [120, 600], // live "is this name free?" lookups per IP per 10 minutes
  rename: [10, 3600], // per player
  rotate: [5, 3600], // per player
} as const;

/** Count this request against `key`. True if it's within the limit. One atomic statement. */
export async function allow(db: Db, key: string, [limit, windowSec]: readonly [number, number], now = Date.now()): Promise<boolean> {
  const windowMs = windowSec * 1000;
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN window_start <= ?3 THEN 1 ELSE count + 1 END,
         window_start = CASE WHEN window_start <= ?3 THEN ?2 ELSE window_start END
       RETURNING count`,
    )
    .bind(key, now, now - windowMs)
    .first<{ count: number }>();
  return row !== null && row.count <= limit;
}

async function prune(db: Db, now = Date.now()): Promise<void> {
  await db.prepare("DELETE FROM rate_limits WHERE window_start < ?1").bind(now - 24 * 3600 * 1000).run();
}

// --- Auth -------------------------------------------------------------------

/** The player who owns this player code (any pasted form), or null. */
export async function playerForCode(db: Db, raw: string): Promise<Player | null> {
  const code = normalizeCode(raw);
  if (!code) return null;
  return db
    .prepare(`SELECT ${PLAYER_COLUMNS} FROM players WHERE code_hash = ?1`)
    .bind(await hashCode(code))
    .first<Player>();
}

/** The player whose code is in the Authorization header, or null. */
export function authenticate(db: Db, header: string | null): Promise<Player | null> {
  return playerForCode(db, header?.match(/^Bearer\s+(.+)$/i)?.[1] ?? "");
}

const isUniqueViolation = (e: unknown) => String((e as Error)?.message ?? e).includes("UNIQUE constraint failed");

async function nicknameTaken(db: Db, nickname: string): Promise<boolean> {
  const row = await db.prepare("SELECT 1 AS x FROM players WHERE nickname = ?1").bind(nickname).first();
  return row !== null;
}

// --- Routes -----------------------------------------------------------------

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  const body = await readJson(request);
  return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
}

/** Returns a Response for account routes, or null if the path isn't one of them. */
export async function handleAccounts(
  request: Request,
  url: URL,
  db: Db,
  waitUntil: (p: Promise<unknown>) => void = () => {},
): Promise<Response | null> {
  const { pathname } = url;
  const method = request.method;
  const ip = request.headers.get("CF-Connecting-IP") ?? "local";

  if (!pathname.startsWith("/api/register") && !pathname.startsWith("/api/restore") && !pathname.startsWith("/api/nickname/") && !pathname.startsWith("/api/me")) {
    return null;
  }
  if (Math.random() < 0.02) waitUntil(prune(db)); // keep the counters table small

  // POST /api/register {nickname} → a new player and their code
  if (pathname === "/api/register" && method === "POST") {
    if (!(await allow(db, `register:${ip}`, LIMITS.register))) return fail(429, "rate_limited");
    const nickname = (await readBody(request))?.nickname;
    if (typeof nickname !== "string") return fail(400, "invalid_nickname", { reason: "length" });
    const check = validateNickname(nickname);
    if (!check.ok) return fail(400, "invalid_nickname", { reason: check.reason });

    const code = newCode();
    const id = crypto.randomUUID();
    const now = Date.now();
    try {
      await db
        .prepare("INSERT INTO players (id, nickname, code_hash, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)")
        .bind(id, nickname, await hashCode(code), now)
        .run();
    } catch (e) {
      if (isUniqueViolation(e)) return fail(409, "nickname_taken");
      throw e;
    }
    return json({ playerId: id, nickname, code: formatCode(code) }, 201);
  }

  // POST /api/restore {code} → this device becomes that player
  if (pathname === "/api/restore" && method === "POST") {
    if (!(await allow(db, `restore:${ip}`, LIMITS.restore))) return fail(429, "rate_limited");
    const raw = (await readBody(request))?.code;
    const code = typeof raw === "string" ? normalizeCode(raw) : null;
    if (!code) return fail(404, "unknown_code");
    const player = await db
      .prepare(`SELECT ${PLAYER_COLUMNS} FROM players WHERE code_hash = ?1`)
      .bind(await hashCode(code))
      .first<Player>();
    if (!player) return fail(404, "unknown_code");
    return json({ playerId: player.id, nickname: player.nickname, code: formatCode(code) });
  }

  // GET /api/nickname/:n → is this name free? (for the live check while typing)
  if (pathname.startsWith("/api/nickname/") && method === "GET") {
    if (!(await allow(db, `nick:${ip}`, LIMITS.nicknameCheck))) return fail(429, "rate_limited");
    const nickname = decodeURIComponent(pathname.slice("/api/nickname/".length));
    const check = validateNickname(nickname);
    if (!check.ok) return json({ available: false, reason: check.reason });
    return (await nicknameTaken(db, nickname)) ? json({ available: false, reason: "taken" }) : json({ available: true });
  }

  // Everything below needs a signed-in player.
  if (!pathname.startsWith("/api/me")) return null;
  const me = await authenticate(db, request.headers.get("Authorization"));
  if (!me) return fail(401, "unauthorized");

  // GET /api/me
  if (pathname === "/api/me" && method === "GET") {
    waitUntil(markActive(db, me.id).catch(() => {})); // counts the player as active today
    // Position on the leaderboard: players with games, ranked by rating. Null until you've played.
    const position =
      me.games > 0
        ? ((await db.prepare("SELECT COUNT(*) + 1 AS position FROM players WHERE games > 0 AND rating > ?1").bind(me.rating).first<{ position: number }>())?.position ?? null)
        : null;
    return json({ playerId: me.id, nickname: me.nickname, rating: me.rating, games: me.games, wins: me.wins, losses: me.losses, draws: me.draws, position });
  }

  // DELETE /api/me: erase this player. Finished games stay (so the numbers add up) but lose their names.
  if (pathname === "/api/me" && method === "DELETE") {
    await db.batch([
      db.prepare("UPDATE matches SET winner = 'deleted' WHERE winner = ?1").bind(me.id),
      db.prepare("UPDATE matches SET p0 = 'deleted' WHERE p0 = ?1").bind(me.id),
      db.prepare("UPDATE matches SET p1 = 'deleted' WHERE p1 = ?1").bind(me.id),
      db.prepare("UPDATE feedback SET player_id = NULL, nickname = NULL WHERE player_id = ?1").bind(me.id),
      db.prepare("DELETE FROM daily_active WHERE player_id = ?1").bind(me.id),
      db.prepare("DELETE FROM challenges WHERE from_id = ?1 OR to_id = ?1").bind(me.id),
      db.prepare("DELETE FROM players WHERE id = ?1").bind(me.id),
    ]);
    return json({ ok: true });
  }

  // PUT /api/me/nickname {nickname}
  if (pathname === "/api/me/nickname" && method === "PUT") {
    if (!(await allow(db, `rename:${me.id}`, LIMITS.rename))) return fail(429, "rate_limited");
    const nickname = (await readBody(request))?.nickname;
    if (typeof nickname !== "string") return fail(400, "invalid_nickname", { reason: "length" });
    const check = validateNickname(nickname);
    if (!check.ok) return fail(400, "invalid_nickname", { reason: check.reason });
    try {
      await db.prepare("UPDATE players SET nickname = ?1, updated_at = ?2 WHERE id = ?3").bind(nickname, Date.now(), me.id).run();
    } catch (e) {
      if (isUniqueViolation(e)) return fail(409, "nickname_taken");
      throw e;
    }
    return json({ nickname });
  }

  // POST /api/me/code → a new code; the old one stops working everywhere
  if (pathname === "/api/me/code" && method === "POST") {
    if (!(await allow(db, `rotate:${me.id}`, LIMITS.rotate))) return fail(429, "rate_limited");
    const code = newCode();
    await db.prepare("UPDATE players SET code_hash = ?1, updated_at = ?2 WHERE id = ?3").bind(await hashCode(code), Date.now(), me.id).run();
    return json({ code: formatCode(code) });
  }

  return fail(404, "not_found");
}
