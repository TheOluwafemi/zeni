// The launch dashboard, in your terminal: daily players, games started and finished, how long they
// last, how they end, the most frequent errors, and what people wrote in the feedback form.
//
//   npm run report                 your real (remote) database
//   npm run report -- --local      the local development database
//   npm run report -- --days 30
//
// It reads through `wrangler`, so it uses the Cloudflare login you already have. Nothing to host or secure.

import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import type { Db } from "../server/accounts";
import { report } from "../server/analytics";

const { values: args } = parseArgs({
  options: { local: { type: "boolean", default: false }, days: { type: "string", default: "14" } },
});

/** Wrangler can't bind parameters, so fill the ?N placeholders with safely quoted literals. */
function inline(sql: string, values: unknown[]): string {
  return sql.replace(/\?(\d+)/g, (_, n: string) => {
    const v = values[Number(n) - 1];
    if (v === null || v === undefined) return "NULL";
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
    return `'${String(v).replace(/'/g, "''")}'`;
  });
}

function query<T>(sql: string, values: unknown[]): T[] {
  const run = spawnSync("npx", ["wrangler", "d1", "execute", "zeni", args.local ? "--local" : "--remote", "--json", "--command", inline(sql, values)], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (run.status !== 0) {
    console.error(run.stderr || run.stdout);
    process.exit(1);
  }
  return (JSON.parse(run.stdout) as { results: T[] }[])[0].results;
}

const readOnlyDb: Db = {
  prepare(sql: string) {
    const make = (values: unknown[]) => ({
      bind: (...v: unknown[]) => make(v),
      all: async <T>() => ({ results: query<T>(sql, values) }),
      first: async <T>() => query<T>(sql, values)[0] ?? null,
      run: async () => {
        throw new Error("The report only reads.");
      },
    });
    return make([]);
  },
  batch: async () => {
    throw new Error("The report only reads.");
  },
};

const when = (ms: number) => new Date(ms).toISOString().replace("T", " ").slice(0, 16);

const r = await report(readOnlyDb, { days: Number(args.days) });

console.log(`\nZeni report · ${args.local ? "local" : "live"} database · last ${args.days} days (UTC)\n`);
console.log(
  `${r.totals.players} players, ${r.totals.playersWhoPlayedOnline} have played online · ${r.totals.onlineGames} online games · ${r.totals.feedback} feedback messages\n`,
);

console.log("DAILY");
const busy = r.days.filter((d) => d.opens + d.activePlayers + d.newPlayers + d.computerGames + d.dailyPuzzles + d.startedQuick + d.startedFriend + d.finished > 0);
if (busy.length === 0) console.log("  no activity yet\n");
else {
  console.table(
    Object.fromEntries(
      busy.map((d) => [
        d.day,
        {
          opens: d.opens,
          "players seen": d.activePlayers,
          "new players": d.newPlayers,
          "vs computer": d.computerGames,
          daily: d.dailyPuzzles,
          "online started": d.startedQuick + d.startedFriend,
          "(quick / friend)": `${d.startedQuick} / ${d.startedFriend}`,
          finished: d.finished,
          "never finished": Math.max(0, d.startedQuick + d.startedFriend - d.finished),
          "avg minutes": d.avgMinutes ?? "–",
        },
      ]),
    ),
  );
}

if (r.endings.length) {
  const total = r.endings.reduce((n, e) => n + e.count, 0);
  console.log("HOW ONLINE GAMES END");
  for (const e of r.endings) console.log(`  ${String(e.count).padStart(4)}  ${e.reason}  (${Math.round((e.count / total) * 100)}%)`);
  console.log("");
}

console.log("ERRORS");
if (r.errors.length === 0) console.log("  none logged\n");
for (const e of r.errors) {
  console.log(`  ×${e.count}  ${e.message}`);
  console.log(`        ${e.source}${e.screen ? ` · ${e.screen}` : ""}${e.version ? ` · build ${e.version}` : ""} · last ${when(e.lastAt)}`);
}
if (r.errors.length) console.log("");

console.log("FEEDBACK");
if (r.feedback.length === 0) console.log("  none yet\n");
for (const f of r.feedback) {
  const who = f.nickname ?? "anonymous";
  console.log(`  ${when(f.at)}  ${who}${f.screen ? ` (${f.screen}` : " ("}${f.version ? `${f.screen ? ", " : ""}build ${f.version}` : ""})`.replace(" ()", ""));
  console.log(`    ${f.message.replace(/\n/g, "\n    ")}`);
  if (f.contact) console.log(`    reply to: ${f.contact}`);
  console.log("");
}
