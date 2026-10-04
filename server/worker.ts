import { PROTOCOL_VERSION } from "../shared/constants";
import { newRoomCode, normalizeRoomCode } from "../shared/room-code";
import { handleAccounts } from "./accounts";
import { handleChallenges } from "./challenges";
import { handleLeaderboard } from "./leaderboard";
import { maintenance } from "./maintenance";
import { handleTelemetry, logServerError } from "./telemetry";

// The Durable Object classes must be exported from the Worker's entry point.
export { Matchmaker } from "./matchmaker";
export { Presence } from "./presence";
export { Room } from "./room";

const ROOM_SOCKET = /^\/ws\/room\/([^/]+)$/;
const QUEUE_SOCKET = /^\/ws\/queue\/(easy|hard)$/;

export default {
  async fetch(request, env, ctx) {
    try {
      return await route(request, env, ctx);
    } catch (e) {
      // Anything that slips through: record it so it can be found later, and answer cleanly.
      ctx.waitUntil(logServerError(env.DB, "server", e));
      return Response.json({ error: "server_error" }, { status: 500 });
    }
  },

  /** Runs daily (see `triggers` in wrangler.jsonc). */
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      maintenance(env.DB).catch((e) => logServerError(env.DB, "server", e)),
    );
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/api/health") {
    return Response.json({ ok: true, protocol: PROTOCOL_VERSION });
  }

  // A player's WebSocket to a room. One Durable Object per room code, so both players land together.
  const room = url.pathname.match(ROOM_SOCKET);
  if (room) {
    const code = normalizeRoomCode(decodeURIComponent(room[1]));
    if (!code) return Response.json({ error: "bad_room_code" }, { status: 404 });
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
    const forwarded = new Request(request);
    forwarded.headers.set("X-Room-Code", code);
    return env.ROOM.getByName(code).fetch(forwarded);
  }

  // Quick Match: one queue per table.
  const queue = url.pathname.match(QUEUE_SOCKET);
  if (queue) {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
    const forwarded = new Request(request);
    forwarded.headers.set("X-Table", queue[1]);
    return env.MATCHMAKER.getByName(queue[1]).fetch(forwarded);
  }

  // The leaderboard is the same for everyone, so keep a copy at the edge for 30 seconds.
  if (url.pathname === "/api/leaderboard" && request.method === "GET") {
    const key = new Request(url.toString(), { method: "GET" });
    const cached = await caches.default.match(key);
    if (cached) return cached;
    const fresh = await handleLeaderboard(request, url, env.DB);
    if (fresh) ctx.waitUntil(caches.default.put(key, fresh.clone()));
    return fresh ?? Response.json({ error: "not_found" }, { status: 404 });
  }

  // "3 online · 1 looking for a game". Anonymous: the body carries a random id made fresh per tab.
  if (url.pathname === "/api/presence" && request.method === "POST") {
    const body = (await request.json().catch(() => null)) as { session?: unknown } | null;
    const info = await env.PRESENCE.getByName("global").ping(body?.session);
    return Response.json(info, { headers: { "cache-control": "no-store" } });
  }

  const telemetry = await handleTelemetry(request, url, env.DB);
  if (telemetry) return telemetry;

  const challenges = await handleChallenges(
    request,
    url,
    env.DB,
    (code, table, players) => env.ROOM.getByName(code).open(code, table, players, "challenge"),
    newRoomCode,
  );
  if (challenges) return challenges;

  const accounts = await handleAccounts(request, url, env.DB, (p) => ctx.waitUntil(p));
  if (accounts) return accounts;

  return Response.json({ error: "not_found" }, { status: 404 });
}
