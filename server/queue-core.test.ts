import { describe, expect, test } from "vitest";
import { parseQueueMsg } from "../shared/protocol";
import { CLOSE, OFFER_MS, OPEN_GRACE_MS, QueueCore, type QAction, type QEntry } from "./queue-core";

const T0 = 1_000_000;

function setup() {
  let n = 0;
  return new QueueCore(new Map<string, QEntry>(), "easy", () => `offer${++n}`);
}

const player = (sid: string, rating = 1000, since = T0) => ({ sid, playerId: `p_${sid}`, nickname: sid.toUpperCase(), rating, since });

const sent = (actions: QAction[], sid: string) =>
  actions.filter((a) => a.kind === "send" && a.sid === sid).map((a) => (a as Extract<QAction, { kind: "send" }>).msg);
const closed = (actions: QAction[]) => actions.filter((a) => a.kind === "close").map((a) => (a as Extract<QAction, { kind: "close" }>).sid);
const opens = (actions: QAction[]) => actions.filter((a) => a.kind === "open") as Extract<QAction, { kind: "open" }>[];

/** Two players queued and offered a match. */
function offered() {
  const q = setup();
  q.join(player("ada"));
  q.join(player("bea"));
  const actions = q.pair(T0);
  return { q, actions, offer: q.entries.get("ada")!.offer!.id };
}

describe("joining the queue", () => {
  test("says how many are waiting", () => {
    const q = setup();
    expect(sent(q.join(player("ada")), "ada")).toEqual([{ t: "queued", waiting: 1 }]);
    expect(sent(q.join(player("bea")), "bea")).toEqual([{ t: "queued", waiting: 2 }]);
  });

  test("a second tab for the same player replaces the first", () => {
    const q = setup();
    q.join(player("ada"));
    const actions = q.join({ ...player("ada2"), playerId: "p_ada" });
    expect(sent(actions, "ada")).toEqual([{ t: "error", error: "already_queued" }]);
    expect(closed(actions)).toEqual(["ada"]);
    expect([...q.entries.keys()]).toEqual(["ada2"]);
  });

  test("replacing a tab that was mid-offer puts the partner back in line", () => {
    const { q } = offered();
    const actions = q.join({ ...player("ada2"), playerId: "p_ada" });
    expect(sent(actions, "bea")).toEqual([{ t: "offer_cancelled", reason: "left" }]);
    expect(q.entries.get("bea")!.offer).toBeNull();
  });
});

describe("offers", () => {
  test("two compatible players are each offered the other", () => {
    const { actions, q } = offered();
    expect(sent(actions, "ada")).toEqual([{ t: "offer", offer: "offer1", table: "easy", expiresIn: OFFER_MS, opponent: { nickname: "BEA", rating: 1000 } }]);
    expect(sent(actions, "bea")[0]).toMatchObject({ t: "offer", offer: "offer1", opponent: { nickname: "ADA" } });
    expect(q.waiting()).toHaveLength(0); // neither can be offered to anyone else meanwhile
  });

  test("someone mid-offer isn't offered to a third player", () => {
    const { q } = offered();
    q.join(player("cyd"));
    expect(q.pair(T0 + 100)).toEqual([]);
  });

  test("one acceptance waits for the other; both open a room", () => {
    const { q, offer } = offered();
    expect(q.accept("ada", offer)).toEqual([]);
    const both = q.accept("bea", offer);
    expect(opens(both)).toEqual([{ kind: "open", offer, sids: ["ada", "bea"], players: ["p_ada", "p_bea"] }]);
  });

  test("accepting a stale or someone else's offer does nothing", () => {
    const { q, offer } = offered();
    expect(q.accept("ada", "not-the-offer")).toEqual([]);
    expect(q.accept("nobody", offer)).toEqual([]);
    expect(q.entries.get("ada")!.offer!.accepted).toBe(false);
  });

  test("once the room is open, both are sent to it and leave the queue", () => {
    const { q, offer } = offered();
    q.accept("ada", offer);
    q.accept("bea", offer);
    const actions = q.opened(offer, "K7QXM");
    expect(sent(actions, "ada")).toEqual([{ t: "matched", room: "K7QXM", table: "easy" }]);
    expect(sent(actions, "bea")).toEqual([{ t: "matched", room: "K7QXM", table: "easy" }]);
    expect(closed(actions).sort()).toEqual(["ada", "bea"]);
    expect(q.entries.size).toBe(0);
  });

  test("if the room can't be opened, both go back in line with their places kept", () => {
    const { q, offer } = offered();
    q.accept("ada", offer);
    q.accept("bea", offer);
    const actions = q.openFailed(offer);
    expect(sent(actions, "ada")).toEqual([{ t: "offer_cancelled", reason: "server" }]);
    expect(q.waiting().map((e) => [e.sid, e.since])).toEqual([["ada", T0], ["bea", T0]]);
  });
});

describe("when an offer falls through", () => {
  test("declining leaves the queue, and the other player goes back in line in their old place", () => {
    const { q, offer } = offered();
    q.accept("bea", offer);
    const actions = q.decline("ada", offer);
    expect(closed(actions)).toEqual(["ada"]);
    expect(sent(actions, "bea")).toEqual([{ t: "offer_cancelled", reason: "declined" }]);
    expect(q.waiting().map((e) => [e.sid, e.since])).toEqual([["bea", T0]]);
  });

  test("leaving mid-offer puts the other player back in line", () => {
    const { q } = offered();
    const actions = q.gone("bea");
    expect(sent(actions, "ada")).toEqual([{ t: "offer_cancelled", reason: "left" }]);
    expect(q.waiting().map((e) => e.sid)).toEqual(["ada"]);
  });

  test("an offer nobody answers removes both", () => {
    const { q } = offered();
    expect(q.expire(T0 + OFFER_MS - 1)).toEqual([]);
    const actions = q.expire(T0 + OFFER_MS);
    expect(closed(actions).sort()).toEqual(["ada", "bea"]);
    expect(q.entries.size).toBe(0);
  });

  test("an offer only one answers removes the other, and the one who said yes keeps their place", () => {
    const { q, offer } = offered();
    q.accept("ada", offer);
    const actions = q.expire(T0 + OFFER_MS);
    expect(closed(actions)).toEqual(["bea"]);
    expect(actions.find((a) => a.kind === "close")).toMatchObject({ code: CLOSE.expired });
    expect(sent(actions, "ada")).toEqual([{ t: "offer_cancelled", reason: "expired" }]);
    expect(q.waiting().map((e) => [e.sid, e.since])).toEqual([["ada", T0]]);
  });

  test("an offer both accepted is never expired, even while the room is being opened", () => {
    const { q, offer } = offered();
    q.accept("ada", offer);
    q.accept("bea", offer);
    expect(q.expire(T0 + OFFER_MS + OPEN_GRACE_MS - 1)).toEqual([]);
    expect(q.entries.size).toBe(2);
  });

  test("if the room never arrives after both accepted, both go back in line", () => {
    const { q, offer } = offered();
    q.accept("ada", offer);
    q.accept("bea", offer);
    expect(q.nextWake(T0)).toBe(T0 + OFFER_MS + OPEN_GRACE_MS);
    const actions = q.expire(T0 + OFFER_MS + OPEN_GRACE_MS);
    expect(sent(actions, "ada")).toEqual([{ t: "offer_cancelled", reason: "server" }]);
    expect(q.waiting()).toHaveLength(2);
  });

  test("an offer whose partner vanished is cancelled", () => {
    const { q } = offered();
    q.entries.delete("bea"); // their socket dropped while the queue was asleep
    expect(sent(q.dropOrphans(), "ada")).toEqual([{ t: "offer_cancelled", reason: "left" }]);
    expect(q.waiting().map((e) => e.sid)).toEqual(["ada"]);
  });

  test("the player put back in line is offered the next person who arrives", () => {
    const { q, offer } = offered();
    q.decline("bea", offer);
    q.join(player("cyd", 1000, T0 + 5000));
    const actions = q.pair(T0 + 5000);
    expect(sent(actions, "ada")[0]).toMatchObject({ t: "offer", opponent: { nickname: "CYD" } });
  });
});

describe("waking up", () => {
  test("wakes for the soonest offer to run out, and to retry pairing while two or more wait", () => {
    const { q } = offered();
    expect(q.nextWake(T0)).toBe(T0 + OFFER_MS);

    const q2 = setup();
    expect(q2.nextWake(T0)).toBeNull();
    q2.join(player("ada", 1000));
    expect(q2.nextWake(T0)).toBeNull(); // one person can't be paired
    q2.join(player("far", 1900));
    expect(q2.nextWake(T0)).toBe(T0 + 2000); // too far apart now; the gap widens with time
  });
});

test("accept and decline messages are parsed, junk is not", () => {
  expect(parseQueueMsg('{"t":"accept","offer":"abc"}')).toEqual({ t: "accept", offer: "abc" });
  expect(parseQueueMsg('{"t":"decline","offer":"abc"}')).toEqual({ t: "decline", offer: "abc" });
  expect(parseQueueMsg('{"t":"accept"}')).toBeNull();
  expect(parseQueueMsg(`{"t":"accept","offer":"${"x".repeat(65)}"}`)).toBeNull();
});
