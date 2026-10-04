// The rules of a room: who's seated, whose turn it is, timeouts, forfeits, rematches.
//
// Pure logic with no Cloudflare APIs. The Durable Object (room.ts) loads a RoomRec from storage,
// calls these methods, saves the record, and delivers the messages they return. That split keeps
// the fiddly parts (clocks, reconnects, who wins when) testable in plain Node.

import { DEFAULT_PHYSICS, DT, type Difficulty } from "../shared/constants";
import { simulateShot } from "../shared/physics";
import {
  ANIM_GRACE_MS,
  MAX_TIMEOUTS,
  RECONNECT_MS,
  ROOM_IDLE_MS,
  TURN_MS,
  type ClientMsg,
  type ErrorCode,
  type OverInfo,
  type OverReason,
  type Players,
  type ServerMsg,
} from "../shared/protocol";
import { lookSeed } from "../shared/avatar";
import type { ReactionId } from "../shared/reactions";
import { randomSeed } from "../shared/rng";
import { legalShot, newGame, other, resolveShot } from "../shared/rules";
import type { GameState, Seat } from "../shared/types";

export interface SeatRec {
  playerId: string;
  nickname: string;
  rating: number;
  /** Turns missed in a row. */
  timeouts: number;
  /** When the player dropped, or null while connected. */
  offlineSince: number | null;
}

/** Everything a room remembers. Plain JSON, so it can be saved to storage as is. */
export interface RoomRec {
  code: string;
  table: Difficulty;
  seats: [SeatRec | null, SeatRec | null];
  state: GameState | null;
  status: "waiting" | "playing" | "over";
  /** When the current turn times out. */
  deadline: number | null;
  /** Who shot first in the current game; a rematch swaps it. */
  firstSeat: Seat | null;
  over: OverInfo | null;
  rematch: [boolean, boolean];
  lastActivity: number;
  /** For Quick Match rooms: the two players it was made for. Nobody else may take a seat. */
  reserved?: [string, string] | null;
  /** How a reserved room came about. Missing on rooms saved before challenges existed (they were Quick Match). */
  kind?: "quick" | "challenge";
  /** When the current (or last) game began, for match length statistics. */
  gameStartedAt?: number | null;
}

/** A message and who it's for. */
export interface Out {
  to: Seat | "all";
  msg: ServerMsg;
}

export interface Step {
  out: Out[];
  /** The game just ended: record the result, then announce `rec.over`. */
  finished: boolean;
  /** The room has outlived its use and should be deleted. */
  expired: boolean;
}

export type Failure = { error: ErrorCode };
const fail = (error: ErrorCode): Failure => ({ error });
export const isFailure = (x: unknown): x is Failure => typeof x === "object" && x !== null && "error" in x;

const NOTHING: Step = { out: [], finished: false, expired: false };
const OVER_IDLE_MS = 10 * 60_000;

export interface Joiner {
  id: string;
  nickname: string;
  rating: number;
}

export function newRoom(
  code: string,
  table: Difficulty,
  now: number,
  reserved: [string, string] | null = null,
  kind?: "quick" | "challenge",
): RoomRec {
  return {
    code,
    table,
    seats: [null, null],
    state: null,
    status: "waiting",
    deadline: null,
    firstSeat: null,
    over: null,
    rematch: [false, false],
    lastActivity: now,
    reserved,
    ...(kind ? { kind } : {}),
  };
}

export class RoomCore {
  constructor(
    readonly rec: RoomRec,
    private readonly newSeed: () => number = randomSeed,
  ) {}

  // --- Views ------------------------------------------------------------------

  seatOf(playerId: string): Seat | null {
    if (this.rec.seats[0]?.playerId === playerId) return 0;
    if (this.rec.seats[1]?.playerId === playerId) return 1;
    return null;
  }

  players(): Players {
    const info = (s: SeatRec | null) =>
      s ? { nickname: s.nickname, rating: s.rating, connected: s.offlineSince === null, look: lookSeed(s.playerId) } : null;
    return [info(this.rec.seats[0]), info(this.rec.seats[1])];
  }

  private deadlineIn(now: number): number | null {
    return this.rec.deadline === null ? null : Math.max(0, this.rec.deadline - now);
  }

  /** Everything a phone needs to draw the room. */
  welcome(seat: Seat, now: number): ServerMsg {
    const { rec } = this;
    return {
      t: "welcome",
      you: seat,
      room: { code: rec.code, table: rec.table, status: rec.status },
      players: this.players(),
      state: rec.state,
      deadlineIn: this.deadlineIn(now),
      over: rec.over,
      rematch: rec.rematch,
    };
  }

  // --- Joining and leaving ----------------------------------------------------

  /** Seat a player, or return them to the seat they already hold. */
  join(player: Joiner, now: number): { seat: Seat; step: Step } | Failure {
    const { rec } = this;
    rec.lastActivity = now;

    if (rec.reserved && !rec.reserved.includes(player.id)) return fail("room_full");

    const existing = this.seatOf(player.id);
    if (existing !== null) {
      const seat = rec.seats[existing]!;
      seat.nickname = player.nickname;
      seat.rating = player.rating;
      seat.offlineSince = null;
      return { seat: existing, step: { ...NOTHING, out: this.announce(now) } };
    }

    const free = rec.seats[0] === null ? 0 : rec.seats[1] === null ? 1 : null;
    if (free === null) return fail("room_full");
    rec.seats[free] = { playerId: player.id, nickname: player.nickname, rating: player.rating, timeouts: 0, offlineSince: null };

    return { seat: free, step: { ...NOTHING, out: this.announce(now) } };
  }

  /**
   * Tell everyone who is here, and start the game if both players are present. A game never starts
   * with someone missing: sharing a link means leaving the page, so a creator is often away when
   * their friend arrives. The friend waits, and the game begins the moment the creator is back.
   */
  private announce(now: number): Out[] {
    const { rec } = this;
    const ready = rec.status === "waiting" && rec.seats[0]?.offlineSince === null && rec.seats[1]?.offlineSince === null;
    return ready ? this.startGame(now, undefined) : [{ to: "all", msg: { t: "players", players: this.players() } }];
  }

  /** A seat's connection came or went. Dropping starts the clock for forfeiting. */
  setOnline(seat: Seat, online: boolean, now: number): Step {
    const s = this.rec.seats[seat];
    if (!s) return NOTHING;
    if (online === (s.offlineSince === null)) return NOTHING;
    s.offlineSince = online ? null : now;
    this.rec.lastActivity = now;
    return { ...NOTHING, out: this.announce(now) };
  }

  private startGame(now: number, first: Seat | undefined): Out[] {
    const { rec } = this;
    rec.state = newGame(this.newSeed(), rec.table, first);
    rec.status = "playing";
    rec.firstSeat = rec.state.turn;
    rec.gameStartedAt = now;
    rec.over = null;
    rec.rematch = [false, false];
    rec.deadline = now + TURN_MS + ANIM_GRACE_MS;
    for (const s of rec.seats) if (s) s.timeouts = 0;
    return [{ to: "all", msg: { t: "start", state: rec.state, deadlineIn: this.deadlineIn(now)!, players: this.players() } }];
  }

  // --- Playing ----------------------------------------------------------------

  shot(seat: Seat, msg: Extract<ClientMsg, { t: "shot" }>, now: number): Step | Failure {
    const { rec } = this;
    const state = rec.state;
    if (rec.status !== "playing" || !state) return fail("not_playing");
    if (state.turn !== seat) return fail("not_your_turn");
    if (msg.seq !== state.shots) return fail("stale");
    const shot = { coinId: msg.coinId, angle: msg.angle, power: msg.power };
    if (!Number.isInteger(msg.coinId) || !legalShot(state, seat, shot)) return fail("illegal");

    // The server plays every shot itself, so a phone can't claim a result it didn't earn.
    const result = simulateShot(state, shot, DEFAULT_PHYSICS);
    const { state: next, outcome } = resolveShot(state, shot, result);
    rec.state = next;
    rec.seats[seat]!.timeouts = 0;
    rec.lastActivity = now;

    const animMs = Math.round(result.steps * DT * 1000) + ANIM_GRACE_MS;
    const out: Out[] = [];
    let finished = false;
    if (next.status === "over") {
      this.finish("normal", next.winner as Seat | "draw", now);
      finished = true;
    } else {
      rec.deadline = now + animMs + TURN_MS;
    }
    out.push({
      to: "all",
      msg: { t: "shot", seq: state.shots, by: seat, shot, state: next, outcome, animMs, deadlineIn: this.deadlineIn(now) ?? 0 },
    });
    return { out, finished, expired: false };
  }

  /**
   * Live aim, passed on to the other player. Nothing changes and nothing is saved. Anything out of
   * place (not their turn, an old shot number, a coin they can't shoot) is dropped quietly: an aim
   * arriving just after a shot is normal, not an error worth resending the room for.
   */
  aim(seat: Seat, msg: Extract<ClientMsg, { t: "aim" | "aim_end" }>): Out[] {
    const state = this.rec.state;
    if (this.rec.status !== "playing" || !state || state.turn !== seat || msg.seq !== state.shots) return [];
    const to = other(seat);
    if (msg.t === "aim_end") return [{ to, msg: { t: "aim_end", by: seat } }];
    const power = Math.min(1, Math.max(0, msg.power));
    // Aiming starts below shooting power, so check the coin with a power any real shot could have.
    if (!legalShot(state, seat, { coinId: msg.coinId, angle: msg.angle, power: 1 })) return [];
    const round = (x: number) => Math.round(x * 1000) / 1000; // plenty for drawing, and keeps messages small
    return [{ to, msg: { t: "aim", by: seat, coinId: msg.coinId, angle: round(msg.angle), power: round(power) } }];
  }

  /** A reaction for the other player: during a game, or after it while both are still looking at the result. */
  react(seat: Seat, r: ReactionId): Out[] {
    const { rec } = this;
    if (rec.status === "waiting" || !rec.seats[0] || !rec.seats[1]) return [];
    return [{ to: other(seat), msg: { t: "react", by: seat, r } }];
  }

  resign(seat: Seat, now: number): Step | Failure {
    if (this.rec.status !== "playing") return fail("not_playing");
    this.finish("resign", other(seat), now);
    return { out: [], finished: true, expired: false };
  }

  /** Vote for a rematch. When both seats agree, a new game starts with the other player first. */
  rematch(seat: Seat, now: number): Step | Failure {
    const { rec } = this;
    if (rec.status !== "over" || !rec.seats[0] || !rec.seats[1]) return fail("not_playing");
    rec.rematch[seat] = true;
    rec.lastActivity = now;
    if (rec.rematch[0] && rec.rematch[1]) {
      return { ...NOTHING, out: this.startGame(now, other(rec.firstSeat ?? 0)) };
    }
    return { ...NOTHING, out: [{ to: "all", msg: { t: "rematch", votes: rec.rematch } }] };
  }

  private finish(reason: OverReason, winner: Seat | "draw", now: number): void {
    const { rec } = this;
    rec.status = "over";
    rec.deadline = null;
    rec.lastActivity = now;
    rec.rematch = [false, false];
    rec.over = {
      winner,
      reason,
      scores: rec.state ? [rec.state.scores[0], rec.state.scores[1]] : [0, 0],
      ratings: null,
    };
  }

  // --- Clocks -----------------------------------------------------------------

  /** When something time-based will next need attention, or null if nothing will. */
  nextWake(): number | null {
    const { rec } = this;
    const times: number[] = [];
    if (rec.status === "playing") {
      if (rec.deadline !== null) times.push(rec.deadline);
      for (const s of rec.seats) if (s?.offlineSince != null) times.push(s.offlineSince + RECONNECT_MS);
    } else if (rec.status === "waiting") {
      times.push(rec.lastActivity + ROOM_IDLE_MS);
    } else {
      times.push(rec.lastActivity + OVER_IDLE_MS);
    }
    return times.length ? Math.min(...times) : null;
  }

  /** Act on anything that has come due. Safe to call at any time. */
  tick(now: number): Step {
    const { rec } = this;

    if (rec.status === "playing" && rec.state) {
      // A player who stayed away past the grace period forfeits. The one gone longest goes first.
      const gone = ([0, 1] as Seat[])
        .filter((i) => rec.seats[i]?.offlineSince != null && now - rec.seats[i]!.offlineSince! >= RECONNECT_MS)
        .sort((a, b) => rec.seats[a]!.offlineSince! - rec.seats[b]!.offlineSince!);
      if (gone.length > 0) {
        this.finish("forfeit", other(gone[0]), now);
        return { out: [], finished: true, expired: false };
      }

      if (rec.deadline !== null && now >= rec.deadline) {
        const who = rec.state.turn;
        const seat = rec.seats[who]!;
        seat.timeouts++;
        if (seat.timeouts >= MAX_TIMEOUTS) {
          this.finish("timeout", other(who), now);
          return { out: [], finished: true, expired: false };
        }
        rec.state = { ...rec.state, turn: other(who), shooter: null };
        rec.deadline = now + TURN_MS;
        rec.lastActivity = now;
        return {
          out: [{ to: "all", msg: { t: "turn", state: rec.state, deadlineIn: TURN_MS, timeouts: seat.timeouts, who } }],
          finished: false,
          expired: false,
        };
      }
      return NOTHING;
    }

    const idle = rec.status === "waiting" ? ROOM_IDLE_MS : OVER_IDLE_MS;
    return now - rec.lastActivity >= idle ? { out: [], finished: false, expired: true } : NOTHING;
  }
}
