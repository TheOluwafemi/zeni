import { beforeEach, describe, expect, test } from "vitest";
import { allow, handleAccounts, LIMITS, type Db } from "./accounts";
import { testDb } from "./test-db";

let db: Db;
beforeEach(() => {
  db = testDb();
});

interface Call {
  method?: string;
  body?: unknown;
  code?: string;
  ip?: string;
}

/** Call the account routes the way the Worker does. Returns status and parsed body. */
async function call(path: string, { method = "GET", body, code, ip = "1.1.1.1" }: Call = {}) {
  const headers: Record<string, string> = { "CF-Connecting-IP": ip };
  if (code) headers.Authorization = `Bearer ${code}`;
  const request = new Request(`https://zeni.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await handleAccounts(request, new URL(request.url), db);
  expect(res).not.toBeNull();
  return { status: res!.status, body: (await res!.json()) as Record<string, any> };
}

const register = (nickname: string, ip?: string) => call("/api/register", { method: "POST", body: { nickname }, ip });
const restore = (code: string, ip?: string) => call("/api/restore", { method: "POST", body: { code }, ip });

describe("a new player", () => {
  test("picks a free nickname and gets a code that signs them in", async () => {
    const r = await register("Ada");
    expect(r.status).toBe(201);
    expect(r.body.nickname).toBe("Ada");
    expect(r.body.code).toMatch(/^ZENI-[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/);

    const me = await call("/api/me", { code: r.body.code });
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ nickname: "Ada", rating: 1000, games: 0, position: null });
  });

  test("never has their code stored", async () => {
    const r = await register("Ada");
    const raw = r.body.code.replace(/^ZENI-/, "").replaceAll("-", "");
    const rows = (db.prepare("SELECT code_hash FROM players").bind() as any);
    const row = await rows.first();
    expect(row.code_hash).not.toContain(raw);
    expect(row.code_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("is told when a nickname is invalid or taken", async () => {
    expect((await register("ab")).body).toMatchObject({ error: "invalid_nickname", reason: "length" });
    expect((await register("Kénji")).body).toMatchObject({ reason: "characters" });
    expect((await register("Admin")).body).toMatchObject({ reason: "reserved" });
    await register("Ada");
    const again = await register("ADA"); // names clash regardless of case
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("nickname_taken");
  });

  test("can check a name is free before choosing it", async () => {
    expect((await call("/api/nickname/Ada")).body).toEqual({ available: true });
    await register("Ada");
    expect((await call("/api/nickname/ada")).body).toEqual({ available: false, reason: "taken" });
    expect((await call("/api/nickname/x")).body).toEqual({ available: false, reason: "length" });
  });
});

describe("a second device", () => {
  test("becomes the same player with the code, however it's pasted", async () => {
    const { body: ada } = await register("Ada");
    for (const pasted of [ada.code, ada.code.toLowerCase(), ada.code.replaceAll("-", " ")]) {
      const r = await restore(pasted);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ playerId: ada.playerId, nickname: "Ada" });
    }
  });
});

describe("someone trying to be the player named Kenji", () => {
  test("cannot take the name, and a look-alike is a separate empty player", async () => {
    const { body: kenji } = await register("Kenji");
    await db.prepare("UPDATE players SET rating = 1700, games = 50 WHERE id = ?1").bind(kenji.playerId).run();

    expect((await register("kenji")).status).toBe(409);
    const impostor = await register("Kenji2");
    expect(impostor.status).toBe(201);
    const me = await call("/api/me", { code: impostor.body.code });
    expect(me.body).toMatchObject({ nickname: "Kenji2", rating: 1000, games: 0 });
  });

  test("cannot restore without the code, and guessing is throttled", async () => {
    await register("Kenji");
    const guesses = [];
    for (let i = 0; i < 7; i++) guesses.push(await restore("ZENI-AAAA-BBBB-CCCC-DDDD"));
    expect(guesses.slice(0, 5).map((g) => g.status)).toEqual([404, 404, 404, 404, 404]);
    expect(guesses.slice(5).map((g) => g.status)).toEqual([429, 429]);
    // A different address is unaffected.
    expect((await restore("ZENI-AAAA-BBBB-CCCC-DDDD", "2.2.2.2")).status).toBe(404);
  });

  test("a nickname in the Authorization header is not a credential", async () => {
    await register("Kenji");
    expect((await call("/api/me", { code: "Kenji" })).status).toBe(401);
    expect((await call("/api/me")).status).toBe(401);
  });
});

describe("a leaked code", () => {
  test("rotating it stops the old code everywhere and gives a new one", async () => {
    const { body: ada } = await register("Ada");
    const rotated = await call("/api/me/code", { method: "POST", code: ada.code });
    expect(rotated.status).toBe(200);
    expect(rotated.body.code).not.toBe(ada.code);

    expect((await call("/api/me", { code: ada.code })).status).toBe(401);
    expect((await restore(ada.code)).status).toBe(404);
    const me = await call("/api/me", { code: rotated.body.code });
    expect(me.body.nickname).toBe("Ada");
  });
});

describe("renaming", () => {
  test("works for a free name, fails for a taken or invalid one", async () => {
    const { body: ada } = await register("Ada");
    await register("Bea");
    const rename = (nickname: string) => call("/api/me/nickname", { method: "PUT", code: ada.code, body: { nickname } });

    expect((await rename("Bea")).status).toBe(409);
    expect((await rename("x")).body.reason).toBe("length");
    expect((await rename("Ada_Two")).body).toEqual({ nickname: "Ada_Two" });
    expect((await call("/api/me", { code: ada.code })).body.nickname).toBe("Ada_Two");
    expect((await call("/api/nickname/Ada")).body).toEqual({ available: true }); // old name is free again
  });

  test("can change only the case of their own name", async () => {
    const { body: ada } = await register("Ada");
    const r = await call("/api/me/nickname", { method: "PUT", code: ada.code, body: { nickname: "ADA" } });
    expect(r.status).toBe(200);
  });
});

describe("leaderboard position", () => {
  test("counts players with games who out-rate you", async () => {
    const a = await register("Ada");
    const b = await register("Bea");
    const c = await register("Cyd");
    await db.prepare("UPDATE players SET rating = 1300, games = 5 WHERE id = ?1").bind(a.body.playerId).run();
    await db.prepare("UPDATE players SET rating = 1100, games = 5 WHERE id = ?1").bind(b.body.playerId).run();
    expect((await call("/api/me", { code: a.body.code })).body.position).toBe(1);
    expect((await call("/api/me", { code: b.body.code })).body.position).toBe(2);
    expect((await call("/api/me", { code: c.body.code })).body.position).toBeNull();
  });
});

describe("rate limiter", () => {
  test("allows up to the limit in a window, then resets in the next", async () => {
    const [limit, windowSec] = LIMITS.restore;
    const t0 = 1_000_000;
    for (let i = 0; i < limit; i++) expect(await allow(db, "k", LIMITS.restore, t0 + i)).toBe(true);
    expect(await allow(db, "k", LIMITS.restore, t0 + limit)).toBe(false);
    expect(await allow(db, "k", LIMITS.restore, t0 + windowSec * 1000 + 1)).toBe(true);
    expect(await allow(db, "other", LIMITS.restore, t0)).toBe(true);
  });
});

test("routes that aren't account routes fall through", async () => {
  const request = new Request("https://zeni.test/api/health");
  expect(await handleAccounts(request, new URL(request.url), db)).toBeNull();
});
