// How long the computer takes to choose a shot, per level and table, in Node on this machine.
//   npx tsx tools/think-time.ts
import { AI_LEVELS, chooseShot } from "../shared/ai";
import { mulberry32 } from "../shared/rng";
import { newGame } from "../shared/rules";

for (const difficulty of ["easy", "hard"] as const) {
  for (const level of AI_LEVELS) {
    const times: number[] = [];
    for (let seed = 1; seed <= 30; seed++) {
      const state = newGame(seed, difficulty);
      const t = performance.now();
      chooseShot(state, level, mulberry32(seed));
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    console.log(`${difficulty} ${level}: median ${times[15].toFixed(0)} ms, max ${times[29].toFixed(0)} ms`);
  }
}
