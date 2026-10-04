// Play against a bot from the browser, to try the online screens by hand.
//
//   npm run bot-room -- --join K7QXM        join a room you made in the browser
//   npm run bot-room -- --create            make a room, print its code, wait for you to join
//   npm run bot-room -- --queue easy        join the Quick Match queue, then play whoever it finds
//   npm run bot-room -- --create --table hard --think 2500
//   npm run bot-room -- --create --away 20000   open a room, leave for 20 seconds (as if sending the link), come back
//
// Registers a throwaway player each run, so use it against a local database.

import { parseArgs } from "node:util";
import { newRoomCode } from "../shared/room-code";
import { Bot, QueueSocket, register, server, sleep } from "./online-bot";

const { values: args } = parseArgs({
  options: {
    base: { type: "string", default: "http://localhost:5173" },
    join: { type: "string" },
    create: { type: "boolean", default: false },
    queue: { type: "string" },
    rating: { type: "string" },
    table: { type: "string", default: "easy" },
    think: { type: "string", default: "1800" },
    name: { type: "string" },
    rematch: { type: "boolean", default: true },
    away: { type: "string" },
  },
});

if (!args.join && !args.create && !args.queue) {
  console.error("Say --join CODE, --create or --queue easy|hard");
  process.exit(1);
}

const srv = server(args.base!);
const nickname = args.name ?? `bot_${Math.random().toString(36).slice(2, 7)}`;
const account = await register(srv, nickname);
const bot = new Bot(srv, nickname, account.code, Date.now() & 0xffff);
bot.thinkMs = Number(args.think);
bot.showAim = true;

let room: string;
if (args.queue) {
  const q = new QueueSocket(srv, nickname, account.code);
  await q.join(args.queue === "hard" ? "hard" : "easy");
  console.log(`${nickname} is in the ${args.queue} queue, waiting for an opponent…`);
  room = (await q.waitFor("matched", 10 * 60_000)).room;
  console.log(`Matched! Room ${room}`);
  await bot.connect(room);
} else {
  room = (args.join ?? newRoomCode()).toUpperCase();
  await bot.connect(room, args.create ? (args.table as "easy" | "hard") : undefined);
  console.log(args.create ? `Room ${room}  (open ${args.base}/r/${room})` : `Joined ${room} as ${nickname}`);
}

if (args.away && args.create) {
  await sleep(500);
  bot.ws.close(1000);
  console.log(`Stepped away for ${Number(args.away) / 1000}s…`);
  await sleep(Number(args.away));
  await bot.connect(room);
  console.log("Back.");
}

let wasOver = false;
for (;;) {
  await sleep(500);
  if (bot.closed) {
    console.log(`Disconnected (${bot.closed.code}).`);
    process.exit(0);
  }
  if (bot.over && !wasOver) {
    wasOver = true;
    console.log(`Game over: ${bot.over.reason}, winner ${bot.over.winner}, score ${bot.over.scores.join("–")}`);
    if (args.rematch) bot.send({ t: "rematch" });
  }
  if (!bot.over) wasOver = false;
}
