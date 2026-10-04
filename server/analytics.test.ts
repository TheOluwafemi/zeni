import { beforeEach, describe, expect, test } from "vitest";
import type { Db } from "./accounts";
import { report } from "./analytics";
import { recordResult } from "./ratings";
import { bump, logError, markActive } from "./telemetry";
import { testDb } from "./test-db";

let db: Db;
const NOW = Date.UTC(2026, 9, 10, 15, 0, 0); // 10 Oct 2026, 15:00 UTC
const DAY = 86_400_000;

async function addPlayer(id: string, createdAt: number): Promise<void> {
  await db
    .prepare("INSERT INTO players (id, nickname, code_hash, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)")
    .bind(id, id, `hash_${id}`, createdAt)
    .run();
}

beforeEach(async () => {
  db = testDb();
  await addPlayer("ada", NOW - 2 * DAY);
  await addPlayer("bea", NOW - 2 * DAY);
  await addPlayer("cyd", NOW);
});

describe("report", () => {
  test("is all zeros and empty lists for a brand-new database", async () => {
    const r = await report(testDb(), { now: NOW });
    expect(r.totals).toEqual({ players: 0, playersWhoPlayedOnline: 0, onlineGames: 0, feedback: 0 });
    expect(r.days).toHaveLength(14);
    expect(r.days[0].day).toBe("2026-10-10");
    expect(r.days.every((d) => d.opens === 0 && d.finished === 0 && d.avgMinutes === null)).toBe(true);
    expect(r.endings).toEqual([]);
    expect(r.errors).toEqual([]);
    expect(r.feedback).toEqual([]);
  });

  test("daily players, opens and new players land on the right days", async () => {
    await bump(db, "open", NOW);
    await bump(db, "open", NOW);
    await bump(db, "open", NOW - DAY);
    await bump(db, "computer_game", NOW);
    await markActive(db, "ada", NOW);
    await markActive(db, "bea", NOW);
    await markActive(db, "ada", NOW - DAY);

    const r = await report(db, { now: NOW });
    const today = r.days[0];
    expect(today).toMatchObject({ day: "2026-10-10", opens: 2, computerGames: 1, activePlayers: 2, newPlayers: 1 });
    expect(r.days[1]).toMatchObject({ day: "2026-10-09", opens: 1, activePlayers: 1, newPlayers: 0 });
    expect(r.days[2]).toMatchObject({ day: "2026-10-08", newPlayers: 2 });
  });

  test("games started versus finished, and how long finished games took", async () => {
    await bump(db, "game_start_quick", NOW);
    await bump(db, "game_start_friend", NOW);
    await bump(db, "game_start_friend", NOW);
    // Two finished today: 4 and 6 minutes long. A third started but was never finished.
    await recordResult(db, ["ada", "bea"], [5, 3], 0, "normal", NOW, "m1", NOW - 4 * 60_000);
    await recordResult(db, ["ada", "bea"], [2, 5], 1, "resign", NOW, "m2", NOW - 6 * 60_000);

    const today = (await report(db, { now: NOW })).days[0];
    expect(today).toMatchObject({ startedQuick: 1, startedFriend: 2, finished: 2, avgMinutes: 5 });
    expect(today.startedQuick + today.startedFriend - today.finished).toBe(1); // abandoned
  });

  test("an average length only counts games whose start was recorded", async () => {
    await recordResult(db, ["ada", "bea"], [5, 3], 0, "normal", NOW, "old"); // before start times were kept
    await recordResult(db, ["ada", "bea"], [5, 3], 0, "normal", NOW, "new", NOW - 2 * 60_000);
    expect((await report(db, { now: NOW })).days[0]).toMatchObject({ finished: 2, avgMinutes: 2 });
  });

  test("shows how games end, most common first", async () => {
    for (let i = 0; i < 3; i++) await recordResult(db, ["ada", "bea"], [5, 4], 0, "normal", NOW, `n${i}`);
    await recordResult(db, ["ada", "bea"], [0, 0], 1, "forfeit", NOW, "f1");
    await recordResult(db, ["ada", "bea"], [1, 0], 0, "resign", NOW, "r1");
    const r = await report(db, { now: NOW });
    expect(r.endings).toEqual([{ reason: "normal", count: 3 }, { reason: "forfeit", count: 1 }, { reason: "resign", count: 1 }]);
    expect(r.totals).toMatchObject({ onlineGames: 5, playersWhoPlayedOnline: 2 });
  });

  test("groups errors across days and lists the most frequent first", async () => {
    for (let i = 0; i < 4; i++) await logError(db, { source: "client", message: "frequent", version: "v2" }, NOW - (i % 2) * DAY);
    await logError(db, { source: "server", message: "rare" }, NOW);
    const r = await report(db, { now: NOW });
    expect(r.errors.map((e) => [e.message, e.count])).toEqual([["frequent", 4], ["rare", 1]]);
    expect(r.errors[0]).toMatchObject({ source: "client", version: "v2" });
  });

  test("ignores errors and activity older than the window", async () => {
    await logError(db, { source: "client", message: "ancient" }, NOW - 40 * DAY);
    await bump(db, "open", NOW - 40 * DAY);
    const r = await report(db, { now: NOW, days: 7 });
    expect(r.errors).toEqual([]);
    expect(r.days).toHaveLength(7);
    expect(r.days.some((d) => d.opens > 0)).toBe(false);
  });

  test("lists the newest feedback first, up to the limit", async () => {
    for (let i = 0; i < 5; i++) {
      await db.prepare("INSERT INTO feedback (at, message, nickname) VALUES (?1, ?2, ?3)").bind(NOW + i, `note ${i}`, i === 4 ? "ada" : null).run();
    }
    const r = await report(db, { now: NOW, feedbackCount: 3 });
    expect(r.feedback.map((f) => f.message)).toEqual(["note 4", "note 3", "note 2"]);
    expect(r.feedback[0].nickname).toBe("ada");
    expect(r.totals.feedback).toBe(5);
  });
});
