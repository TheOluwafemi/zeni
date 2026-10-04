// End-to-end check of challenges and recent opponents, against the real Worker, rooms and database.
//
//   npm run dev                      (in another terminal)
//   npm run play-challenge
//
// It registers throwaway players, so run it against a local database, not production.

import { parseArgs } from "node:util";
import { CUPS } from "../shared/constants";
import { Bot, playShots, register, server, sleep } from "./online-bot";

const { values: args } = parseArgs({ options: { base: { type: "string", default: "http://localhost:5173" } } });
const srv = server(args.base!);

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) failures++;
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${!ok && detail ? `  → ${detail}` : ""}`);
}

async function call(path: string, code: string, method = "GET", body?: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${srv.base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${code}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

async function main(): Promise<void> {
  const tag = Math.random().toString(36).slice(2, 7);
  const [ada, bea, cyd] = await Promise.all(["ada", "bea", "cyd"].map((n) => register(srv, `${n}_${tag}`)));
  console.log(`\nChallenges against ${srv.base}\n`);

  console.log("Sending one");
  const sent = await call("/api/challenges", ada.code, "POST", { to: `bea_${tag}`, table: "hard" });
  check("a challenge opens a room for the two of them", sent.status === 201 && /^[0-9A-HJKMNP-TV-Z]{5}$/.test(sent.body.room), JSON.stringify(sent));
  const beaLists = await call("/api/me/challenges", bea.code);
  check("the other player sees it on their home screen", beaLists.body.incoming[0]?.from?.nickname === `ada_${tag}`, JSON.stringify(beaLists.body));
  const room = sent.body.room as string;

  console.log("\nThe room");
  const stranger = new Bot(srv, "Cyd", cyd.code, 1);
  await stranger.connect(room);
  await stranger.waitFor("error");
  await sleep(150);
  check("nobody else can take a seat", stranger.closed?.code === 4403, JSON.stringify(stranger.closed));

  const adaBot = new Bot(srv, "Ada", ada.code, 2);
  const beaBot = new Bot(srv, "Bea", bea.code, 3);
  adaBot.autoplay = beaBot.autoplay = false;
  await adaBot.connect(room);
  const w = await adaBot.waitFor("welcome");
  check("the challenger can wait in the room", w.room.status === "waiting" && w.room.table === "hard");

  const accepted = await call(`/api/challenges/${sent.body.id}/accept`, bea.code, "POST");
  check("accepting gives the same room", accepted.body.room === room, JSON.stringify(accepted.body));
  check("and the challenger sees it was accepted", (await call("/api/me/challenges", ada.code)).body.outgoing[0]?.status === "accepted");

  await beaBot.connect(room);
  const [s] = await Promise.all([adaBot.waitFor("start"), beaBot.waitFor("start")]);
  check("the game starts once both are there, on the table chosen", s.state.cups.length === CUPS.hard, `cups: ${s.state.cups.length}`);
  await sleep(300);
  const after = [await call("/api/me/challenges", ada.code), await call("/api/me/challenges", bea.code)];
  check("once it starts, the challenge leaves both lists", after[0].body.outgoing.length === 0 && after[1].body.incoming.length === 0, JSON.stringify(after.map((a) => a.body)));

  await playShots(adaBot, beaBot, 2); // a real game: very short ones aren't rated
  beaBot.send({ t: "resign" });
  await Promise.all([adaBot.waitFor("over"), beaBot.waitFor("over")]);
  check("it's a ranked game like any other", adaBot.over?.ratings !== null);

  console.log("\nRecent opponents");
  await sleep(300);
  const recent = await call("/api/me/opponents", ada.code);
  check("each sees the other under Play again, with the record", recent.body.opponents[0]?.nickname === `bea_${tag}` && recent.body.opponents[0]?.record.wins === 1, JSON.stringify(recent.body));

  console.log("\nSaying no");
  const second = await call("/api/challenges", bea.code, "POST", { to: `ada_${tag}` });
  await call(`/api/challenges/${second.body.id}/decline`, ada.code, "POST");
  const again = await call("/api/challenges", bea.code, "POST", { to: `ada_${tag}` });
  check("after no thanks, the same player can't ask again straight away", again.body.error === "declined_recently", JSON.stringify(again.body));

  for (const b of [adaBot, beaBot]) b.ws.close(1000);
  console.log(failures === 0 ? "\nAll good.\n" : `\n${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`\n✗ ${e instanceof Error ? e.message : e}\n`);
  process.exit(1);
});
