import { beforeEach, describe, expect, test } from "vitest";
import { handleAccounts, type Db } from "./accounts";
import { MIN_RATED_SHOTS, PAIR_RATED_PER_DAY, recordResult, type RatingResult } from "./ratings";

const DAY = 24 * 60 * 60 * 1000;
import { testDb } from "./test-db";

let db: Db;
let ada: string;
let bea: string;

async function signUp(nickname: string): Promise<string> {
  const request = new Request("https://zeni.test/api/register", {
    method: "POST",
    headers: { "CF-Connecting-IP": nickname },
    body: JSON.stringify({ nickname }),
  });
  const res = await handleAccounts(request, new URL(request.url), db);
  return ((await res!.json()) as { playerId: string }).playerId;
}

const row = (id: string) =>
  db.prepare("SELECT rating, games, wins, losses, draws FROM players WHERE id = ?1").bind(id).first<Record<string, number>>();

beforeEach(async () => {
  db = testDb();
  ada = await signUp("Ada");
  bea = await signUp("Bea");
});

describe("recordResult", () => {
  test("a win moves rating from loser to winner and logs the match", async () => {
    const r = await recordResult(db, [ada, bea], [6, 3], 0, "normal", 5000, "m1");
    expect(r).toEqual({ before: [1000, 1000], after: [1016, 984] });
    expect(await row(ada)).toEqual({ rating: 1016, games: 1, wins: 1, losses: 0, draws: 0 });
    expect(await row(bea)).toEqual({ rating: 984, games: 1, wins: 0, losses: 1, draws: 0 });
    expect(await db.prepare("SELECT * FROM matches").bind().first()).toMatchObject({
      id: "m1", p0: ada, p1: bea, score0: 6, score1: 3, winner: ada, reason: "normal", created_at: 5000,
    });
  });

  test("a win by the second seat is credited to them", async () => {
    await recordResult(db, [ada, bea], [2, 5], 1, "resign");
    expect(await row(ada)).toMatchObject({ rating: 984, losses: 1 });
    expect(await row(bea)).toMatchObject({ rating: 1016, wins: 1 });
  });

  test("a draw counts for both and leaves equal players where they were", async () => {
    const r = await recordResult(db, [ada, bea], [4, 4], "draw", "normal");
    expect(r).toEqual({ before: [1000, 1000], after: [1000, 1000] });
    expect(await row(ada)).toMatchObject({ games: 1, draws: 1, wins: 0, losses: 0 });
    expect(await db.prepare("SELECT winner FROM matches").bind().first()).toEqual({ winner: null });
  });

  test("total rating is conserved however many games are played", async () => {
    // A game a day, so the daily cap on repeat pairings doesn't apply.
    for (let i = 0; i < 20; i++) await recordResult(db, [ada, bea], [5, 4], (i % 3 === 0 ? 1 : 0) as 0 | 1, "normal", DAY * (i + 1));
    const a = (await row(ada))!;
    const b = (await row(bea))!;
    expect(a.rating + b.rating).toBe(2000);
    expect(a.games).toBe(20);
    expect(a.wins + a.losses).toBe(20);
  });

  test("an upset pays more than a favourite's win", async () => {
    await db.prepare("UPDATE players SET rating = 1400 WHERE id = ?1").bind(ada).run();
    const r = (await recordResult(db, [ada, bea], [3, 6], 1, "normal")) as RatingResult; // underdog Bea wins
    expect(r.after[1] - r.before[1]).toBeGreaterThan(16);
  });

  test("does nothing if a player no longer exists", async () => {
    expect(await recordResult(db, [ada, "ghost"], [1, 0], 0, "normal")).toBeNull();
    expect(await row(ada)).toMatchObject({ rating: 1000, games: 0 });
  });
});

describe("protection against farming rating with a second account", () => {
  test("a game that ends before it really started isn't rated, but is logged", async () => {
    const r = await recordResult(db, [ada, bea], [0, 0], 0, "resign", 5000, "quick", null, MIN_RATED_SHOTS - 1);
    expect(r).toEqual({ unrated: "short" });
    expect(await row(ada)).toMatchObject({ rating: 1000, games: 0, wins: 0 });
    expect(await db.prepare("SELECT rated FROM matches WHERE id = 'quick'").bind().first()).toEqual({ rated: 0 });
  });

  test(`the same two players get ${PAIR_RATED_PER_DAY} rated games a day; more are friendlies`, async () => {
    for (let i = 0; i < PAIR_RATED_PER_DAY; i++) {
      expect(await recordResult(db, [ada, bea], [5, 3], 0, "normal", 1000 + i, `g${i}`, null, 20)).toHaveProperty("after");
    }
    const extra = await recordResult(db, [bea, ada], [5, 3], 0, "normal", 2000, "extra", null, 20); // either seat order
    expect(extra).toEqual({ unrated: "repeat" });
    expect((await row(ada))!.games).toBe(PAIR_RATED_PER_DAY);
    // A day later, they count again.
    expect(await recordResult(db, [ada, bea], [5, 3], 0, "normal", 1000 + DAY + 1, "next", null, 20)).toHaveProperty("after");
  });

  test("a third player isn't affected by someone else's repeat pairings", async () => {
    const cyd = await signUp("Cyd");
    for (let i = 0; i < PAIR_RATED_PER_DAY; i++) await recordResult(db, [ada, bea], [5, 3], 0, "normal", 1000 + i, `g${i}`, null, 20);
    expect(await recordResult(db, [ada, cyd], [5, 3], 0, "normal", 2000, "c", null, 20)).toHaveProperty("after");
  });
});
