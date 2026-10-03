import { PROTOCOL_VERSION } from "../shared/constants";
import { normalizeRoomCode } from "../shared/room-code";
import { handleAccounts } from "./accounts";
import { handleLeaderboard } from "./leaderboard";

// The Durable Object class must be exported from the Worker's entry point.
export { Matchmaker } from "./matchmaker";
export { Room } from "./room";

const ROOM_SOCKET = /^\/ws\/room\/([^/]+)$/;
const QUEUE_SOCKET = /^\/ws\/queue\/(easy|hard)$/;

export default {
  async fetch(request, env, ctx) {
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

    const accounts = await handleAccounts(request, url, env.DB, (p) => ctx.waitUntil(p));
    if (accounts) return accounts;

    return Response.json({ error: "not_found" }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
