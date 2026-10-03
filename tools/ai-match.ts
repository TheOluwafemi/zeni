// Pit AI levels against each other and against the casual tuning bot (a stand-in for a
// new human player), and measure how long each level takes to think.
//
//   npm run ai-match
//   npm run ai-match -- --games 100 --difficulty hard

import { parseArgs } from "node:util";
import { AI_LEVELS, chooseShot, type AiLevel } from "../shared/ai";
import { DEFAULT_PHYSICS, type Difficulty } from "../shared/constants";
import { simulateShot } from "../shared/physics";
import { mulberry32 } from "../shared/rng";
import { newGame, resolveShot } from "../shared/rules";
import type { GameState, Seat, Shot } from "../shared/types";
import { botShot } from "./bot";

const { values: args } = parseArgs({
  options: {
    games: { type: "string", default: "60" },
    difficulty: { type: "string", default: "easy" },
  },
});
const games = Number(args.games);
const difficulty = args.difficulty as Difficulty;

type Player = AiLevel | "casual human";
const thinkMs: Record<AiLevel, number[]> = { beginner: [], skilled: [], master: [] };
/** Coins kept in each turn, per level: how long its runs are. */
const runs: Record<AiLevel, number[]> = { beginner: [], skilled: [], master: [] };

function shotFor(p: Player, state: GameState, rng: () => number): Shot {
  if (p === "casual human") return botShot(state, rng, 0.08, DEFAULT_PHYSICS);
  const t0 = performance.now();
  const shot = chooseShot(state, p, rng);
  thinkMs[p].push(performance.now() - t0);
  return shot;
}

/** Win rate of `a` against `b`, alternating who goes first. Draws count half. */
function match(a: Player, b: Player): number {
  let points = 0;
  for (let g = 0; g < games; g++) {
    const rng = mulberry32(g * 7919 + 13);
    let state = newGame(g + 1, difficulty);
    // Seat 0 is `a` on even games, `b` on odd games, so neither always goes first.
    const players: Record<Seat, Player> = g % 2 === 0 ? { 0: a, 1: b } : { 0: b, 1: a };
    const aSeat: Seat = g % 2 === 0 ? 0 : 1;
    let run = 0;
    while (state.status === "playing") {
      const p = players[state.turn];
      const shot = shotFor(p, state, rng);
      const { state: next, outcome } = resolveShot(state, shot, simulateShot(state, shot));
      if (outcome.captured !== null) run++;
      if (!outcome.again || next.status === "over") {
        if (p !== "casual human") runs[p].push(run);
        run = 0;
      }
      state = next;
    }
    points += state.winner === "draw" ? 0.5 : state.winner === aSeat ? 1 : 0;
  }
  return points / games;
}

const players: Player[] = ["casual human", ...AI_LEVELS];
console.log(`\n${games} games per pairing on ${difficulty} · rows' win rate against columns\n`);
const table: Record<string, Record<string, string>> = {};
for (const a of players) {
  table[a] = {};
  for (const b of players) table[a][b] = a === b ? "–" : "";
}
for (let i = 0; i < players.length; i++) {
  for (let j = i + 1; j < players.length; j++) {
    const w = match(players[i], players[j]);
    table[players[i]][players[j]] = `${Math.round(w * 100)}%`;
    table[players[j]][players[i]] = `${Math.round((1 - w) * 100)}%`;
  }
}
console.table(table);

const think: Record<string, Record<string, string>> = {};
for (const level of AI_LEVELS) {
  const xs = [...thinkMs[level]].sort((p, q) => p - q);
  const r = runs[level];
  think[level] = {
    "coins kept per turn": (r.reduce((a, b) => a + b, 0) / r.length).toFixed(2),
    "turns keeping 3+": `${Math.round((r.filter((n) => n >= 3).length / r.length) * 100)}%`,
    "longest run": String(Math.max(...r)),
    "median ms": xs[Math.floor(xs.length / 2)].toFixed(0),
    "p95 ms": xs[Math.floor(xs.length * 0.95)].toFixed(0),
    "max ms": xs[xs.length - 1].toFixed(0),
  };
}
console.log("\nRuns and thinking time per level (Node, this machine):");
console.table(think);
