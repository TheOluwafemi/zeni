// The Quick Match queue. One Durable Object per table ("easy" and "hard"), so players are only paired
// with someone who wants the same table.
//
// The queue is just the set of connected sockets that have asked to queue; each socket remembers its
// player in its attachment, so the queue survives the object hibernating. When two players are paired,
// the matchmaker opens a room reserved for them and tells both which room to join.

import { DurableObject } from "cloudflare:workers";
import type { Difficulty } from "../shared/constants";
import { parseQueueMsg, type ErrorCode, type QueueServerMsg } from "../shared/protocol";
import { newRoomCode } from "../shared/room-code";
import { playerForCode } from "./accounts";
import { nextRetry, pickPairs, type Waiting } from "./matchmaking";
import { markActive } from "./stats";
import { logServerError } from "./telemetry";

interface Attachment {
  table: Difficulty;
  /** Set once the player has asked to queue. */
  queued?: { playerId: string; rating: number; since: number };
  /** Set the moment a pairing is decided, so a second pass can't pair the same player again. */
  matching?: boolean;
}

const CLOSE: Partial<Record<ErrorCode, number>> = { unauthorized: 4401, already_queued: 4409, bad_message: 4400 };

export class Matchmaker extends DurableObject<Env> {
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
    const table: Difficulty = request.headers.get("X-Table") === "hard" ? "hard" : "easy";
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ table } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    const msg = parseQueueMsg(data);
    if (!msg) return this.reject(ws, "bad_message");
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att) return this.reject(ws, "bad_message");

    if (msg.t === "cancel") {
      ws.close(1000, "cancelled");
      return;
    }
    if (att.queued) return this.reject(ws, "bad_message"); // already in the queue

    const player = await playerForCode(this.env.DB, msg.code);
    if (!player) return this.reject(ws, "unauthorized");

    // One place in the queue per player: a second tab replaces the first.
    for (const other of this.sockets()) {
      if (other.ws !== ws && other.att.queued?.playerId === player.id) {
        this.send(other.ws, { t: "error", error: "already_queued" });
        other.ws.close(CLOSE.already_queued, "already_queued");
      }
    }

    markActive(this.env.DB, player.id).catch(() => {}); // anonymous daily player count; never blocks queueing
    ws.serializeAttachment({ ...att, queued: { playerId: player.id, rating: player.rating, since: Date.now() } } satisfies Attachment);
    this.send(ws, { t: "queued", waiting: this.waiting().length });
    await this.match();
  }

  override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 ? 1000 : code, "closing");
    } catch {
      // Already closed.
    }
    await this.reschedule();
  }

  override async webSocketError(): Promise<void> {
    await this.reschedule();
  }

  override async alarm(): Promise<void> {
    await this.match();
  }

  // --- Matching ---------------------------------------------------------------

  private async match(): Promise<void> {
    const waiting = this.waiting();
    const pairs = pickPairs(
      waiting.map((w) => ({ id: w.playerId, rating: w.rating, since: w.since })),
      Date.now(),
    );

    // Claim every paired socket before the first await, so an overlapping pass can't pair them again.
    const claimed = pairs.map(([a, b]) => {
      const sa = waiting.find((w) => w.playerId === a.id)!;
      const sb = waiting.find((w) => w.playerId === b.id)!;
      for (const s of [sa, sb]) s.ws.serializeAttachment({ ...s.att, matching: true } satisfies Attachment);
      return [sa, sb] as const;
    });

    await Promise.all(claimed.map(([a, b]) => this.pair(a, b)));
    await this.reschedule();
  }

  private async pair(a: Waiting_, b: Waiting_): Promise<void> {
    const table = a.att.table;
    for (let attempt = 0; attempt < 3; attempt++) {
      const room = newRoomCode();
      try {
        const opened = await this.env.ROOM.getByName(room).open(room, table, [a.playerId, b.playerId]);
        if (!opened) continue; // that code is taken: try another
        for (const s of [a, b]) {
          this.send(s.ws, { t: "matched", room, table });
          s.ws.close(1000, "matched");
        }
        return;
      } catch (e) {
        console.error("could not open a room", e);
        await logServerError(this.env.DB, "matchmaker", e);
      }
    }
    // Couldn't open a room: put both back in the queue, keeping their place.
    for (const s of [a, b]) s.ws.serializeAttachment({ table: s.att.table, queued: s.att.queued } satisfies Attachment);
  }

  /** Every open socket and what it remembers. */
  private sockets(): { ws: WebSocket; att: Attachment }[] {
    return this.ctx
      .getWebSockets()
      .filter((ws) => ws.readyState === WebSocket.READY_STATE_OPEN)
      .map((ws) => ({ ws, att: (ws.deserializeAttachment() ?? { table: "easy" }) as Attachment }));
  }

  /** Players in line who haven't been paired yet. */
  private waiting(): Waiting_[] {
    return this.sockets()
      .filter((s) => s.att.queued && !s.att.matching)
      .map((s) => ({ ...s, playerId: s.att.queued!.playerId, rating: s.att.queued!.rating, since: s.att.queued!.since }));
  }

  /** Tell the presence counter how many are waiting on this table. Best effort: never blocks the queue. */
  private reportSize(): void {
    // This object is named after its table ("easy" or "hard"), which survives hibernation.
    const table: Difficulty = this.ctx.id.name === "hard" ? "hard" : "easy";
    this.env.PRESENCE.getByName("global")
      .setSearching(table, this.waiting().length)
      .catch(() => {});
  }

  private async reschedule(): Promise<void> {
    this.reportSize();
    const now = Date.now();
    const queue: Waiting[] = this.waiting().map((w) => ({ id: w.playerId, rating: w.rating, since: w.since }));
    const at = nextRetry(queue, now);
    if (at === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(at);
  }

  private send(ws: WebSocket, msg: QueueServerMsg): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // The socket is gone.
    }
  }

  private reject(ws: WebSocket, error: ErrorCode): void {
    this.send(ws, { t: "error", error });
    try {
      ws.close(CLOSE[error] ?? 4400, error);
    } catch {
      // Already closed.
    }
  }
}

interface Waiting_ {
  ws: WebSocket;
  att: Attachment;
  playerId: string;
  rating: number;
  since: number;
}
