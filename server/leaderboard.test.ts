import { beforeEach, describe, expect, test } from "vitest";
import type { Db } from "./accounts";
import { handleLeaderboard, leaderboard, LEADERBOARD_SIZE } from "./leaderboard";
import { testDb } from "./test-db";

let db: Db;
let n = 0;

async function addPlayer(nickname: string, rating: number, games: number): Promise<void> {
  n++;
  await db
    .prepare("INSERT INTO players (id, nickname, code_hash, rating, games, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, 1, 1)")
    .bind(`id${n}`, nickname, `hash${n}`, rating, games)
    .run();
}

beforeEach(() => {
  db = testDb();
  n = 0;
});

describe("leaderboard", () => {
  test("is empty until someone has played", async () => {
    await addPlayer("Newcomer", 1000, 0);
    expect(await leaderboard(db)).toEqual([]);
  });

  test("lists players who have played, highest rating first", async () => {
    await addPlayer("Low", 950, 4);
    await addPlayer("High", 1300, 9);
    await addPlayer("Mid", 1100, 2);
    await addPlayer("Never", 1500, 0); // rating but no games: not listed
    const rows = await leaderboard(db);
    expect(rows.map((r) => r.nickname)).toEqual(["High", "Mid", "Low"]);
    expect(rows[0]).toEqual({ rank: 1, nickname: "High", rating: 1300, games: 9 });
  });

  test("players on equal ratings share a rank, and the next rank skips", async () => {
    await addPlayer("A", 1200, 3);
    await addPlayer("B", 1200, 7);
    await addPlayer("C", 1200, 1);
    await addPlayer("D", 1100, 5);
    const rows = await leaderboard(db);
    expect(rows.map((r) => [r.nickname, r.rank])).toEqual([["B", 1], ["A", 1], ["C", 1], ["D", 4]]); // ties: more games first
  });

  test(`shows at most ${LEADERBOARD_SIZE} players`, async () => {
    for (let i = 0; i < LEADERBOARD_SIZE + 25; i++) await addPlayer(`p${String(i).padStart(3, "0")}`, 1000 + i, 1);
    const rows = await leaderboard(db);
    expect(rows).toHaveLength(LEADERBOARD_SIZE);
    expect(rows[0].rating).toBe(1000 + LEADERBOARD_SIZE + 24);
    expect(rows.at(-1)!.rating).toBe(1000 + 25);
  });

  test("never exposes anything but name, rating and games", async () => {
    await addPlayer("Ada", 1010, 1);
    expect(Object.keys((await leaderboard(db))[0]).sort()).toEqual(["games", "nickname", "rank", "rating"]);
  });
});

describe("handleLeaderboard", () => {
  test("answers GET /api/leaderboard with a cacheable board, and ignores everything else", async () => {
    await addPlayer("Ada", 1010, 1);
    const get = new Request("https://zeni.test/api/leaderboard");
    const res = (await handleLeaderboard(get, new URL(get.url), db))!;
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("max-age=30");
    expect(((await res.json()) as { players: unknown[] }).players).toHaveLength(1);

    const post = new Request("https://zeni.test/api/leaderboard", { method: "POST" });
    expect(await handleLeaderboard(post, new URL(post.url), db)).toBeNull();
    const other = new Request("https://zeni.test/api/me");
    expect(await handleLeaderboard(other, new URL(other.url), db)).toBeNull();
  });
});
