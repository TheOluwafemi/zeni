import type { AiLevel } from "../../shared/ai";
import type { PhysicsConfig } from "../../shared/constants";
import type { GameState, Shot } from "../../shared/types";
import type { AiRequest, AiResponse } from "./ai-worker";

/** Even an instant answer waits this long, so the computer feels like it's considering. */
const MIN_THINK_MS = 700;

/** Talks to the AI worker. One request at a time; newer requests supersede older ones. */
export class ComputerPlayer {
  private worker = new Worker(new URL("./ai-worker.ts", import.meta.url), { type: "module" });
  private nextId = 0;
  private pending = new Map<number, (shot: Shot) => void>();

  constructor() {
    this.worker.addEventListener("message", (e: MessageEvent<AiResponse>) => {
      this.pending.get(e.data.id)?.(e.data.shot);
      this.pending.delete(e.data.id);
    });
  }

  async think(state: GameState, level: AiLevel, physics: PhysicsConfig): Promise<Shot> {
    const id = ++this.nextId;
    const answer = new Promise<Shot>((resolve) => this.pending.set(id, resolve));
    this.worker.postMessage({ id, state, level, physics } satisfies AiRequest);
    const [shot] = await Promise.all([answer, new Promise((r) => setTimeout(r, MIN_THINK_MS))]);
    return shot;
  }
}
