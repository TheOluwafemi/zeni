import { describe, expect, test } from "vitest";
import { ANIM_GRACE_MS, MAX_TIMEOUTS, parseClientMsg, RECONNECT_MS, ROOM_IDLE_MS, TURN_MS } from "../shared/protocol";
import { lookSeed } from "../shared/avatar";
import { mulberry32 } from "../shared/rng";
import { freeCoinIds } from "../shared/rules";
import type { Seat } from "../shared/types";
import { isFailure, newRoom, RoomCore, type Joiner, type Out, type Step } from "./room-core";

const ada: Joiner = { id: "ada", nickname: "Ada", rating: 1000 };
const bea: Joiner = { id: "bea", nickname: "Bea", rating: 1100 };
const T0 = 1_000_000;

/** A room with a fixed table, so shots can be aimed by hand. */
function setup(table: "easy" | "hard" = "easy") {
  let seed = 42;
  const core = new RoomCore(newRoom("K7QXM", table, T0), () => seed++);
  return core;
}

function seated(table: "easy" | "hard" = "easy", now = T0) {
  const core = setup(table);
  const a = core.join(ada, now);
  const b = core.join(bea, now);
  if (isFailure(a) || isFailure(b)) throw new Error("join failed");
  return { core, adaSeat: a.seat, beaSeat: b.seat };
}

const kinds = (out: Out[]) => out.map((o) => o.msg.t);

/** A legal shot for whoever's turn it is, aimed at a random angle. */
function someShot(core: RoomCore, rng: () => number) {
  const state = core.rec.state!;
  const free = [...freeCoinIds(state.coins)];
  return {
    t: "shot" as const,
    seq: state.shots,
    coinId: state.shooter ?? free[Math.floor(rng() * free.length)],
    angle: rng() * Math.PI * 2,
    power: 0.2 + rng() * 0.8,
  };
}

describe("joining", () => {
  test("the first player waits; the second starts the game", () => {
    const core = setup();
    const a = core.join(ada, T0);
    expect(isFailure(a)).toBe(false);
    expect(core.rec.status).toBe("waiting");
    expect(core.rec.state).toBeNull();

    const b = core.join(bea, T0 + 5);
    if (isFailure(b)) throw new Error("join failed");
    expect(core.rec.status).toBe("playing");
    expect(core.rec.state).not.toBeNull();
    expect(kinds(b.step.out)).toEqual(["start"]);
    expect(core.rec.deadline).toBe(T0 + 5 + TURN_MS + ANIM_GRACE_MS);
    expect(core.players()).toEqual([
      { nickname: "Ada", rating: 1000, connected: true, look: lookSeed("ada") },
      { nickname: "Bea", rating: 1100, connected: true, look: lookSeed("bea") },
    ]);
  });

  test("a third player is turned away", () => {
    const { core } = seated();
    expect(core.join({ id: "cy", nickname: "Cyd", rating: 1000 }, T0)).toEqual({ error: "room_full" });
  });

  test("a returning player gets their own seat back, not a new one", () => {
    const { core, adaSeat } = seated();
    const again = core.join(ada, T0 + 1000);
    expect(again).toMatchObject({ seat: adaSeat });
    expect(core.rec.seats.filter(Boolean)).toHaveLength(2);
  });

  test("each seat's welcome says which seat is theirs", () => {
    const { core, adaSeat, beaSeat } = seated();
    expect(core.welcome(adaSeat, T0)).toMatchObject({ t: "welcome", you: adaSeat, room: { code: "K7QXM", status: "playing" } });
    expect(core.welcome(beaSeat, T0)).toMatchObject({ you: beaSeat });
  });
});

describe("a creator who is away when a friend joins (sharing the link means leaving the page)", () => {
  const MIN = 60_000;

  test("the game waits for both players to be present instead of forfeiting the one who is away", () => {
    const core = setup();
    core.join(ada, T0);
    core.setOnline(0, false, T0 + 5_000); // Ada leaves to send the link; the phone drops her connection
    const joined = core.join(bea, T0 + 3 * MIN); // Bea taps the link three minutes later

    expect(isFailure(joined)).toBe(false);
    expect(core.rec.status).toBe("waiting"); // no game yet: one of them isn't here
    expect(core.rec.state).toBeNull();
    expect(core.tick(T0 + 3 * MIN + 100).finished).toBe(false); // and certainly no instant forfeit
    expect(core.tick(T0 + 3 * MIN + 31_000).finished).toBe(false); // not even once 30 seconds pass
    expect(core.players()).toEqual([
      { nickname: "Ada", rating: 1000, connected: false, look: lookSeed("ada") },
      { nickname: "Bea", rating: 1100, connected: true, look: lookSeed("bea") },
    ]);
  });

  test("the game starts the moment the missing player comes back", () => {
    const core = setup();
    core.join(ada, T0);
    core.setOnline(0, false, T0 + 5_000);
    core.join(bea, T0 + 3 * MIN);

    const back = core.join(ada, T0 + 4 * MIN);
    if (isFailure(back)) throw new Error(back.error);
    expect(core.rec.status).toBe("playing");
    expect(kinds(back.step.out)).toContain("start");
    expect(core.rec.seats[0]!.offlineSince).toBeNull();
    expect(core.rec.deadline).toBe(T0 + 4 * MIN + TURN_MS + ANIM_GRACE_MS); // a fresh clock, from when the game began
  });

  test("a room whose creator never returns just expires; nobody is ranked", () => {
    const core = setup();
    core.join(ada, T0);
    core.setOnline(0, false, T0 + 5_000);
    core.join(bea, T0 + 3 * MIN);
    expect(core.tick(T0 + 3 * MIN + ROOM_IDLE_MS).expired).toBe(true);
    expect(core.rec.over).toBeNull();
  });

  test("the other way round: the joiner drops before the creator returns, and the game still waits", () => {
    const core = setup();
    core.join(ada, T0);
    core.join(bea, T0 + 1000); // game starts at once: both present
    expect(core.rec.status).toBe("playing");
  });
});

describe("a room reserved for two players (Quick Match)", () => {
  const cy: Joiner = { id: "cy", nickname: "Cyd", rating: 1000 };

  test("only the two it was made for can sit down", () => {
    const core = new RoomCore(newRoom("QM123", "easy", T0, ["ada", "bea"]), () => 7);
    expect(core.join(cy, T0)).toEqual({ error: "room_full" });
    expect(isFailure(core.join(bea, T0))).toBe(false);
    expect(core.rec.seats[0]?.playerId).toBe("bea"); // seats go in order of arrival
    expect(core.join(cy, T0)).toEqual({ error: "room_full" }); // still turned away with a seat free
    expect(isFailure(core.join(ada, T0))).toBe(false);
    expect(core.rec.status).toBe("playing");
  });

  test("an ordinary room lets anyone in until it's full", () => {
    const core = new RoomCore(newRoom("FR123", "easy", T0), () => 7);
    expect(isFailure(core.join(cy, T0))).toBe(false);
  });
});

describe("shots", () => {
  test("only the player whose turn it is may shoot, with the right sequence number", () => {
    const { core } = seated();
    const turn = core.rec.state!.turn;
    const notTurn = (1 - turn) as Seat;
    const msg = someShot(core, mulberry32(1));

    expect(core.shot(notTurn, msg, T0 + 100)).toEqual({ error: "not_your_turn" });
    expect(core.shot(turn, { ...msg, seq: 7 }, T0 + 100)).toEqual({ error: "stale" });
    expect(core.shot(turn, { ...msg, power: 0.001 }, T0 + 100)).toEqual({ error: "illegal" });
    expect(core.shot(turn, { ...msg, angle: NaN }, T0 + 100)).toEqual({ error: "illegal" });
    expect(core.shot(turn, { ...msg, coinId: 0.5 }, T0 + 100)).toEqual({ error: "illegal" });
    expect(core.shot(turn, { ...msg, coinId: 999 }, T0 + 100)).toEqual({ error: "illegal" });
    expect(core.rec.state!.shots).toBe(0); // nothing above changed the game
  });

  test("a valid shot is played by the server and announced to both players", () => {
    const { core } = seated();
    const turn = core.rec.state!.turn;
    const step = core.shot(turn, someShot(core, mulberry32(1)), T0 + 100);
    if (isFailure(step)) throw new Error(step.error);

    expect(core.rec.state!.shots).toBe(1);
    expect(step.out).toHaveLength(1);
    expect(step.out[0].to).toBe("all");
    expect(step.out[0].msg).toMatchObject({ t: "shot", seq: 0, by: turn });
    expect(core.rec.deadline).toBeGreaterThan(T0 + 100 + TURN_MS); // the clock restarts after the animation
  });

  test("repeating the same shot is rejected as stale", () => {
    const { core } = seated();
    const turn = core.rec.state!.turn;
    const msg = someShot(core, mulberry32(1));
    core.shot(turn, msg, T0 + 100);
    const again = core.shot(turn, msg, T0 + 200);
    expect(isFailure(again)).toBe(true);
  });

  test("shooting is refused before the game starts and after it ends", () => {
    const core = setup();
    core.join(ada, T0);
    expect(core.shot(0, { t: "shot", seq: 0, coinId: 0, angle: 0, power: 0.5 }, T0)).toEqual({ error: "not_playing" });
  });
});

describe("turn timeouts", () => {
  test("a missed turn passes to the other player and counts against the one who missed", () => {
    const { core } = seated();
    const who = core.rec.state!.turn;
    const due = core.rec.deadline!;

    expect(core.tick(due - 1).out).toEqual([]);
    const step = core.tick(due);
    expect(kinds(step.out)).toEqual(["turn"]);
    expect(core.rec.state!.turn).toBe(1 - who);
    expect(core.rec.state!.shooter).toBeNull();
    expect(core.rec.seats[who]!.timeouts).toBe(1);
    expect(core.rec.deadline).toBe(due + TURN_MS);
  });

  test("shooting resets the count of missed turns", () => {
    const { core } = seated();
    const first = core.rec.state!.turn;
    core.tick(core.rec.deadline!); // first misses
    core.tick(core.rec.deadline!); // second misses
    core.tick(core.rec.deadline!); // first misses again
    expect(core.rec.seats[first]!.timeouts).toBe(2);

    const turn = core.rec.state!.turn;
    core.shot(turn, someShot(core, mulberry32(3)), core.rec.deadline! - 1000);
    expect(core.rec.seats[turn]!.timeouts).toBe(0);
  });

  test(`missing ${MAX_TIMEOUTS} turns in a row loses the game`, () => {
    const { core } = seated();
    const loser = core.rec.state!.turn;
    // The other player also misses their turns in between, but only the loser's streak matters here:
    // reset the opponent's count each round, as if they shot.
    for (let i = 0; i < MAX_TIMEOUTS; i++) {
      const step = core.tick(core.rec.deadline!);
      if (i < MAX_TIMEOUTS - 1) {
        expect(step.finished).toBe(false);
        // opponent's turn; they take it
        const opp = core.rec.state!.turn;
        const r = core.shot(opp, someShot(core, mulberry32(i + 5)), core.rec.deadline! - 5000);
        expect(isFailure(r)).toBe(false);
        // after the opponent's shot the turn may stay with them (capture); force back to the loser's turn
        while (core.rec.state!.turn !== loser) core.tick(core.rec.deadline!);
        core.rec.seats[1 - loser]!.timeouts = 0;
      } else {
        expect(step.finished).toBe(true);
      }
    }
    expect(core.rec.status).toBe("over");
    expect(core.rec.over).toMatchObject({ winner: 1 - loser, reason: "timeout" });
    expect(core.rec.deadline).toBeNull();
  });
});

describe("dropping and returning", () => {
  test("a dropped player forfeits only after the grace period", () => {
    const { core, adaSeat, beaSeat } = seated();
    const drop = T0 + 10_000;
    const step = core.setOnline(adaSeat, false, drop);
    expect(kinds(step.out)).toEqual(["players"]);
    expect(core.players()[adaSeat]!.connected).toBe(false);

    expect(core.tick(drop + RECONNECT_MS - 1).finished).toBe(false);
    expect(core.rec.status).toBe("playing");
    const out = core.tick(drop + RECONNECT_MS);
    expect(out.finished).toBe(true);
    expect(core.rec.over).toMatchObject({ winner: beaSeat, reason: "forfeit" });
  });

  test("coming back in time cancels the forfeit", () => {
    const { core, adaSeat } = seated();
    core.setOnline(adaSeat, false, T0 + 1000);
    const back = core.join(ada, T0 + 20_000);
    expect(isFailure(back)).toBe(false);
    expect(core.players()[adaSeat]!.connected).toBe(true);
    expect(core.tick(T0 + 1000 + RECONNECT_MS + 1).finished).toBe(false);
    expect(core.rec.status).toBe("playing");
  });

  test("when both drop, whoever dropped first forfeits", () => {
    const { core, adaSeat, beaSeat } = seated();
    core.setOnline(beaSeat, false, T0 + 1000);
    core.setOnline(adaSeat, false, T0 + 2000);
    core.tick(T0 + 2000 + RECONNECT_MS + 5000); // both are past the grace period by now
    expect(core.rec.over).toMatchObject({ winner: adaSeat, reason: "forfeit" }); // Bea left first, so Bea loses
  });

  test("going online or offline twice changes nothing", () => {
    const { core, adaSeat } = seated();
    expect(core.setOnline(adaSeat, true, T0).out).toEqual([]);
    core.setOnline(adaSeat, false, T0 + 100);
    expect(core.setOnline(adaSeat, false, T0 + 900).out).toEqual([]);
    expect(core.rec.seats[adaSeat]!.offlineSince).toBe(T0 + 100); // the clock keeps the first drop time
  });
});

describe("ending a game", () => {
  test("resigning hands the win to the opponent", () => {
    const { core, adaSeat, beaSeat } = seated();
    const step = core.resign(adaSeat, T0 + 50);
    expect(isFailure(step)).toBe(false);
    expect(core.rec.over).toMatchObject({ winner: beaSeat, reason: "resign" });
    expect(core.resign(adaSeat, T0 + 60)).toEqual({ error: "not_playing" });
  });

  test("a full game played through the room ends once, with a winner and a matching scoreboard", () => {
    for (let seed = 1; seed <= 15; seed++) {
      const core = new RoomCore(newRoom("K7QXM", seed % 2 ? "easy" : "hard", T0), () => seed);
      core.join(ada, T0);
      core.join(bea, T0);
      const rng = mulberry32(seed * 31);
      let now = T0;
      let finishedCount = 0;
      while (core.rec.status === "playing") {
        now += 3000;
        const state = core.rec.state!;
        const step = core.shot(state.turn, someShot(core, rng), now) as Step;
        expect(isFailure(step)).toBe(false);
        if (step.finished) finishedCount++;
      }
      expect(finishedCount).toBe(1);
      expect(core.rec.over!.reason).toBe("normal");
      expect(core.rec.over!.scores).toEqual(core.rec.state!.scores);
      expect(core.rec.over!.winner).toEqual(core.rec.state!.winner);
      expect(core.nextWake()).toBeGreaterThan(now);
    }
  });
});

describe("rematches", () => {
  function finished() {
    const t = seated();
    t.core.resign(t.adaSeat, T0 + 10);
    return t;
  }

  test("need both players to agree, then swap who shoots first", () => {
    const { core, adaSeat, beaSeat } = finished();
    const first = core.rec.firstSeat!;

    const one = core.rematch(adaSeat, T0 + 20);
    if (isFailure(one)) throw new Error(one.error);
    expect(kinds(one.out)).toEqual(["rematch"]);
    expect(core.rec.status).toBe("over");

    const two = core.rematch(beaSeat, T0 + 30);
    if (isFailure(two)) throw new Error(two.error);
    expect(kinds(two.out)).toEqual(["start"]);
    expect(core.rec.status).toBe("playing");
    expect(core.rec.state!.turn).toBe(1 - first);
    expect(core.rec.state!.scores).toEqual([0, 0]);
    expect(core.rec.over).toBeNull();
  });

  test("can't be requested while a game is on", () => {
    const { core, adaSeat } = seated();
    expect(core.rematch(adaSeat, T0)).toEqual({ error: "not_playing" });
  });
});

describe("clocks", () => {
  test("nextWake is the soonest of the turn deadline and any forfeit time", () => {
    const { core, adaSeat } = seated();
    expect(core.nextWake()).toBe(core.rec.deadline);
    core.setOnline(adaSeat, false, T0 + 1000);
    expect(core.nextWake()).toBe(Math.min(core.rec.deadline!, T0 + 1000 + RECONNECT_MS));
  });

  test("a room nobody joins expires; so does a finished one", () => {
    const empty = setup();
    empty.join(ada, T0);
    expect(empty.nextWake()).toBe(T0 + ROOM_IDLE_MS);
    expect(empty.tick(T0 + ROOM_IDLE_MS - 1).expired).toBe(false);
    expect(empty.tick(T0 + ROOM_IDLE_MS).expired).toBe(true);

    const { core, adaSeat } = seated();
    core.resign(adaSeat, T0);
    expect(core.tick(T0 + 1).expired).toBe(false);
    expect(core.tick(T0 + 11 * 60_000).expired).toBe(true);
  });

  test("tick does nothing when nothing is due", () => {
    const { core } = seated();
    const before = JSON.stringify(core.rec);
    expect(core.tick(T0 + 1000)).toEqual({ out: [], finished: false, expired: false });
    expect(JSON.stringify(core.rec)).toBe(before);
  });
});

describe("live aim", () => {
  function aimFor(core: RoomCore) {
    const state = core.rec.state!;
    const coinId = state.shooter ?? [...freeCoinIds(state.coins)][0];
    return { t: "aim" as const, seq: state.shots, coinId, angle: 1.23456, power: 0.05 };
  }

  test("the shooter's aim goes to the other player only, rounded, even below shooting power", () => {
    const { core } = seated();
    const turn = core.rec.state!.turn;
    const out = core.aim(turn, aimFor(core));
    expect(out).toEqual([{ to: turn === 0 ? 1 : 0, msg: { t: "aim", by: turn, coinId: aimFor(core).coinId, angle: 1.235, power: 0.05 } }]);
  });

  test("stopping aiming is passed on too", () => {
    const { core } = seated();
    const turn = core.rec.state!.turn;
    expect(core.aim(turn, { t: "aim_end", seq: core.rec.state!.shots })).toEqual([{ to: turn === 0 ? 1 : 0, msg: { t: "aim_end", by: turn } }]);
  });

  test("aim out of turn, from an old shot, or at a coin you can't shoot is dropped quietly", () => {
    const { core } = seated();
    const state = core.rec.state!;
    const waiting = (state.turn === 0 ? 1 : 0) as Seat;
    expect(core.aim(waiting, aimFor(core))).toEqual([]);
    expect(core.aim(state.turn, { ...aimFor(core), seq: state.shots - 1 })).toEqual([]);
    expect(core.aim(state.turn, { ...aimFor(core), coinId: 999 })).toEqual([]);
  });

  test("nothing is relayed before the game starts", () => {
    const core = setup();
    core.join(ada, T0);
    expect(core.aim(0, { t: "aim", seq: 0, coinId: 0, angle: 0, power: 0.5 })).toEqual([]);
  });

  test("power is kept between 0 and 1, and aiming changes nothing in the room", () => {
    const { core } = seated();
    const before = JSON.stringify(core.rec);
    const out = core.aim(core.rec.state!.turn, { ...aimFor(core), power: 7 });
    expect(out[0].msg).toMatchObject({ power: 1 });
    expect(JSON.stringify(core.rec)).toBe(before);
  });
});

describe("reactions", () => {
  test("go to the other player only, during a game and after it", () => {
    const { core } = seated();
    expect(core.react(0, "nice")).toEqual([{ to: 1, msg: { t: "react", by: 0, r: "nice" } }]);
    core.resign(1, T0);
    expect(core.react(1, "gg")).toEqual([{ to: 0, msg: { t: "react", by: 1, r: "gg" } }]);
  });

  test("aren't sent while waiting for an opponent", () => {
    const core = setup();
    core.join(ada, T0);
    expect(core.react(0, "clap")).toEqual([]);
  });

  test("only the preset ones are accepted", () => {
    expect(parseClientMsg('{"t":"react","r":"gg"}')).toEqual({ t: "react", r: "gg" });
    expect(parseClientMsg('{"t":"react","r":"you stink"}')).toBeNull();
    expect(parseClientMsg('{"t":"react","r":"toString"}')).toBeNull();
  });
});
