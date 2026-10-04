// A scripted player for testing online play: registers, connects to a room and takes its turns.
// Used by play-online.ts (automated checks) and bot-room.ts (to play against from the browser).

import { DEFAULT_PHYSICS } from "../shared/constants";
import { AIM_SEND_MS, type ClientMsg, type OverInfo, type QueueServerMsg, type ServerMsg } from "../shared/protocol";
import { mulberry32 } from "../shared/rng";
import type { GameState } from "../shared/types";
import { botShot } from "./bot";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Server {
  base: string;
  ws: string;
}
export function server(base: string): Server {
  return { base, ws: base.replace(/^http/, "ws") };
}

export async function register(srv: Server, nickname: string): Promise<{ code: string; playerId: string }> {
  const res = await fetch(`${srv.base}/api/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nickname }),
  });
  if (res.status !== 201) throw new Error(`register ${nickname}: ${res.status} ${await res.text()}`);
  return (await res.json()) as { code: string; playerId: string };
}

export async function me(srv: Server, code: string): Promise<{ rating: number; games: number; wins: number; losses: number }> {
  return (await fetch(`${srv.base}/api/me`, { headers: { Authorization: `Bearer ${code}` } })).json() as never;
}

/** A bot player connected to a room. Plays whenever it's its turn. */
export class Bot {
  ws!: WebSocket;
  seat: 0 | 1 = 0;
  state: GameState | null = null;
  inbox: ServerMsg[] = [];
  closed: { code: number } | null = null;
  over: OverInfo | null = null;
  shots = 0;
  autoplay = true;
  /** Pause before each shot, so a person watching can follow. */
  thinkMs = 15;
  /** Send live aim while thinking, as a phone does. */
  showAim = false;
  /** Answer a reaction with applause, to try reactions by hand. */
  reactBack = false;
  private sentFor = -1;
  private rng: () => number;

  constructor(
    readonly srv: Server,
    readonly name: string,
    readonly playerCode: string,
    seed: number,
  ) {
    this.rng = mulberry32(seed);
  }

  connect(room: string, create?: "easy" | "hard", bestOf?: 1 | 3): Promise<void> {
    this.closed = null;
    this.ws = new WebSocket(`${this.srv.ws}/ws/room/${room}`);
    this.ws.addEventListener("message", (e) => this.onMessage(JSON.parse(String(e.data)) as ServerMsg));
    this.ws.addEventListener("close", (e) => (this.closed = { code: e.code }));
    return new Promise((resolve, reject) => {
      this.ws.addEventListener("open", () => {
        this.send({ t: "hello", code: this.playerCode, create, ...(bestOf === 3 ? { bestOf } : {}) });
        resolve();
      });
      this.ws.addEventListener("error", () => reject(new Error(`${this.name}: socket error`)));
    });
  }

  send(m: ClientMsg): void {
    this.ws.send(JSON.stringify(m));
  }

  private onMessage(m: ServerMsg): void {
    this.inbox.push(m);
    if (m.t === "welcome") {
      this.seat = m.you;
      this.state = m.state;
      this.over = m.over;
    } else if (m.t === "start") this.state = m.state;
    else if (m.t === "shot" || m.t === "turn") this.state = m.state;
    else if (m.t === "over") this.over = m.over;
    if (m.t === "start") this.over = null;
    if (m.t === "react" && this.reactBack) setTimeout(() => this.send({ t: "react", r: "clap" }), 700);
    void this.maybePlay();
  }

  /** Take a turn now if it's ours (bots otherwise only act when a message arrives). */
  async maybePlay(): Promise<void> {
    const s = this.state;
    if (!this.autoplay || !s || s.status !== "playing" || s.turn !== this.seat || this.over) return;
    if (this.sentFor === s.shots) return;
    this.sentFor = s.shots;
    const shot = botShot(s, this.rng, 0.1, DEFAULT_PHYSICS);
    if (this.showAim) {
      // Line the shot up like a person would: swing in from off to one side while pulling back.
      const steps = Math.max(1, Math.floor(this.thinkMs / AIM_SEND_MS));
      const off = (this.rng() - 0.5) * 1.6;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const ease = 1 - (1 - t) ** 3;
        this.send({ t: "aim", seq: s.shots, coinId: shot.coinId, angle: shot.angle + off * (1 - ease), power: shot.power * ease });
        await sleep(AIM_SEND_MS);
      }
    } else await sleep(this.thinkMs);
    this.shots++;
    this.send({ t: "shot", seq: s.shots, ...shot });
  }

  async waitFor<T extends ServerMsg["t"]>(t: T, ms = 8000, from = 0): Promise<Extract<ServerMsg, { t: T }>> {
    const start = Date.now();
    for (;;) {
      const found = this.inbox.slice(from).find((m) => m.t === t);
      if (found) return found as Extract<ServerMsg, { t: T }>;
      if (Date.now() - start > ms) throw new Error(`${this.name}: timed out waiting for "${t}"`);
      await sleep(10);
    }
  }

  async waitUntil(pred: () => boolean, ms = 60_000, what = "condition"): Promise<void> {
    const start = Date.now();
    while (!pred()) {
      if (Date.now() - start > ms) throw new Error(`${this.name}: timed out waiting for ${what}`);
      await sleep(20);
    }
  }
}


/** A connection to the Quick Match queue. */
export class QueueSocket {
  ws!: WebSocket;
  inbox: QueueServerMsg[] = [];
  closed: { code: number } | null = null;

  constructor(
    readonly srv: Server,
    readonly name: string,
    readonly playerCode: string,
    /** Accept offers straight away, like someone watching the search screen. */
    readonly autoAccept = true,
  ) {}

  join(table: "easy" | "hard"): Promise<void> {
    this.ws = new WebSocket(`${this.srv.ws}/ws/queue/${table}`);
    this.ws.addEventListener("message", (e) => {
      const msg = JSON.parse(String(e.data)) as QueueServerMsg;
      this.inbox.push(msg);
      if (msg.t === "offer" && this.autoAccept) this.answer(msg.offer, true);
    });
    this.ws.addEventListener("close", (e) => (this.closed = { code: e.code }));
    return new Promise((resolve, reject) => {
      this.ws.addEventListener("open", () => {
        this.ws.send(JSON.stringify({ t: "queue", code: this.playerCode }));
        resolve();
      });
      this.ws.addEventListener("error", () => reject(new Error(`${this.name}: queue socket error`)));
    });
  }

  cancel(): void {
    this.ws.send(JSON.stringify({ t: "cancel" }));
  }

  answer(offer: string, yes: boolean): void {
    this.ws.send(JSON.stringify({ t: yes ? "accept" : "decline", offer }));
  }

  async waitFor<T extends QueueServerMsg["t"]>(t: T, ms = 8000): Promise<Extract<QueueServerMsg, { t: T }>> {
    const start = Date.now();
    for (;;) {
      const found = this.inbox.find((m) => m.t === t);
      if (found) return found as Extract<QueueServerMsg, { t: T }>;
      if (Date.now() - start > ms) throw new Error(`${this.name}: timed out waiting for "${t}" from the queue`);
      await sleep(10);
    }
  }

  get matched(): boolean {
    return this.inbox.some((m) => m.t === "matched");
  }
}

/** Let both bots play until `n` shots have been taken, so a game counts as a real one (and is rated). */
export async function playShots(a: Bot, b: Bot, n: number): Promise<void> {
  a.autoplay = b.autoplay = true;
  void a.maybePlay();
  void b.maybePlay();
  const start = Date.now();
  while ((a.state?.shots ?? 0) < n) {
    if (Date.now() - start > 20_000) throw new Error(`bots didn't reach ${n} shots`);
    await sleep(50);
  }
  a.autoplay = b.autoplay = false;
  await sleep(400); // let any shot already on its way land
}
