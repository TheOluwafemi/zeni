// The leaderboard sheet: the top 100, with your own place highlighted and pinned underneath.

import { currentPlayer, refreshPlayer } from "./account";
import { api, ApiError } from "./api";
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

function rowElement(row: { rank: number | string; nickname: string; rating: number }, mine: boolean): HTMLElement {
  const el = document.createElement(mine ? "li" : "li");
  el.className = `board-row${mine ? " me" : ""}`;
  el.append(...cells(row));
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

export function openLeaderboard(): void {
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
