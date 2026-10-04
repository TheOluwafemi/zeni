// End-to-end check of friend rooms: two bot players play over real WebSockets.
//
//   npm run dev                      (in another terminal)
//   npm run play-online
//   npm run play-online -- --base https://zeni.example.workers.dev
//
// It registers two throwaway players, so run it against a local database, not production.

import { parseArgs } from "node:util";
import { freeCoinIds } from "../shared/rules";
import { newRoomCode } from "../shared/room-code";
import { Bot, me, register, server, sleep } from "./online-bot";

const { values: args } = parseArgs({
  options: {
    base: { type: "string", default: "http://localhost:5173" },
    // Also wait out the 30 second grace period in the "creator is away" check (adds about 35 seconds).
    slow: { type: "boolean", default: false },
  },
});
const BASE = args.base!;
const srv = server(BASE);

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) failures++;
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${!ok && detail ? `  → ${detail}` : ""}`);
}

async function main(): Promise<void> {
  const tag = Math.random().toString(36).slice(2, 7);
  console.log(`\nPlaying against ${BASE}\n`);

  const [adaAcct, beaAcct] = await Promise.all([register(srv, `ada_${tag}`), register(srv, `bea_${tag}`)]);
  const ada = new Bot(srv, "Ada", adaAcct.code, 1);
  const bea = new Bot(srv, "Bea", beaAcct.code, 2);
  const room = newRoomCode();

  console.log("A creator who leaves to send the link, before the friend arrives");
  {
    const away = new Bot(srv, "Away", adaAcct.code, 11);
    const friend = new Bot(srv, "Friend", beaAcct.code, 12);
    away.autoplay = friend.autoplay = false;
    const awayRoom = newRoomCode();
    await away.connect(awayRoom, "easy");
    await away.waitFor("welcome");
    away.ws.close(1000); // the phone suspends the page while they're in their messaging app
    await sleep(400);

    await friend.connect(awayRoom);
    const fw = await friend.waitFor("welcome");
    check("the friend can join while the creator is away", fw.room.status === "waiting" && fw.you === 1);
    check("and sees that the creator isn't connected", fw.players[0]?.connected === false && fw.players[1]?.connected === true);
    await sleep(args.slow ? 35_000 : 1500);
    check(args.slow ? "no game starts, and nobody is forfeited, even after the 30 second grace period" : "no game starts while one of them is away", !friend.inbox.some((m) => m.t === "start" || m.t === "over"));

    const mark = friend.inbox.length;
    await away.connect(awayRoom); // back from the messaging app
    const [back, started] = await Promise.all([away.waitFor("welcome", 8000, 0), friend.waitFor("start", 8000, mark)]);
    check("the creator returns to their own seat", back.you === 0);
    check("and the game starts the moment they're back", started.state.shots === 0 && started.players[0]?.connected === true);
    away.ws.close(1000);
    friend.ws.close(1000);
    console.log("");
  }

  console.log("Setting up a room");
  await ada.connect(room, "easy");
  const adaWelcome = await ada.waitFor("welcome");
  check("creator is seated and waiting", adaWelcome.room.status === "waiting" && adaWelcome.you === 0 && adaWelcome.state === null);

  const intruder = new Bot(srv, "Intruder", "ZENI-AAAA-BBBB-CCCC-DDDD", 3);
  await intruder.connect(room);
  await intruder.waitFor("error");
  await sleep(100);
  check("a bad player code is refused and disconnected", intruder.closed?.code === 4401, JSON.stringify(intruder.closed));

  const lost = new Bot(srv, "Lost", beaAcct.code, 4);
  await lost.connect(newRoomCode());
  await lost.waitFor("error");
  await sleep(100);
  check("joining a room that doesn't exist is refused", lost.closed?.code === 4404, JSON.stringify(lost.closed));

  const dup = new Bot(srv, "Dup", beaAcct.code, 5);
  await dup.connect(room, "hard");
  await dup.waitFor("error");
  await sleep(100);
  check("creating a room whose code is taken is refused", dup.closed?.code === 4409, JSON.stringify(dup.closed));

  bea.autoplay = false;
  ada.autoplay = false;
  await bea.connect(room);
  await bea.waitFor("welcome");
  const started = await Promise.all([ada.waitFor("start"), bea.waitFor("start")]);
  check("the second player joining starts the game for both", started[0].state.turn === started[1].state.turn);
  check("seats are 0 and 1", ada.seat === 0 && bea.seat === 1);

  const third = new Bot(srv, "Third", (await register(srv, `cyd_${tag}`)).code, 6);
  await third.connect(room);
  await third.waitFor("error");
  await sleep(100);
  check("a third player is turned away", third.closed?.code === 4403, JSON.stringify(third.closed));

  console.log("\nRules enforced by the server");
  const first = started[0].state.turn === 0 ? ada : bea;
  const second = first === ada ? bea : ada;
  const before = second.inbox.length;
  second.send({ t: "shot", seq: 0, coinId: 0, angle: 0, power: 0.5 });
  const err = await second.waitFor("error", 3000, before);
  check("shooting out of turn is rejected", err.error === "not_your_turn", err.error);
  const resync = await second.waitFor("welcome", 3000, before);
  check("and the phone is resynced with the real state", resync.state?.shots === 0);

  console.log("\nWatching the other player aim");
  const coin = started[0].state.shooter ?? [...freeCoinIds(started[0].state.coins)][0];
  const seen = second.inbox.length;
  const mine = first.inbox.length;
  first.send({ t: "aim", seq: 0, coinId: coin, angle: 0.5, power: 0.4 });
  const relayed = await second.waitFor("aim", 3000, seen);
  check("the shooter's aim reaches the other player", relayed.by === first.seat && relayed.coinId === coin && relayed.power === 0.4, JSON.stringify(relayed));
  first.send({ t: "aim_end", seq: 0 });
  await second.waitFor("aim_end", 3000, seen);
  second.send({ t: "aim", seq: 0, coinId: coin, angle: 0, power: 0.5 });
  await sleep(300);
  check("aiming out of turn is ignored, with no error", !first.inbox.slice(mine).some((m) => m.t === "aim") && !second.inbox.slice(seen).some((m) => m.t === "error"));
  check("and you don't get your own aim back", !first.inbox.slice(mine).some((m) => m.t === "aim" || m.t === "aim_end"));

  console.log("\nReactions");
  const beforeReact = [first.inbox.length, second.inbox.length];
  second.send({ t: "react", r: "nice" });
  const got = await first.waitFor("react", 3000, beforeReact[0]);
  check("a reaction reaches the other player", got.by === second.seat && got.r === "nice", JSON.stringify(got));
  second.send({ t: "react", r: "clap" }); // straight after the first: too soon
  await sleep(300);
  check("sending them too quickly is ignored", first.inbox.slice(beforeReact[0]).filter((m) => m.t === "react").length === 1);
  check("and you don't get your own back", !second.inbox.slice(beforeReact[1]).some((m) => m.t === "react"));

  console.log("\nA game, with a dropped connection in the middle");
  ada.autoplay = bea.autoplay = true;
  void ada.maybePlay();
  void bea.maybePlay();
  await first.waitUntil(() => (ada.state?.shots ?? 0) >= 3, 20_000, "three shots");

  const adaShotsBefore = ada.state!.shots;
  ada.ws.close(1000);
  await bea.waitUntil(() => bea.inbox.some((m) => m.t === "players" && m.players[0]?.connected === false), 5000, "Ada to show as disconnected");
  check("the opponent is told a player dropped", true);

  await sleep(300);
  const adaMark = ada.inbox.length; // only look at messages from the new connection
  await ada.connect(room);
  const back = await ada.waitFor("welcome", 8000, adaMark);
  check("reconnecting returns the same seat", back.you === 0);
  check("and the current game, not a new one", (back.state?.shots ?? -1) >= adaShotsBefore && back.room.status !== "waiting");
  await bea.waitUntil(() => {
    const last = [...bea.inbox].reverse().find((m) => m.t === "players");
    return last?.t === "players" && last.players[0]?.connected === true;
  }, 5000, "Ada to show as back");
  check("the opponent sees them come back", true);

  await Promise.all([ada.waitUntil(() => ada.over !== null, 90_000, "game over"), bea.waitUntil(() => bea.over !== null, 90_000, "game over")]);
  const over = ada.over!;
  check("the game ends with a result", over.winner === 0 || over.winner === 1 || over.winner === "draw", JSON.stringify(over));
  check("both players got the same result", JSON.stringify(ada.over) === JSON.stringify(bea.over));
  check("the final scores match the board", over.scores[0] === ada.state!.scores[0] && over.scores[1] === ada.state!.scores[1]);
  check("the result includes rating changes", over.ratings !== null);
  console.log(`    ${over.reason}, score ${over.scores.join("–")}, winner ${over.winner}, ratings ${over.ratings?.before.join("/")} → ${over.ratings?.after.join("/")}, ${ada.shots + bea.shots} shots`);

  const [adaMe, beaMe] = await Promise.all([me(srv, adaAcct.code), me(srv, beaAcct.code)]);
  check("each player has one game on record", adaMe.games === 1 && beaMe.games === 1);
  check("ratings add up: nothing was created or lost", adaMe.rating + beaMe.rating === 2000, `${adaMe.rating} + ${beaMe.rating}`);
  check("and match what was announced", adaMe.rating === over.ratings?.after[0] && beaMe.rating === over.ratings?.after[1]);

  console.log("\nRematch and resign");
  ada.autoplay = bea.autoplay = false;
  const firstGameFirst = started[0].state.turn;
  ada.send({ t: "rematch" });
  const vote = await bea.waitFor("rematch");
  check("one vote isn't enough", vote.votes[0] && !vote.votes[1]);
  const marks = { ada: ada.inbox.length, bea: bea.inbox.length };
  bea.send({ t: "rematch" });
  const again = await ada.waitFor("start", 5000, marks.ada);
  check("both agreeing starts a new game", again.state.shots === 0 && again.state.scores[0] === 0);
  check("the other player goes first this time", again.state.turn === 1 - firstGameFirst, `first ${firstGameFirst}, now ${again.state.turn}`);

  const resigner = bea;
  resigner.send({ t: "resign" });
  await Promise.all([ada.waitFor("over", 5000, marks.ada), bea.waitFor("over", 5000, marks.bea)]);
  const lastOver = [...ada.inbox].reverse().find((m) => m.t === "over");
  check("resigning loses the game for the resigner", lastOver?.t === "over" && lastOver.over.winner === 0 && lastOver.over.reason === "resign");

  const [adaFinal, beaFinal] = await Promise.all([me(srv, adaAcct.code), me(srv, beaAcct.code)]);
  check("two games are on record", adaFinal.games === 2 && beaFinal.games === 2);
  check("ratings still add up", adaFinal.rating + beaFinal.rating === 2000, `${adaFinal.rating} + ${beaFinal.rating}`);

  console.log("\nBest of 3");
  const bo3Room = newRoomCode();
  const fay = new Bot(srv, "Fay", (await register(srv, `fay_${tag}`)).code, 21);
  const gus = new Bot(srv, "Gus", (await register(srv, `gus_${tag}`)).code, 22);
  fay.autoplay = gus.autoplay = false;
  await fay.connect(bo3Room, "easy", 3);
  const fw = await fay.waitFor("welcome");
  check("a room can be made best of 3", fw.room.match.bestOf === 3 && fw.room.match.round === 1, JSON.stringify(fw.room.match));
  await gus.connect(bo3Room);
  const [fs] = await Promise.all([fay.waitFor("start"), gus.waitFor("start")]);
  check("both players are told it's round 1 of a best of 3", fs.match.bestOf === 3 && fs.match.round === 1);
  gus.send({ t: "resign" });
  const fo = await fay.waitFor("over");
  check("resigning loses the whole match", fo.over.winner === fay.seat && fo.over.wins?.[fay.seat] === 2, JSON.stringify(fo.over));

  for (const b of [ada, bea, fay, gus]) b.ws.close(1000);
  console.log(failures === 0 ? "\nAll good.\n" : `\n${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`\n✗ ${e instanceof Error ? e.message : e}\n`);
  process.exit(1);
});
