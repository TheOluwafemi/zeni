import { beforeEach, describe, expect, test } from "vitest";
import { handleAccounts, type Db } from "./accounts";
import { CHALLENGE_MS, challengeStarted, DECLINED_COOLDOWN_MS, handleChallenges, MAX_OUTGOING, type OpenRoom } from "./challenges";
import { maintenance } from "./maintenance";
import { testDb } from "./test-db";

const T0 = 1_800_000_000_000;
let db: Db;
let opened: { code: string; table: string; players: [string, string] }[];
let roomOk: boolean;
let codeN: number;
let now: number;

const openRoom: OpenRoom = async (code, table, players) => {
  if (!roomOk) return false;
  opened.push({ code, table, players });
  return true;
};

beforeEach(() => {
  db = testDb();
  opened = [];
  roomOk = true;
  codeN = 0;
  now = T0;
});

async function register(nickname: string): Promise<{ code: string; id: string }> {
  const req = new Request("https://zeni.test/api/register", { method: "POST", body: JSON.stringify({ nickname }), headers: { "CF-Connecting-IP": nickname } });
  const res = await handleAccounts(req, new URL(req.url), db);
  const body = (await res!.json()) as { code: string; playerId: string };
  return { code: body.code, id: body.playerId };
}

async function call(path: string, code: string, method = "GET", body?: unknown) {
  const req = new Request(`https://zeni.test${path}`, {
    method,
    headers: { Authorization: `Bearer ${code}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await handleChallenges(req, new URL(req.url), db, openRoom, () => `ROOM${++codeN}`, now);
  expect(res).not.toBeNull();
  return { status: res!.status, body: (await res!.json()) as Record<string, any> };
}

const challenge = (from: string, to: string, table = "easy") => call("/api/challenges", from, "POST", { to, table });
const lists = (code: string) => call("/api/me/challenges", code);

describe("challenging someone", () => {
  test("opens a room reserved for the two of you, and both see it", async () => {
    const ada = await register("Ada");
    const bea = await register("Bea");
    const r = await challenge(ada.code, "bea", "hard"); // nicknames match regardless of case
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ room: "ROOM1", table: "hard", status: "open", expiresIn: CHALLENGE_MS, to: { nickname: "Bea", rating: 1000 } });
    expect(opened).toEqual([{ code: "ROOM1", table: "hard", players: [ada.id, bea.id] }]);

    expect((await lists(bea.code)).body.incoming).toEqual([expect.objectContaining({ room: "ROOM1", from: { nickname: "Ada", rating: 1000 } })]);
    expect((await lists(ada.code)).body.outgoing).toEqual([expect.objectContaining({ room: "ROOM1", to: { nickname: "Bea", rating: 1000 } })]);
    expect((await lists(ada.code)).body.incoming).toEqual([]);
  });

  test("never reveals player ids", async () => {
    const ada = await register("Ada");
    const bea = await register("Bea");
    await challenge(ada.code, "Bea");
    const text = JSON.stringify([(await lists(ada.code)).body, (await lists(bea.code)).body]);
    expect(text).not.toContain(ada.id);
    expect(text).not.toContain(bea.id);
  });

  test("challenging the same person again gives back the open challenge", async () => {
    const ada = await register("Ada");
    await register("Bea");
    const first = await challenge(ada.code, "Bea");
    const again = await challenge(ada.code, "Bea");
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(first.body.id);
    expect(opened).toHaveLength(1);
  });

  test("you can't challenge yourself or someone who doesn't exist", async () => {
    const ada = await register("Ada");
    expect((await challenge(ada.code, "Ada")).body.error).toBe("self");
    expect((await challenge(ada.code, "Nobody")).body.error).toBe("unknown_player");
    expect((await call("/api/challenges", ada.code, "POST", { to: 42 })).body.error).toBe("unknown_player");
  });

  test("needs a player", async () => {
    expect((await call("/api/me/challenges", "ZENI-AAAA-BBBB-CCCC-DDDD")).status).toBe(401);
  });

  test(`at most ${MAX_OUTGOING} open at once`, async () => {
    const ada = await register("Ada");
    for (let i = 0; i < MAX_OUTGOING; i++) {
      await register(`Opp${i}`);
      expect((await challenge(ada.code, `Opp${i}`)).status).toBe(201);
    }
    await register("OneMore");
    expect((await challenge(ada.code, "OneMore")).body.error).toBe("too_many");
  });

  test("fails cleanly if no room can be opened", async () => {
    const ada = await register("Ada");
    await register("Bea");
    roomOk = false;
    expect((await challenge(ada.code, "Bea")).status).toBe(503);
    expect((await lists(ada.code)).body.outgoing).toEqual([]);
  });
});

describe("answering", () => {
  test("accepting gives the room, and the challenger sees it was accepted", async () => {
    const ada = await register("Ada");
    const bea = await register("Bea");
    const { body } = await challenge(ada.code, "Bea");
    const r = await call(`/api/challenges/${body.id}/accept`, bea.code, "POST");
    expect(r.body).toEqual({ room: body.room });
    expect((await lists(ada.code)).body.outgoing[0].status).toBe("accepted");
  });

  test("only the challenged player can accept or decline", async () => {
    const ada = await register("Ada");
    await register("Bea");
    const cyd = await register("Cyd");
    const { body } = await challenge(ada.code, "Bea");
    expect((await call(`/api/challenges/${body.id}/accept`, ada.code, "POST")).status).toBe(404);
    expect((await call(`/api/challenges/${body.id}/decline`, cyd.code, "POST")).status).toBe(404);
  });

  test("no thanks removes it for both, and the challenger can't ask again for a day", async () => {
    const ada = await register("Ada");
    const bea = await register("Bea");
    const { body } = await challenge(ada.code, "Bea");
    await call(`/api/challenges/${body.id}/decline`, bea.code, "POST");
    expect((await lists(ada.code)).body.outgoing).toEqual([]);
    expect((await lists(bea.code)).body.incoming).toEqual([]);
    expect((await challenge(ada.code, "Bea")).body.error).toBe("declined_recently");
    now += DECLINED_COOLDOWN_MS + 1;
    expect((await challenge(ada.code, "Bea")).status).toBe(201);
  });

  test("the challenger can cancel; a stranger can't", async () => {
    const ada = await register("Ada");
    const bea = await register("Bea");
    const { body } = await challenge(ada.code, "Bea");
    expect((await call(`/api/challenges/${body.id}`, bea.code, "DELETE")).status).toBe(404);
    await call(`/api/challenges/${body.id}`, ada.code, "DELETE");
    expect((await lists(bea.code)).body.incoming).toEqual([]);
  });

  test("challenges run out, and can't be accepted after", async () => {
    const ada = await register("Ada");
    const bea = await register("Bea");
    const { body } = await challenge(ada.code, "Bea");
    now += CHALLENGE_MS;
    expect((await lists(bea.code)).body.incoming).toEqual([]);
    expect((await call(`/api/challenges/${body.id}/accept`, bea.code, "POST")).status).toBe(410);
  });

  test("once the game starts, it leaves both lists", async () => {
    const ada = await register("Ada");
    const bea = await register("Bea");
    const { body } = await challenge(ada.code, "Bea");
    await challengeStarted(db, body.room);
    expect((await lists(ada.code)).body.outgoing).toEqual([]);
    expect((await lists(bea.code)).body.incoming).toEqual([]);
  });
});

describe("recent opponents", () => {
  async function played(p0: string, p1: string, winner: string | null, at: number) {
    await db
      .prepare("INSERT INTO matches (id, p0, p1, score0, score1, winner, reason, created_at) VALUES (?1, ?2, ?3, 5, 3, ?4, 'normal', ?5)")
      .bind(crypto.randomUUID(), p0, p1, winner, at)
      .run();
  }

  test("lists the people you played, latest first, with your record against each", async () => {
    const ada = await register("Ada");
    const bea = await register("Bea");
    const cyd = await register("Cyd");
    await played(ada.id, bea.id, ada.id, T0 - 3000);
    await played(bea.id, ada.id, bea.id, T0 - 2000);
    await played(ada.id, bea.id, null, T0 - 1500);
    await played(cyd.id, ada.id, ada.id, T0 - 1000);
    const r = await call("/api/me/opponents", ada.code);
    expect(r.body.opponents).toEqual([
      { nickname: "Cyd", rating: 1000, lastPlayed: T0 - 1000, record: { wins: 1, losses: 0, draws: 0 } },
      { nickname: "Bea", rating: 1000, lastPlayed: T0 - 1500, record: { wins: 1, losses: 1, draws: 1 } },
    ]);
  });

  test("leaves out games from long ago and players who deleted themselves", async () => {
    const ada = await register("Ada");
    const bea = await register("Bea");
    await played(ada.id, bea.id, ada.id, T0 - 40 * 24 * 3600_000);
    await played(ada.id, "deleted", ada.id, T0 - 1000);
    expect((await call("/api/me/opponents", ada.code)).body.opponents).toEqual([]);
  });
});

describe("cleaning up", () => {
  test("deleting your player removes your challenges, both ways", async () => {
    const ada = await register("Ada");
    const bea = await register("Bea");
    await challenge(ada.code, "Bea");
    await challenge(bea.code, "Ada");
    const req = new Request("https://zeni.test/api/me", { method: "DELETE", headers: { Authorization: `Bearer ${ada.code}` } });
    await handleAccounts(req, new URL(req.url), db);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM challenges").first()).toEqual({ n: 0 });
  });

  test("the daily cleanup removes challenges a couple of days after they end, not before", async () => {
    const ada = await register("Ada");
    await register("Bea");
    await challenge(ada.code, "Bea");
    await maintenance(db, T0 + CHALLENGE_MS + 24 * 3600_000);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM challenges").first()).toEqual({ n: 1 }); // still blocks repeat challenges
    await maintenance(db, T0 + CHALLENGE_MS + 3 * 24 * 3600_000);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM challenges").first()).toEqual({ n: 0 });
  });
});
