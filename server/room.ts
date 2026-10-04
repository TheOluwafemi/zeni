// One Durable Object per room. It holds both players' WebSockets, runs every shot itself, and
// keeps the room's state in storage so it survives the object being evicted from memory.
//
// All the rules live in RoomCore. This file only connects them to the outside world:
// storage, sockets, the alarm clock and the database.

import { DurableObject } from "cloudflare:workers";
import type { Difficulty } from "../shared/constants";
import { AIM_MIN_GAP_MS, parseClientMsg, type ClientMsg, type ErrorCode, type ServerMsg } from "../shared/protocol";
import { REACT_GAP_MS } from "../shared/reactions";
import type { Seat } from "../shared/types";
import { playerForCode } from "./accounts";
import { challengeStarted } from "./challenges";
import { recordResult } from "./ratings";
import { bump, markActive } from "./stats";
import { logServerError } from "./telemetry";
import { isFailure, newRoom, RoomCore, type Out, type RoomRec, type Step } from "./room-core";

/** What each socket remembers across hibernation. */
interface Attachment {
  room: string;
  /** Set once the player has said hello. */
  seat?: Seat;
  playerId?: string;
}

const CLOSE_CODES: Partial<Record<ErrorCode, number>> = {
  unauthorized: 4401,
  no_room: 4404,
  room_full: 4403,
  room_exists: 4409,
  bad_message: 4400,
};

export class Room extends DurableObject<Env> {
  private core: RoomCore | null = null;
  /** When each seat's last aim update was passed on. In memory only: losing it on hibernation is harmless. */
  private lastAim: [number, number] = [0, 0];
  private lastReact: [number, number] = [0, 0];

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const rec = await ctx.storage.get<RoomRec>("room");
      if (!rec) return;
      this.core = new RoomCore(rec);

      // Waking up: a seat with no live socket belongs to someone who dropped while we weren't looking
      // (a deploy or restart closes every socket without telling us). Start their grace period now,
      // instead of waiting for them to miss three turns. Sockets that survived hibernation count as live.
      const live = new Set(ctx.getWebSockets().map((ws) => (ws.deserializeAttachment() as Attachment | null)?.seat));
      const now = Date.now();
      for (const seat of [0, 1] as Seat[]) {
        if (rec.seats[seat] && !live.has(seat)) this.core.setOnline(seat, false, now);
      }
      await ctx.storage.put("room", rec);
      const wake = this.core.nextWake();
      if (wake !== null) await ctx.storage.setAlarm(Math.max(wake, now + 50));
    });
    // Keep-alive pings are answered without waking the object from hibernation.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  // --- Called by the matchmaker ------------------------------------------------

  /** Open a room reserved for two players (matched, or a challenge). False if this code is already in use. */
  async open(code: string, table: Difficulty, reserved: [string, string], kind: "quick" | "challenge" = "quick"): Promise<boolean> {
    if (this.core) return false;
    this.core = new RoomCore(newRoom(code, table, Date.now(), reserved, kind));
    await this.save();
    await this.reschedule();
    return true;
  }

  // --- Sockets ----------------------------------------------------------------

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ room: request.headers.get("X-Room-Code") ?? "" } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    const msg = parseClientMsg(data);
    if (!msg) return this.reject(ws, "bad_message");
    const att = ws.deserializeAttachment() as Attachment | null;
    if (msg.t === "hello") return this.hello(ws, att, msg);
    if (att?.seat === undefined) return this.reject(ws, "unauthorized");

    const seat = att.seat;
    switch (msg.t) {
      case "shot":
        return this.act(ws, seat, (core, now) => core.shot(seat, msg, now));
      case "resign":
        return this.act(ws, seat, (core, now) => core.resign(seat, now));
      case "rematch":
        return this.act(ws, seat, (core, now) => core.rematch(seat, now));
      case "aim":
      case "aim_end":
        return this.aim(seat, msg);
      case "react": {
        // Too soon after the last one: dropped quietly (the buttons wait this long anyway).
        const now = Date.now();
        if (now - this.lastReact[seat] < REACT_GAP_MS || !this.core) return;
        this.lastReact[seat] = now;
        return this.deliver(this.core.react(seat, msg.r));
      }
    }
  }

  override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 ? 1000 : code, "closing");
    } catch {
      // Already closed.
    }
    await this.dropped(ws);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.dropped(ws);
  }

  // --- Actions ----------------------------------------------------------------

  private async hello(ws: WebSocket, att: Attachment | null, msg: { code: string; create?: "easy" | "hard" }): Promise<void> {
    if (att?.seat !== undefined) return this.reject(ws, "bad_message"); // one hello per connection
    const player = await playerForCode(this.env.DB, msg.code);
    if (!player) return this.reject(ws, "unauthorized");

    // Everything from here to the save has no awaits except storage, so no other message can interleave.
    const now = Date.now();
    const room = att?.room ?? "";
    if (!this.core) {
      if (!msg.create) return this.reject(ws, "no_room");
      this.core = new RoomCore(newRoom(room, msg.create, now));
    } else if (msg.create) {
      return this.reject(ws, "room_exists");
    }

    const joined = this.core.join({ id: player.id, nickname: player.nickname, rating: player.rating }, now);
    if (isFailure(joined)) return this.reject(ws, joined.error);
    await this.recordPresence(player.id, joined.step.out);

    ws.serializeAttachment({ room, seat: joined.seat, playerId: player.id } satisfies Attachment);
    await this.save();
    ws.send(JSON.stringify(this.core.welcome(joined.seat, now)));
    this.deliver(joined.step.out);
    await this.reschedule();
  }

  private async act(ws: WebSocket, seat: Seat, run: (core: RoomCore, now: number) => Step | { error: ErrorCode }): Promise<void> {
    const core = this.core;
    if (!core) return this.reject(ws, "no_room");
    const now = Date.now();
    const result = run(core, now);
    if (isFailure(result)) {
      // Tell the phone what went wrong, then resend the room so it can drop any move it guessed at.
      ws.send(JSON.stringify({ t: "error", error: result.error } satisfies ServerMsg));
      ws.send(JSON.stringify(core.welcome(seat, now)));
      return;
    }
    await this.afterStep(result, now);
  }

  /** Pass live aim to the other player. Too-frequent updates are dropped (the last one still gets through on the next). */
  private aim(seat: Seat, msg: Extract<ClientMsg, { t: "aim" | "aim_end" }>): void {
    const now = Date.now();
    if (msg.t === "aim" && now - this.lastAim[seat] < AIM_MIN_GAP_MS) return;
    this.lastAim[seat] = now;
    if (this.core) this.deliver(this.core.aim(seat, msg));
  }

  /** A socket closed or failed. If it was the seat's last one, start the clock on their return. */
  private async dropped(ws: WebSocket): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (att?.seat === undefined || !this.core) return;
    const stillConnected = this.ctx.getWebSockets().some(
      (s) => s !== ws && s.readyState === WebSocket.READY_STATE_OPEN && (s.deserializeAttachment() as Attachment | null)?.seat === att.seat,
    );
    if (stillConnected) return;
    const now = Date.now();
    await this.afterStep(this.core.setOnline(att.seat, false, now), now);
  }

  override async alarm(): Promise<void> {
    if (!this.core) return;
    const now = Date.now();
    await this.afterStep(this.core.tick(now), now);
  }

  // --- Shared steps -----------------------------------------------------------

  /** Save first, then tell everyone, then do the slower follow-ups. */
  private async afterStep(step: Step, now: number): Promise<void> {
    void now;
    await this.save();
    this.deliver(step.out);
    await this.countStarts(step.out);
    if (step.finished) await this.settle();
    if (step.expired) return this.destroy();
    await this.reschedule();
  }

  /** The game just ended: record ratings, then announce the result with the new numbers. */
  private async settle(): Promise<void> {
    const core = this.core;
    const over = core?.rec.over;
    if (!core || !over || over.ratings) return;
    const [a, b] = core.rec.seats;
    if (!a || !b) return;

    try {
      const ratings = await recordResult(
        this.env.DB,
        [a.playerId, b.playerId],
        over.scores,
        over.winner,
        over.reason,
        Date.now(),
        crypto.randomUUID(),
        core.rec.gameStartedAt ?? null,
      );
      if (ratings) {
        over.ratings = ratings;
        a.rating = ratings.after[0];
        b.rating = ratings.after[1];
      }
    } catch (e) {
      console.error("could not record result", e); // the game still ends; the ratings just don't move
      await logServerError(this.env.DB, "room", e);
    }
    await this.save();
    this.deliver([
      { to: "all", msg: { t: "over", over } },
      { to: "all", msg: { t: "players", players: core.players() } },
    ]);
  }

  /** Anonymous bookkeeping for the launch numbers. It must never get in the way of the game. */
  private async recordPresence(playerId: string, out: Out[]): Promise<void> {
    try {
      await markActive(this.env.DB, playerId);
      await this.countStarts(out);
    } catch (e) {
      console.error("could not record presence", e);
    }
  }

  /** Count a game starting, split by how the players met. */
  private async countStarts(out: Out[]): Promise<void> {
    if (!out.some((o) => o.msg.t === "start")) return;
    try {
      const rec = this.core?.rec;
      const how = !rec?.reserved ? "friend" : rec.kind === "challenge" ? "challenge" : "quick";
      await bump(this.env.DB, `game_start_${how}`);
      if (how === "challenge" && rec) await challengeStarted(this.env.DB, rec.code);
    } catch (e) {
      console.error("could not count a game start", e);
    }
  }

  private async save(): Promise<void> {
    if (this.core) await this.ctx.storage.put("room", this.core.rec);
  }

  private async reschedule(): Promise<void> {
    const at = this.core?.nextWake() ?? null;
    if (at === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Math.max(at, Date.now() + 50));
  }

  private async destroy(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(1000, "room_closed");
      } catch {
        // Already closed.
      }
    }
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.core = null;
  }

  private deliver(out: Out[]): void {
    if (out.length === 0) return;
    const encoded = out.map((o) => ({ to: o.to, text: JSON.stringify(o.msg) }));
    for (const ws of this.ctx.getWebSockets()) {
      const seat = (ws.deserializeAttachment() as Attachment | null)?.seat;
      if (seat === undefined) continue; // not said hello yet
      for (const o of encoded) {
        if (o.to === "all" || o.to === seat) ws.send(o.text);
      }
    }
  }

  private reject(ws: WebSocket, error: ErrorCode): void {
    try {
      ws.send(JSON.stringify({ t: "error", error } satisfies ServerMsg));
      ws.close(CLOSE_CODES[error] ?? 4400, error);
    } catch {
      // The socket is already gone.
    }
  }
}
