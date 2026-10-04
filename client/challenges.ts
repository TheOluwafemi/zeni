// Challenges and recent opponents on Home: "Bea challenged you · Play", "Waiting for Bea", "Play Bea again".
// Refreshed while Home is on screen, so a challenge shows up the next time someone opens the app.

import type { Difficulty } from "../shared/constants";
import { currentPlayer, PLAYER_READY } from "./account";
import { inUse, onReturn } from "./activity";
import { api, ApiError } from "./api";
import { tierBadge } from "./tier";

interface Who {
  nickname: string;
  rating: number;
}
interface Challenge {
  id: string;
  room: string;
  table: Difficulty;
  status: "open" | "accepted";
  expiresIn: number;
  from?: Who;
  to?: Who;
}
interface Opponent extends Who {
  record: { wins: number; losses: number; draws: number };
}

/** Challenges are checked this often while Home is open and in use (recent opponents only when Home opens). */
const REFRESH_MS = 60_000;
const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const box = $("#challenges");
const recentBox = $("#recent");
const statusLine = $("#challenge-status");

let enter: (room: string, opponent: string) => void = () => {};
let homeVisible: () => boolean = () => true;
let tableNow: () => Difficulty = () => "easy";
let bestOfNow: () => 1 | 3 = () => 1;

const tableName = (t: Difficulty) => (t === "easy" ? "Easy table" : "Hard table");
const minutes = (ms: number) => `${Math.max(1, Math.round(ms / 60_000))} min`;

function button(label: string, onClick: () => void, cls = ""): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  if (cls) b.className = cls;
  b.addEventListener("click", onClick);
  return b;
}

function row(who: Who, text: string, ...actions: HTMLButtonElement[]): HTMLElement {
  const li = document.createElement("li");
  li.className = "challenge-row";
  const info = document.createElement("div");
  info.className = "challenge-info";
  const name = document.createElement("strong");
  name.textContent = who.nickname;
  const line = document.createElement("span");
  line.className = "muted small";
  line.textContent = text;
  const top = document.createElement("div");
  top.append(tierBadge(who.rating), name);
  info.append(top, line);
  const acts = document.createElement("div");
  acts.className = "challenge-actions";
  acts.append(...actions);
  li.append(info, acts);
  return li;
}

/** A friendly sentence for a failed challenge. */
export function challengeError(e: unknown, nickname: string): string {
  const code = e instanceof ApiError ? e.code : "";
  if (code === "declined_recently") return `${nickname} said no thanks recently. Try again tomorrow.`;
  if (code === "too_many") return "You have 5 challenges waiting. Cancel one first.";
  if (code === "rate_limited") return "That's a lot of challenges. Try again in a while.";
  if (code === "unknown_player") return `${nickname} isn't playing any more.`;
  if (code === "offline") return "Can't reach the server. Check your connection.";
  return "Couldn't send the challenge. Try again.";
}

/** Challenge a player by nickname on a table, then go to the room. Returns an error sentence, or null. */
export async function challenge(nickname: string, table: Difficulty): Promise<string | null> {
  try {
    const c = await api<Challenge>("/api/challenges", { method: "POST", body: { to: nickname, table, bestOf: bestOfNow() }, auth: true });
    enter(c.room, c.to?.nickname ?? nickname);
    return null;
  } catch (e) {
    return challengeError(e, nickname);
  }
}

async function act(path: string, method: string): Promise<void> {
  try {
    await api(path, { method, auth: true });
  } catch {
    // Already gone (expired, or answered on another device): the refresh shows the truth.
  }
  void refresh();
}

function render(incoming: Challenge[], outgoing: Challenge[], opponents: Opponent[]): void {
  const items: HTMLElement[] = [];
  for (const c of incoming) {
    const who = c.from!;
    items.push(
      c.status === "accepted"
        ? row(who, `You accepted · ${tableName(c.table)}`, button("Play", () => enter(c.room, who.nickname), "primary"))
        : row(
            who,
            `challenged you · ${tableName(c.table)}`,
            button("No thanks", () => void act(`/api/challenges/${c.id}/decline`, "POST"), "link"),
            button(
              "Play",
              async () => {
                try {
                  const { room } = await api<{ room: string }>(`/api/challenges/${c.id}/accept`, { method: "POST", auth: true });
                  enter(room, who.nickname);
                } catch {
                  statusLine.textContent = "That challenge has run out.";
                  void refresh();
                }
              },
              "primary",
            ),
          ),
    );
  }
  for (const c of outgoing) {
    const who = c.to!;
    items.push(
      c.status === "accepted"
        ? row(who, `accepted your challenge!`, button("Play now", () => enter(c.room, who.nickname), "primary"))
        : row(
            who,
            `Waiting for them · ${tableName(c.table)} · ${minutes(c.expiresIn)} left`,
            button("Cancel", () => void act(`/api/challenges/${c.id}`, "DELETE"), "link"),
            button("Open room", () => enter(c.room, who.nickname)),
          ),
    );
  }
  const list = box.querySelector("ul")!;
  list.replaceChildren(...items);
  box.hidden = items.length === 0;

  // Recent opponents, minus anyone already in a challenge above.
  const busy = new Set([...incoming.map((c) => c.from!.nickname), ...outgoing.map((c) => c.to!.nickname)]);
  // The three most recent: enough to find someone again without crowding Home.
  const recent = opponents.filter((o) => !busy.has(o.nickname)).slice(0, 3);
  recentBox.querySelector("ul")!.replaceChildren(
    ...recent.map((o) => {
      const { wins, losses, draws } = o.record;
      const record = `You ${wins}–${losses}${draws ? `–${draws}` : ""}`;
      const b = button("Challenge", async () => {
        b.disabled = true;
        statusLine.textContent = "";
        const error = await challenge(o.nickname, tableNow());
        b.disabled = false;
        if (error) statusLine.textContent = error;
      });
      return row(o, record, b);
    }),
  );
  recentBox.hidden = recent.length === 0;
}

let inFlight = false;
let opponentsCache: Opponent[] | null = null;

/** Check challenges (and, with `full`, recent opponents too). `full` also runs when the page is idle. */
export async function refresh(full = false): Promise<void> {
  if (!currentPlayer()) {
    box.hidden = recentBox.hidden = true;
    return;
  }
  if (inFlight || !homeVisible() || (!full && !inUse())) return;
  inFlight = true;
  try {
    const [lists, recent] = await Promise.all([
      api<{ incoming: Challenge[]; outgoing: Challenge[] }>("/api/me/challenges", { auth: true }),
      // Recent opponents only change after a game, so fetch them when Home opens, not on every check.
      full || !opponentsCache ? api<{ opponents: Opponent[] }>("/api/me/opponents", { auth: true }) : Promise.resolve({ opponents: opponentsCache }),
    ]);
    opponentsCache = recent.opponents;
    render(lists.incoming, lists.outgoing, recent.opponents);
  } catch {
    // Offline or signed out: keep what's shown.
  } finally {
    inFlight = false;
  }
}

export function startChallenges(opts: {
  enter: (room: string, opponent: string) => void;
  homeVisible: () => boolean;
  table: () => Difficulty;
  bestOf: () => 1 | 3;
}): void {
  enter = opts.enter;
  homeVisible = opts.homeVisible;
  tableNow = opts.table;
  bestOfNow = opts.bestOf;
  void refresh(true);
  window.setInterval(() => void refresh(), REFRESH_MS);
  onReturn(() => void refresh(true));
  window.addEventListener(PLAYER_READY, () => void refresh(true));
}
