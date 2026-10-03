// End-to-end check of Quick Match, the room it opens, and the leaderboard.
//
//   npm run dev                      (in another terminal)
//   npm run play-quick
//
// It registers throwaway players, so run it against a local database, not production.

import { parseArgs } from "node:util";
import { Bot, QueueSocket, register, server, sleep } from "./online-bot";

const { values: args } = parseArgs({ options: { base: { type: "string", default: "http://localhost:5173" } } });
const srv = server(args.base!);

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) failures++;
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${!ok && detail ? `  → ${detail}` : ""}`);
}

async function main(): Promise<void> {
  const tag = Math.random().toString(36).slice(2, 7);
  const names = ["ada", "bea", "cyd", "dov", "eli"];
  const accounts = Object.fromEntries(await Promise.all(names.map(async (n) => [n, await register(srv, `${n}_${tag}`)])));
  console.log(`\nQuick Match against ${srv.base}\n`);

  console.log("The queue");
  const bad = new QueueSocket(srv, "Bad", "ZENI-AAAA-BBBB-CCCC-DDDD");
  await bad.join("easy");
  await bad.waitFor("error");
  await sleep(100);
  check("a bad player code is refused", bad.closed?.code === 4401, JSON.stringify(bad.closed));

  const ada = new QueueSocket(srv, "Ada", accounts.ada.code);
  await ada.join("easy");
  const queued = await ada.waitFor("queued");
  check("a player in the queue is told they're waiting", queued.waiting === 1);
  await sleep(2500);
  check("a lone player is not matched with anyone", !ada.matched && !ada.closed);

  const adaAgain = new QueueSocket(srv, "Ada (second tab)", accounts.ada.code);
  await adaAgain.join("easy");
  await adaAgain.waitFor("queued");
  await sleep(300);
  check("queueing again replaces the first place", ada.closed?.code === 4409, JSON.stringify(ada.closed));
  check("and doesn't match you with yourself", !adaAgain.matched);

  const hardCyd = new QueueSocket(srv, "Cyd (hard)", accounts.cyd.code);
  await hardCyd.join("hard");
  await hardCyd.waitFor("queued");
  await sleep(2500);
  check("players waiting for different tables aren't matched", !adaAgain.matched && !hardCyd.matched);
  hardCyd.cancel();
  await sleep(200);
  check("cancelling leaves the queue", hardCyd.closed !== null);

  console.log("\nA match");
  const bea = new QueueSocket(srv, "Bea", accounts.bea.code);
  await bea.join("easy");
  const [m1, m2] = await Promise.all([adaAgain.waitFor("matched", 10_000), bea.waitFor("matched", 10_000)]);
  check("two players on the same table are matched together", m1.room === m2.room && m1.table === "easy", `${m1.room} vs ${m2.room}`);
  check("the room code is a real room code", /^[0-9A-HJKMNP-TV-Z]{5}$/.test(m1.room));
  await sleep(200);
  check("and the queue connection is closed once they're matched", adaAgain.closed?.code === 1000 && bea.closed?.code === 1000);

  console.log("\nThe room they were given");
  const room = m1.room;
  const stranger = new Bot(srv, "Stranger", accounts.cyd.code, 1);
  await stranger.connect(room);
  await stranger.waitFor("error");
  await sleep(150);
  check("a stranger who gets the code can't take a seat", stranger.closed?.code === 4403, JSON.stringify(stranger.closed));

  const adaBot = new Bot(srv, "Ada", accounts.ada.code, 2);
  const beaBot = new Bot(srv, "Bea", accounts.bea.code, 3);
  adaBot.autoplay = beaBot.autoplay = false;
  await adaBot.connect(room);
  const w1 = await adaBot.waitFor("welcome");
  check("the first to arrive waits for the other", w1.room.status === "waiting");
  await beaBot.connect(room);
  const [s1, s2] = await Promise.all([adaBot.waitFor("start"), beaBot.waitFor("start")]);
  check("the game starts when both are in", s1.state.turn === s2.state.turn);
  check("with the table they queued for", s1.state.cups.length === 2, `cups: ${s1.state.cups.length}`);

  beaBot.send({ t: "resign" });
  await Promise.all([adaBot.waitFor("over"), beaBot.waitFor("over")]);
  const over = adaBot.over!;
  check("the game is ranked like any other online game", over.ratings !== null && over.winner !== "draw", JSON.stringify(over));
  console.log(`    ${over.reason}, ratings ${over.ratings?.before.join("/")} → ${over.ratings?.after.join("/")}`);

  console.log("\nThree players: two are matched, one keeps waiting");
  const q = [accounts.cyd, accounts.dov, accounts.eli].map((a, i) => new QueueSocket(srv, ["Cyd", "Dov", "Eli"][i], a.code));
  for (const s of q) await s.join("easy");
  await sleep(3000);
  const matchedCount = q.filter((s) => s.matched).length;
  check("exactly two of three are matched", matchedCount === 2, `matched ${matchedCount}`);
  const waiting = q.find((s) => !s.matched)!;
  check("the third is still waiting", waiting.closed === null);
  waiting.cancel();

  console.log("\nThe leaderboard");
  const board = (await (await fetch(`${srv.base}/api/leaderboard`)).json()) as { players: { rank: number; nickname: string; rating: number; games: number }[] };
  const mine = board.players.filter((p) => p.nickname.endsWith(`_${tag}`));
  check("it lists the two who just played", mine.length === 2, JSON.stringify(mine));
  check("with the winner above the loser", mine.length === 2 && mine[0].rating > mine[1].rating && mine[0].rank < mine[1].rank);
  check("and no one who hasn't played", !board.players.some((p) => p.nickname === `eli_${tag}` || p.nickname === `cyd_${tag}`));

  for (const s of [...q, adaAgain, bea]) try { s.ws.close(); } catch { /* already closed */ }
  for (const b of [adaBot, beaBot]) b.ws.close(1000);
  console.log(failures === 0 ? "\nAll good.\n" : `\n${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`\n✗ ${e instanceof Error ? e.message : e}\n`);
  process.exit(1);
});
