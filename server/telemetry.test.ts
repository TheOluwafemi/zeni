import { beforeEach, describe, expect, test } from "vitest";
import { handleAccounts, type Db } from "./accounts";
import { bump, CLIENT_EVENTS, dayOf, fingerprint, handleTelemetry, LIMITS, logError, logServerError, markActive } from "./telemetry";
import { testDb } from "./test-db";

let db: Db;
beforeEach(() => {
  db = testDb();
});

async function post(path: string, body: unknown, { ip = "1.1.1.1", code }: { ip?: string; code?: string } = {}) {
  const headers: Record<string, string> = { "CF-Connecting-IP": ip, "User-Agent": "TestBrowser/1.0" };
  if (code) headers.Authorization = `Bearer ${code}`;
  const request = new Request(`https://zeni.test${path}`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const res = await handleTelemetry(request, new URL(request.url), db);
  return { status: res!.status, body: (await res!.json()) as Record<string, any> };
}

const rows = async (sql: string) => {
  // test-db only exposes first(); read everything through a small loop on rowids
  const out: Record<string, any>[] = [];
  const { results } = await db.prepare(sql).bind().all<Record<string, any>>();
  out.push(...results);
  return out;
};

describe("feedback", () => {
  test("is stored, and works without being signed in", async () => {
    const r = await post("/api/feedback", { message: "The coins feel great", screen: "home", version: "abc1234" });
    expect(r.status).toBe(201);
    const [row] = await rows("SELECT * FROM feedback");
    expect(row).toMatchObject({ message: "The coins feel great", screen: "home", version: "abc1234", player_id: null, nickname: null, user_agent: "TestBrowser/1.0" });
  });

  test("attaches the nickname when the sender is signed in", async () => {
    const reg = new Request("https://zeni.test/api/register", { method: "POST", headers: { "CF-Connecting-IP": "9.9.9.9" }, body: JSON.stringify({ nickname: "Ada" }) });
    const { code } = (await (await handleAccounts(reg, new URL(reg.url), db))!.json()) as { code: string };
    await post("/api/feedback", { message: "Hello" }, { code });
    expect((await rows("SELECT nickname FROM feedback"))[0].nickname).toBe("Ada");
  });

  test("a wrong player code doesn't block feedback, it's just anonymous", async () => {
    expect((await post("/api/feedback", { message: "Hi" }, { code: "ZENI-AAAA-BBBB-CCCC-DDDD" })).status).toBe(201);
    expect((await rows("SELECT nickname FROM feedback"))[0].nickname).toBeNull();
  });

  test("keeps the contact only if given, and trims long input", async () => {
    await post("/api/feedback", { message: "x".repeat(5000), contact: "  me@example.com  " });
    await post("/api/feedback", { message: "no contact", contact: "   " });
    const stored = await rows("SELECT message, contact FROM feedback ORDER BY id");
    expect(stored[0].message).toHaveLength(2000);
    expect(stored[0].contact).toBe("me@example.com");
    expect(stored[1].contact).toBeNull();
  });

  test("rejects empty or malformed requests", async () => {
    expect((await post("/api/feedback", { message: "   " })).status).toBe(400);
    expect((await post("/api/feedback", {})).status).toBe(400);
    expect((await post("/api/feedback", { message: 42 })).status).toBe(400);
    expect((await post("/api/feedback", "not json")).status).toBe(400);
    expect(await rows("SELECT * FROM feedback")).toHaveLength(0);
  });

  test("is rate limited per address", async () => {
    const [limit] = LIMITS.feedback;
    for (let i = 0; i < limit; i++) expect((await post("/api/feedback", { message: `m${i}` })).status).toBe(201);
    expect((await post("/api/feedback", { message: "one too many" })).status).toBe(429);
    expect((await post("/api/feedback", { message: "other address" }, { ip: "2.2.2.2" })).status).toBe(201);
  });
});

describe("error logging", () => {
  test("a client report is stored with where it happened and which build", async () => {
    const r = await post("/api/log", { message: "Cannot read properties of null", stack: "Error\n    at draw (app.js:10:5)", screen: "game", version: "abc1234" });
    expect(r.status).toBe(201);
    const [row] = await rows("SELECT * FROM error_log");
    expect(row).toMatchObject({ source: "client", message: "Cannot read properties of null", screen: "game", version: "abc1234", count: 1 });
  });

  test("the same error many times is one row with a count, even if line numbers move", async () => {
    await post("/api/log", { message: "boom", stack: "Error\n    at draw (app.js:10:5)" });
    await post("/api/log", { message: "boom", stack: "Error\n    at draw (app.js:10:9)" });
    await post("/api/log", { message: "boom", stack: "Error\n    at draw (app.js:11:5)" });
    const all = await rows("SELECT message, count FROM error_log");
    expect(all).toEqual([{ message: "boom", count: 3 }]);
  });

  test("different errors are different rows", async () => {
    await post("/api/log", { message: "one" });
    await post("/api/log", { message: "two" });
    expect(await rows("SELECT * FROM error_log")).toHaveLength(2);
  });

  test("the same error on different days is counted separately", async () => {
    await logError(db, { source: "server", message: "same" }, Date.UTC(2026, 9, 3, 12));
    await logError(db, { source: "server", message: "same" }, Date.UTC(2026, 9, 4, 12));
    expect((await rows("SELECT day, count FROM error_log ORDER BY day")).map((r) => [r.day, r.count])).toEqual([["2026-10-03", 1], ["2026-10-04", 1]]);
  });

  test("oversized messages and stacks are cut down", async () => {
    await post("/api/log", { message: "m".repeat(2000), stack: "s".repeat(9000) });
    const [row] = await rows("SELECT message, stack FROM error_log");
    expect(row.message).toHaveLength(300);
    expect(row.stack).toHaveLength(1500);
  });

  test("is rate limited, and refuses empty reports", async () => {
    expect((await post("/api/log", { message: "" })).status).toBe(400);
    const [limit] = LIMITS.log;
    for (let i = 0; i < limit; i++) await post("/api/log", { message: `e${i}` });
    expect((await post("/api/log", { message: "flood" })).status).toBe(429);
  });

  test("the server can log its own errors, and never throws while doing it", async () => {
    await logServerError(db, "room", new Error("could not record result"));
    expect((await rows("SELECT source, message FROM error_log"))[0]).toEqual({ source: "room", message: "could not record result" });

    const broken = { prepare: () => { throw new Error("database is down"); }, batch: async () => [] } as unknown as Db;
    await expect(logServerError(broken, "server", new Error("x"))).resolves.toBeUndefined();
    await expect(logServerError(db, "server", "just a string")).resolves.toBeUndefined();
  });

  test("fingerprints ignore line numbers but not the message or the function", async () => {
    const a = await fingerprint("client", "boom", "Error\n    at draw (app.js:10:5)");
    expect(await fingerprint("client", "boom", "Error\n    at draw (app.js:99:1)")).toBe(a);
    expect(await fingerprint("client", "bang", "Error\n    at draw (app.js:10:5)")).not.toBe(a);
    expect(await fingerprint("client", "boom", "Error\n    at update (app.js:10:5)")).not.toBe(a);
    expect(await fingerprint("server", "boom", "Error\n    at draw (app.js:10:5)")).not.toBe(a);
  });
});

describe("anonymous counters", () => {
  test("count only the events clients are allowed to report", async () => {
    for (const name of CLIENT_EVENTS) expect((await post("/api/event", { name })).status).toBe(202);
    await post("/api/event", { name: "open" });
    await post("/api/event", { name: "make_me_rich" }); // ignored
    await post("/api/event", { name: 5 }); // ignored
    const counts = Object.fromEntries((await rows("SELECT name, count FROM daily_counters")).map((r) => [r.name, r.count]));
    expect(counts).toEqual({ open: 2, computer_game: 1, daily_puzzle: 1 });
  });

  test("keep a separate count for each day", async () => {
    await bump(db, "open", Date.UTC(2026, 9, 3, 23, 59));
    await bump(db, "open", Date.UTC(2026, 9, 4, 0, 1));
    await bump(db, "open", Date.UTC(2026, 9, 4, 8, 0));
    expect((await rows("SELECT day, count FROM daily_counters ORDER BY day")).map((r) => [r.day, r.count])).toEqual([["2026-10-03", 1], ["2026-10-04", 2]]);
  });

  test("store nothing that identifies the sender", async () => {
    await post("/api/event", { name: "open" }, { ip: "203.0.113.7" });
    const columns = Object.keys((await rows("SELECT * FROM daily_counters"))[0]);
    expect(columns.sort()).toEqual(["count", "day", "name"]);
    expect(JSON.stringify(await rows("SELECT * FROM rate_limits WHERE key LIKE 'event:%'"))).toContain("event:203.0.113.7"); // only the short-lived limiter sees the address
  });
});

describe("daily players", () => {
  test("count each player once per day, however often they're seen", async () => {
    const noon = Date.UTC(2026, 9, 3, 12);
    await markActive(db, "ada", noon);
    await markActive(db, "ada", noon + 3600_000);
    await markActive(db, "bea", noon);
    await markActive(db, "ada", noon + 24 * 3600_000);
    const perDay = await rows("SELECT day, COUNT(*) AS players FROM daily_active GROUP BY day ORDER BY day");
    expect(perDay.map((r) => [r.day, r.players])).toEqual([["2026-10-03", 2], ["2026-10-04", 1]]);
  });
});

test("dayOf is UTC", () => {
  expect(dayOf(Date.UTC(2026, 9, 3, 23, 59, 59))).toBe("2026-10-03");
  expect(dayOf(Date.UTC(2026, 9, 4, 0, 0, 0))).toBe("2026-10-04");
});

test("other routes and methods fall through", async () => {
  for (const [method, path] of [["GET", "/api/feedback"], ["POST", "/api/me"], ["POST", "/api/health"]] as const) {
    const request = new Request(`https://zeni.test${path}`, { method, body: method === "POST" ? "{}" : undefined });
    expect(await handleTelemetry(request, new URL(request.url), db)).toBeNull();
  }
});
