// Runs the computer opponent's search off the main thread so the board never stutters.

import { chooseShot, type AiLevel } from "../../shared/ai";
import type { PhysicsConfig } from "../../shared/constants";
import { mulberry32, randomSeed } from "../../shared/rng";
import type { GameState, Shot } from "../../shared/types";

export interface AiRequest {
  id: number;
  state: GameState;
  level: AiLevel;
  physics: PhysicsConfig;
}

export interface AiResponse {
  id: number;
  shot: Shot;
}

addEventListener("message", (e: MessageEvent<AiRequest>) => {
  const { id, state, level, physics } = e.data;
  const shot = chooseShot(state, level, mulberry32(randomSeed()), physics);
  postMessage({ id, shot } satisfies AiResponse);
});
