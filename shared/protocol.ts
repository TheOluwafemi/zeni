// The messages between a player's phone and a room on the server.

import type { Difficulty } from "./constants";
import type { GameState, Seat, Shot, ShotOutcome } from "./types";

/** A player has this long to shoot, counted from when the last shot finishes playing. */
export const TURN_MS = 20_000;
/** Extra time for the previous shot's animation to play before the turn clock starts. */
export const ANIM_GRACE_MS = 800;
/** A dropped player has this long to come back before they forfeit. */
export const RECONNECT_MS = 30_000;
/** Missing this many turns in a row forfeits the game. */
export const MAX_TIMEOUTS = 3;
/** A room nobody joins, or a finished one nobody uses, is deleted after this long. */
export const ROOM_IDLE_MS = 30 * 60_000;

export interface PlayerInfo {
  nickname: string;
  rating: number;
  /** False while the player is dropped and the room is waiting for them to return. */
  connected: boolean;
}
export type Players = [PlayerInfo | null, PlayerInfo | null];

export type OverReason = "normal" | "resign" | "forfeit" | "timeout";

export interface OverInfo {
  winner: Seat | "draw";
  reason: OverReason;
  scores: [number, number];
  /** Ratings before and after, once the server has recorded the result. */
  ratings: { before: [number, number]; after: [number, number] } | null;
}

export interface RoomInfo {
  code: string;
  table: Difficulty;
  status: "waiting" | "playing" | "over";
}

// --- Phone → server ---------------------------------------------------------------

export type ClientMsg =
  /** First message on every connection. `create` opens a new room with that table. */
  | { t: "hello"; code: string; create?: Difficulty }
  /** `seq` is the number of shots played so far, so a stale or repeated shot is ignored. */
  | { t: "shot"; seq: number; coinId: number; angle: number; power: number }
  | { t: "resign" }
  | { t: "rematch" };

// --- Server → phone ---------------------------------------------------------------

export type ServerMsg =
  /** Everything needed to draw the room: sent on joining and again on every reconnect. */
  | {
      t: "welcome";
      you: Seat;
      room: RoomInfo;
      players: Players;
      state: GameState | null;
      /** Milliseconds until the current turn times out, from now. */
      deadlineIn: number | null;
      over: OverInfo | null;
      rematch: [boolean, boolean];
    }
  | { t: "players"; players: Players }
  /** A game began (the second player arrived, or both agreed to a rematch). */
  | { t: "start"; state: GameState; deadlineIn: number; players: Players }
  /** A shot was played. `state` is the authoritative result; phones animate and then snap to it. */
  | { t: "shot"; seq: number; by: Seat; shot: Shot; state: GameState; outcome: ShotOutcome; animMs: number; deadlineIn: number }
  /** A player ran out of time and the turn passed. */
  | { t: "turn"; state: GameState; deadlineIn: number; timeouts: number; who: Seat }
  | { t: "over"; over: OverInfo }
  | { t: "rematch"; votes: [boolean, boolean] }
  | { t: "error"; error: ErrorCode };

export type ErrorCode =
  | "bad_message"
  | "unauthorized"
  | "no_room"
  | "room_exists"
  | "room_full"
  | "not_playing"
  | "not_your_turn"
  | "stale"
  | "illegal"
  | "version";

// --- Parsing ---------------------------------------------------------------------

/** Longest message the server will look at. Real messages are well under 200 bytes. */
export const MAX_MESSAGE_BYTES = 1000;

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** Turn raw text from a socket into a message, or null if it isn't a well-formed one. */
export function parseClientMsg(raw: unknown): ClientMsg | null {
  if (typeof raw !== "string" || raw.length > MAX_MESSAGE_BYTES) return null;
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof m !== "object" || m === null) return null;
  const o = m as Record<string, unknown>;
  switch (o.t) {
    case "hello":
      if (typeof o.code !== "string" || o.code.length > 64) return null;
      if (o.create !== undefined && o.create !== "easy" && o.create !== "hard") return null;
      return { t: "hello", code: o.code, create: o.create };
    case "shot":
      if (!Number.isInteger(o.seq) || !Number.isInteger(o.coinId) || !isNum(o.angle) || !isNum(o.power)) return null;
      return { t: "shot", seq: o.seq as number, coinId: o.coinId as number, angle: o.angle, power: o.power };
    case "resign":
      return { t: "resign" };
    case "rematch":
      return { t: "rematch" };
    default:
      return null;
  }
}
