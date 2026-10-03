// A connection to one game room. It says hello with the player's code, keeps the line alive,
// and reconnects by itself when the network drops, so a phone that sleeps or switches from
// wifi to mobile data rejoins the same game.

import type { Difficulty } from "../shared/constants";
import type { ClientMsg, ErrorCode, ServerMsg } from "../shared/protocol";
import { identity } from "./api";

export type Link = "connecting" | "open" | "reconnecting" | "closed";
export type Fatal = ErrorCode | "gave_up" | "signed_out";

export interface RoomHandlers {
  message(msg: ServerMsg): void;
  link(state: Link): void;
  /** The connection is over for good, and why. */
  fatal(reason: Fatal): void;
}

/** Close codes the server uses to say "don't retry". */
const FATAL_CLOSES: Record<number, ErrorCode> = {
  4400: "bad_message",
  4401: "unauthorized",
  4403: "room_full",
  4404: "no_room",
  4409: "room_exists",
};

const PING_MS = 10_000;
const SILENCE_MS = 25_000;
/** Roughly how long to keep trying: the server forfeits a player who's gone for 30 seconds. */
const GIVE_UP_MS = 45_000;
const BACKOFF_MS = [250, 500, 1000, 2000, 3000];

export class RoomClient {
  private ws: WebSocket | null = null;
  private attempts = 0;
  /** Hellos sent so far. A second one means the first one's reply was lost. */
  private hellos = 0;
  private lastHeard = 0;
  private offlineSince = 0;
  private ended = false;
  private timers: { retry?: number; ping?: number } = {};
  /** Only the very first connection may create the room. */
  private create: Difficulty | null;

  constructor(
    readonly code: string,
    create: Difficulty | null,
    private readonly handlers: RoomHandlers,
  ) {
    this.create = create;
    window.addEventListener("online", this.wake);
    document.addEventListener("visibilitychange", this.wake);
  }

  connect(): void {
    this.handlers.link(this.attempts === 0 ? "connecting" : "reconnecting");
    const scheme = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${scheme}//${location.host}/ws/room/${this.code}`);
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.lastHeard = Date.now();
      const code = identity.code;
      if (!code) return this.finish("signed_out");
      // After the first hello, never ask to create again: the room exists, or the code is taken.
      this.send({ t: "hello", code, create: this.create ?? undefined });
      this.hellos++;
      this.timers.ping = window.setInterval(() => this.heartbeat(ws), PING_MS);
    });

    ws.addEventListener("message", (e) => {
      this.lastHeard = Date.now();
      if (e.data === "pong") return;
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(e.data)) as ServerMsg;
      } catch {
        return;
      }
      if (msg.t === "welcome") {
        this.create = null;
        this.attempts = 0;
        this.offlineSince = 0;
        this.handlers.link("open");
      }
      this.handlers.message(msg);
    });

    ws.addEventListener("close", (e) => {
      window.clearInterval(this.timers.ping);
      if (ws !== this.ws || this.ended) return; // a superseded socket, or one we closed on purpose
      const fatal = FATAL_CLOSES[e.code];
      if (fatal === "room_exists" && this.hellos > 1 && this.create !== null) {
        // Our first create got through but its reply was lost: rejoin the room we made.
        this.create = null;
        return this.retry();
      }
      if (fatal) return this.finish(fatal);
      this.retry();
    });
  }

  send(msg: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  get open(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Leave the room on purpose. */
  leave(): void {
    this.ended = true;
    this.teardown();
    this.handlers.link("closed");
  }

  private finish(reason: Fatal): void {
    if (this.ended) return;
    this.ended = true;
    this.teardown();
    this.handlers.link("closed");
    this.handlers.fatal(reason);
  }

  private teardown(): void {
    window.removeEventListener("online", this.wake);
    document.removeEventListener("visibilitychange", this.wake);
    window.clearTimeout(this.timers.retry);
    window.clearInterval(this.timers.ping);
    const ws = this.ws;
    this.ws = null;
    try {
      ws?.close(1000, "leaving");
    } catch {
      // Already closed.
    }
  }

  private retry(): void {
    if (this.ended) return;
    if (this.offlineSince === 0) this.offlineSince = Date.now();
    if (Date.now() - this.offlineSince > GIVE_UP_MS) return this.finish("gave_up");
    this.handlers.link("reconnecting");
    const delay = BACKOFF_MS[Math.min(this.attempts, BACKOFF_MS.length - 1)];
    this.attempts++;
    window.clearTimeout(this.timers.retry);
    this.timers.retry = window.setTimeout(() => this.connect(), delay);
  }

  /** Keep the line warm, and notice a connection that died without telling us. */
  private heartbeat(ws: WebSocket): void {
    if (ws !== this.ws) return;
    if (Date.now() - this.lastHeard > SILENCE_MS) {
      ws.close(); // the close handler starts the reconnect
      return;
    }
    if (ws.readyState === WebSocket.OPEN) ws.send("ping");
  }

  /** The phone woke up, or the network came back: don't wait out the backoff. */
  private wake = (): void => {
    if (this.ended || document.visibilityState === "hidden") return;
    const stale = this.ws === null || this.ws.readyState > WebSocket.OPEN || Date.now() - this.lastHeard > SILENCE_MS;
    if (!stale) return;
    window.clearTimeout(this.timers.retry);
    try {
      this.ws?.close();
    } catch {
      // Already closed.
    }
    this.ws = null;
    this.connect();
  };
}
