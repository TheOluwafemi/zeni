import { describe, expect, test } from "vitest";
import { allow } from "./accounts";
import { ERROR_LOG_KEEP_DAYS, maintenance, RATE_LIMIT_KEEP_MS } from "./maintenance";
import { logError } from "./telemetry";
import { testDb } from "./test-db";

const NOW = Date.UTC(2026, 9, 10, 3, 0, 0);
const DAY = 86_400_000;

describe("maintenance", () => {
  test("removes rate-limit counters older than a day, and keeps recent ones", async () => {
    const db = testDb();
    await allow(db, "register:1.2.3.4", [10, 3600], NOW - RATE_LIMIT_KEEP_MS - 1000); // stale
    await allow(db, "register:5.6.7.8", [10, 3600], NOW - 3600_000); // an hour old
    await maintenance(db, NOW);
    const left = (await db.prepare("SELECT key FROM rate_limits").bind().all<{ key: string }>()).results.map((r) => r.key);
    expect(left).toEqual(["register:5.6.7.8"]);
  });

  test("removes old error reports but keeps recent ones", async () => {
    const db = testDb();
    await logError(db, { source: "client", message: "ancient" }, NOW - (ERROR_LOG_KEEP_DAYS + 5) * DAY);
    await logError(db, { source: "client", message: "recent" }, NOW - 2 * DAY);
    await maintenance(db, NOW);
    const left = (await db.prepare("SELECT message FROM error_log").bind().all<{ message: string }>()).results.map((r) => r.message);
    expect(left).toEqual(["recent"]);
  });

  test("never touches players, games, feedback or counts", async () => {
    const db = testDb();
    await db.prepare("INSERT INTO players (id, nickname, code_hash, created_at, updated_at) VALUES ('a','Ada','h',1,1)").bind().run();
    await db.prepare("INSERT INTO feedback (at, message) VALUES (1, 'old note')").bind().run();
    await db.prepare("INSERT INTO daily_counters (day, name, count) VALUES ('2020-01-01', 'open', 9)").bind().run();
    await maintenance(db, NOW);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM players").bind().first()).toEqual({ n: 1 });
    expect(await db.prepare("SELECT COUNT(*) AS n FROM feedback").bind().first()).toEqual({ n: 1 });
    expect(await db.prepare("SELECT COUNT(*) AS n FROM daily_counters").bind().first()).toEqual({ n: 1 });
  });
});
