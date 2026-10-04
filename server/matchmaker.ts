// The Quick Match queue. One Durable Object per table ("easy" and "hard"), so players are only paired
// with someone who wants the same table.
//
// The rules live in QueueCore (pure, tested). This object only stores the queue and carries out what
// the core decides. The queue is the set of connected sockets that have asked to queue: each socket
// remembers its place in line and any pending offer in its attachment, so the queue survives the object
// hibernating.

import { DurableObject } from "cloudflare:workers";
import type { Difficulty } from "../shared/constants";
import { parseQueueMsg, type ErrorCode, type QueueServerMsg } from "../shared/protocol";
import { newRoomCode } from "../shared/room-code";
import { playerForCode } from "./accounts";
import { QueueCore, type QAction, type QEntry } from "./queue-core";
import { markActive } from "./stats";
import { logServerError } from "./telemetry";

interface Attachment {
  table: Difficulty;
  /** Socket id. */
  sid: string;
  /** Set once the player has asked to queue: their place in line and any pending offer. */
  entry?: QEntry;
}

const CLOSE: Partial<Record<ErrorCode, number>> = { unauthorized: 4401, already_queued: 4409, bad_message: 4400 };

export class Matchmaker extends DurableObject<Env> {
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ table: this.table(), sid: crypto.randomUUID() } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    const msg = parseQueueMsg(data);
    if (!msg) return this.reject(ws, "bad_message");
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att) return this.reject(ws, "bad_message");

    if (msg.t === "cancel") {
      const core = this.load();
      await this.apply(core, [...core.gone(att.sid), { kind: "close", sid: att.sid, code: 1000, reason: "cancelled" }]);
      return;
    }
    if (msg.t === "accept" || msg.t === "decline") {
      const core = this.load();
      await this.apply(core, msg.t === "accept" ? core.accept(att.sid, msg.offer) : core.decline(att.sid, msg.offer));
      return;
    }
    if (att.entry) return this.reject(ws, "bad_message"); // already in the queue

    const player = await playerForCode(this.env.DB, msg.code);
    if (!player) return this.reject(ws, "unauthorized");
    markActive(this.env.DB, player.id).catch(() => {}); // anonymous daily player count; never blocks queueing

    // Load after the await, so we see anything that changed meanwhile.
    const core = this.load();
    const actions = core.join({ sid: att.sid, playerId: player.id, nickname: player.nickname, rating: player.rating, since: Date.now() });
    await this.apply(core, [...actions, ...core.pair(Date.now())]);
  }

  override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 ? 1000 : code, "closing");
    } catch {
      // Already closed.
    }
    const att = ws.deserializeAttachment() as Attachment | null;
    const core = this.load();
    await this.apply(core, att ? core.gone(att.sid) : []);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws, 1011);
  }

  override async alarm(): Promise<void> {
    const core = this.load();
    const now = Date.now();
    const expired = core.expire(now);
    await this.apply(core, [...expired, ...core.pair(now)]);
  }

  // --- Carrying out the core's decisions -------------------------------------

  /** The queue as stored in the open sockets. */
  private load(): QueueCore {
    const entries = new Map<string, QEntry>();
    for (const { att } of this.sockets()) if (att.entry) entries.set(att.sid, att.entry);
    return new QueueCore(entries, this.table());
  }

  /** Save the queue back to the sockets, then send, close and open rooms as the core asked. */
  private async apply(core: QueueCore, decided: QAction[]): Promise<void> {
    // A socket can drop while the queue sleeps, leaving its partner's offer pointing at nobody.
    const actions = [...decided, ...core.dropOrphans()];
    const sockets = new Map(this.ctx.getWebSockets().map((ws) => [(ws.deserializeAttachment() as Attachment | null)?.sid, ws]));

    // Persist first: every later step (and any overlapping event) must see the queue as decided.
    for (const [sid, ws] of sockets) {
      if (!sid) continue;
      const entry = core.entries.get(sid);
      try {
        ws.serializeAttachment({ table: this.table(), sid, ...(entry ? { entry } : {}) } satisfies Attachment);
      } catch {
        // Closed sockets can't store anything; they're out of the queue anyway.
      }
    }

    const opens: Extract<QAction, { kind: "open" }>[] = [];
    for (const a of actions) {
      const ws = a.kind === "open" ? undefined : sockets.get(a.sid);
      if (a.kind === "send" && ws) this.send(ws, a.msg);
      else if (a.kind === "close" && ws) this.close(ws, a.code, a.reason);
      else if (a.kind === "open") opens.push(a);
    }

    await this.reschedule(core);
    await Promise.all(opens.map((o) => this.openRoom(o)));
  }

  /** Both players accepted: open a room reserved for them, then send them to it. */
  private async openRoom(o: Extract<QAction, { kind: "open" }>): Promise<void> {
    let room: string | null = null;
    for (let attempt = 0; attempt < 3 && !room; attempt++) {
      const code = newRoomCode();
      try {
        if (await this.env.ROOM.getByName(code).open(code, this.table(), o.players)) room = code;
        // Otherwise that code is taken: try another.
      } catch (e) {
        console.error("could not open a room", e);
        await logServerError(this.env.DB, "matchmaker", e);
      }
    }
    // Reload: things may have changed while the room was opening (someone may even have left).
    const core = this.load();
    await this.apply(core, room ? core.opened(o.offer, room) : core.openFailed(o.offer));
  }

  private table(): Difficulty {
    // This object is named after its table ("easy" or "hard"), which survives hibernation.
    return this.ctx.id.name === "hard" ? "hard" : "easy";
  }

  /** Every open socket and what it remembers. */
  private sockets(): { ws: WebSocket; att: Attachment }[] {
    return this.ctx
      .getWebSockets()
      .filter((ws) => ws.readyState === WebSocket.READY_STATE_OPEN)
      .flatMap((ws) => {
        const att = ws.deserializeAttachment() as Attachment | null;
        return att?.sid ? [{ ws, att }] : [];
      });
  }

  private async reschedule(core: QueueCore): Promise<void> {
    // Tell the presence counter how many are looking for a game here. Best effort: never blocks the queue.
    this.env.PRESENCE.getByName("global")
      .setSearching(this.table(), core.entries.size)
      .catch(() => {});
    const at = core.nextWake(Date.now());
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

  private close(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.close(code, reason);
    } catch {
      // Already closed.
    }
  }

  private reject(ws: WebSocket, error: ErrorCode): void {
    this.send(ws, { t: "error", error });
    this.close(ws, CLOSE[error] ?? 4400, error);
  }
}
