// Headless tuning tool: plays many bot-vs-bot games and reports how long games
// last and how often shots capture.
//
//   npm run simulate
//   npm run simulate -- --games 2000 --physics '{"friction":1000}'
//   npm run simulate -- --difficulty hard --noise 0.06 --aim-seconds 4

import { parseArgs } from "node:util";
import { CUPS, DEFAULT_PHYSICS, DT, MAX_SHOTS, type Difficulty, type PhysicsConfig } from "../shared/constants";
import { simulateShot } from "../shared/physics";
import { mulberry32 } from "../shared/rng";
import { newGame, resolveShot } from "../shared/rules";
import { botShot } from "./bot";

const { values: args } = parseArgs({
  options: {
    games: { type: "string", default: "1000" },
    seed: { type: "string", default: "1" },
    physics: { type: "string" },
    noise: { type: "string" },
    difficulty: { type: "string" },
    "aim-seconds": { type: "string", default: "5" },
  },
});

const games = Number(args.games);
const baseSeed = Number(args.seed);
const aimSeconds = Number(args["aim-seconds"]);
const physics: PhysicsConfig = { ...DEFAULT_PHYSICS, ...(args.physics ? JSON.parse(args.physics) : {}) };
const difficulties = (args.difficulty ? [args.difficulty] : Object.keys(CUPS)) as Difficulty[];

const skills = args.noise
  ? [{ name: "custom", noise: Number(args.noise) }]
  : [
      { name: "sharp", noise: 0.015 },
      { name: "good", noise: 0.04 },
      { name: "casual", noise: 0.08 },
    ];

interface Totals {
  shots: number;
  captures: number;
  missNothing: number;
  missMany: number;
  fallShots: number;
  fallenCoins: number;
  steps: number;
  maxSteps: number;
  ended: Record<"cleared" | "stuck" | "shotCap", number>;
  draws: number;
  firstPlayerWins: number;
  minutes: number[];
}

function run(difficulty: Difficulty, noise: number): Totals {
  const t: Totals = {
    shots: 0,
    captures: 0,
    missNothing: 0,
    missMany: 0,
    fallShots: 0,
    fallenCoins: 0,
    steps: 0,
    maxSteps: 0,
    ended: { cleared: 0, stuck: 0, shotCap: 0 },
    draws: 0,
    firstPlayerWins: 0,
    minutes: [],
  };

  for (let g = 0; g < games; g++) {
    const seed = (baseSeed * 100_003 + g) >>> 0;
    const rng = mulberry32(seed ^ 0x5bd1e995);
    let state = newGame(seed, difficulty);
    const first = state.turn;
    let seconds = 0;

    while (state.status === "playing") {
      const shot = botShot(state, rng, noise, physics);
      const result = simulateShot(state, shot, physics);
      const { state: next, outcome } = resolveShot(state, shot, result);
      state = next;

      t.shots++;
      t.steps += result.steps;
      t.maxSteps = Math.max(t.maxSteps, result.steps);
      seconds += aimSeconds + result.steps * DT;
      if (outcome.captured !== null) t.captures++;
      else if (outcome.touched === 0) t.missNothing++;
      else if (outcome.touched > 1) t.missMany++;
      if (outcome.fallen.length > 0) t.fallShots++;
      t.fallenCoins += outcome.fallen.length;
    }

    if (state.coins.length <= 1) t.ended.cleared++;
    else if (state.shots >= MAX_SHOTS) t.ended.shotCap++;
    else t.ended.stuck++;
    if (state.winner === "draw") t.draws++;
    else if (state.winner === first) t.firstPlayerWins++;
    t.minutes.push(seconds / 60);
  }
  return t;
}

const pct = (n: number, d: number) => `${((n / d) * 100).toFixed(0)}%`;
const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);
const median = (xs: number[]) => sorted(xs)[Math.floor(xs.length / 2)];
const p90 = (xs: number[]) => sorted(xs)[Math.floor(xs.length * 0.9)];

console.log(`\n${games} games each · ${aimSeconds}s to aim each shot · physics ${JSON.stringify(physics)}\n`);

const rows: Record<string, Record<string, string>> = {};
for (const difficulty of difficulties) {
  for (const { name, noise } of skills) {
    const t = run(difficulty, noise);
    rows[`${difficulty} (${CUPS[difficulty]} cups) · ${name} ±${noise}`] = {
      "keeps a coin": pct(t.captures, t.shots),
      "touched none": pct(t.missNothing, t.shots),
      "touched 2+": pct(t.missMany, t.shots),
      "shots with a fall": pct(t.fallShots, t.shots),
      "coins fallen/game": (t.fallenCoins / games).toFixed(1),
      "shots/game": (t.shots / games).toFixed(1),
      "minutes (median / p90)": `${median(t.minutes).toFixed(1)} / ${p90(t.minutes).toFixed(1)}`,
      "ended: cleared/stuck/cap": `${pct(t.ended.cleared, games)} / ${pct(t.ended.stuck, games)} / ${pct(t.ended.shotCap, games)}`,
      draws: pct(t.draws, games),
      "first player wins": pct(t.firstPlayerWins, games - t.draws),
    };
  }
}
console.table(rows);
console.log("\nTargets (from the plan): games last 2–4 min, about 30–50% of shots keep a coin, first player near 50%.\n");
