import { PROTOCOL_VERSION } from "../shared/constants";
import { normalizeRoomCode } from "../shared/room-code";
import { handleAccounts } from "./accounts";

// The Durable Object class must be exported from the Worker's entry point.
export { Room } from "./room";

const ROOM_SOCKET = /^\/ws\/room\/([^/]+)$/;

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

    const accounts = await handleAccounts(request, url, env.DB, (p) => ctx.waitUntil(p));
    if (accounts) return accounts;

    return Response.json({ error: "not_found" }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
