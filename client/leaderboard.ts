// The leaderboard sheet: the top 100, with your own place highlighted and pinned underneath.

import { currentPlayer, refreshPlayer } from "./account";
import { api, ApiError } from "./api";
import type { Difficulty } from "../shared/constants";
import { challenge } from "./challenges";
import { tierBadge } from "./tier";

interface Row {
  rank: number;
  nickname: string;
  rating: number;
  games: number;
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const sheet = $("#sheet-leaderboard");
const list = $("#board-list");
const status = $("#board-status");
const pinned = $("#board-me");

let table: Difficulty = "easy";

function rowElement(row: { rank: number | string; nickname: string; rating: number }, mine: boolean): HTMLElement {
  const el = document.createElement("li");
  el.className = `board-row${mine ? " me" : ""}`;
  el.append(...cells(row));
  // Anyone else can be challenged, once you have a player.
  if (!mine && currentPlayer()) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "challenge-btn";
    b.textContent = "Challenge";
    b.setAttribute("aria-label", `Challenge ${row.nickname}`);
    b.addEventListener("click", async () => {
      b.disabled = true;
      status.textContent = "";
      const error = await challenge(row.nickname, table);
      b.disabled = false;
      if (error) status.textContent = error;
      else close();
    });
    el.append(b);
  } else if (mine && currentPlayer()) {
    // Keeps your rating lined up with everyone else's, which have a Challenge button beside them.
    const spacer = document.createElement("button");
    spacer.type = "button";
    spacer.tabIndex = -1;
    spacer.className = "challenge-btn spacer";
    spacer.textContent = "Challenge";
    spacer.setAttribute("aria-hidden", "true");
    el.append(spacer);
  }
  return el;
}

function cells(row: { rank: number | string; nickname: string; rating: number }): HTMLElement[] {
  const rank = document.createElement("span");
  rank.className = "rank";
  rank.textContent = String(row.rank);

  const who = document.createElement("span");
  who.className = "who";
  const nick = document.createElement("span");
  nick.className = "nick";
  nick.textContent = row.nickname;
  who.append(tierBadge(row.rating), nick);

  const points = document.createElement("span");
  points.className = "points";
  points.textContent = String(row.rating);
  return [rank, who, points];
}

async function load(): Promise<void> {
  status.textContent = "Loading…";
  list.replaceChildren();
  pinned.hidden = true;
  try {
    const [{ players }] = await Promise.all([api<{ players: Row[] }>("/api/leaderboard"), refreshPlayer()]);
    render(players);
  } catch (e) {
    status.textContent = e instanceof ApiError && e.code === "offline" ? "Can't reach the server. Check your connection." : "Couldn't load the leaderboard.";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "Try again";
    retry.addEventListener("click", () => void load());
    list.replaceChildren(retry);
  }
}

function render(players: Row[]): void {
  const me = currentPlayer();
  const nothing = players.length === 0;
  status.textContent = nothing ? "No ranked games yet. Play online to be the first on the board." : "";
  list.replaceChildren(...players.map((p) => rowElement(p, me?.nickname.toLowerCase() === p.nickname.toLowerCase())));

  // Your own place, always in view, even if you're far down the list.
  if (me && me.games > 0 && me.position) {
    pinned.replaceChildren(...cells({ rank: `#${me.position}`, nickname: `${me.nickname} (you)`, rating: me.rating }));
    pinned.hidden = false;
    list.querySelector(".me")?.scrollIntoView({ block: "nearest" });
  } else if (me && !nothing) {
    status.textContent = "Play an online game to get a place on the board.";
  }
}

/** Open the board. Challenges sent from it are for `forTable`. */
export function openLeaderboard(forTable: Difficulty = "easy"): void {
  table = forTable;
  sheet.hidden = false;
  $<HTMLButtonElement>("#board-close").focus();
  void load();
}

function close(): void {
  sheet.hidden = true;
}

$("#board-close").addEventListener("click", close);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !sheet.hidden) close();
});
