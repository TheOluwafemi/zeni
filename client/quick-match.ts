// Quick Match: join the queue for a table, wait to be paired, then hand over to the room.
//
// The search can run in front (the "Finding a match" sheet) or in the background while you play the
// computer (a small pill at the top). When the server finds someone it makes an offer that both
// players must accept: the sheet accepts straight away, the background search asks "Opponent found ·
// Join?" so nobody is pulled out of a game they're enjoying without saying yes.

import type { Difficulty } from "../shared/constants";
import type { QueueServerMsg } from "../shared/protocol";
import { identity } from "./api";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const sheet = $("#sheet-queue");
const text = $("#queue-text");
const pill = $("#queue-pill");
const pillText = $("#queue-pill-text");
const banner = $("#match-offer");
const bannerWho = $("#offer-who");
const joinButton = $<HTMLButtonElement>("#offer-join");
const skipButton = $<HTMLButtonElement>("#offer-skip");

const MAX_RECONNECTS = 5;

export interface QuickMatchHandlers {
  /** An opponent was found and a room is ready for you both. */
  matched(room: string, table: Difficulty): void;
  /** The player chose to play the computer while they wait. */
  computer(): void;
}

interface Search {
  table: Difficulty;
  ws: WebSocket | null;
  /** In front (the sheet) or behind a game against the computer (the pill). */
  mode: "sheet" | "background";
  started: number;
  /** An offer waiting for this player's answer. */
  offer: { id: string; expiresAt: number; answered: boolean } | null;
  /** The socket is being closed on purpose; don't reconnect. */
  closing: boolean;
  reconnects: number;
}

let search: Search | null = null;
let onVisible = (): void => {};
document.addEventListener("visibilitychange", () => onVisible());
let tick = 0;
let pillTimer = 0;

const tableName = (t: Difficulty) => (t === "easy" ? "Easy" : "Hard");
const elapsed = (s: Search) => {
  const secs = Math.floor((Date.now() - s.started) / 1000);
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
};

/** Stop searching and hide everything. */
export function cancelQuickMatch(): void {
  const s = search;
  search = null;
  window.clearInterval(tick);
  sheet.hidden = banner.hidden = pill.hidden = true;
  if (!s) return;
  s.closing = true;
  try {
    s.ws?.close(1000, "done");
  } catch {
    // Already closed.
  }
}

/** Whether a search is running behind a game. */
export const searchingInBackground = (): boolean => search?.mode === "background";

export function openQuickMatch(table: Difficulty, handlers: QuickMatchHandlers): void {
  // Already looking for this table behind a game: bring the search back to the front, keeping its place.
  if (search?.mode === "background" && search.table === table && !search.offer) {
    search.mode = "sheet";
    pill.hidden = true;
    sheet.hidden = false;
    return;
  }
  cancelQuickMatch();
  window.clearTimeout(pillTimer);
  const s: Search = { table, ws: null, mode: "sheet", started: Date.now(), offer: null, closing: false, reconnects: 0 };
  search = s;

  const say = (t: string) => (text.textContent = t);
  const waitingText = () => `Looking for an opponent on the ${tableName(table)} table… ${elapsed(s)}`;
  say(waitingText());
  sheet.hidden = false;
  $<HTMLButtonElement>("#queue-cancel").focus();

  const render = (): void => {
    if (search !== s) return;
    if (s.mode === "sheet" && !s.offer && s.ws) say(waitingText());
    pillText.textContent = `Looking for a game · ${elapsed(s)}`;
    if (s.offer && !s.offer.answered) {
      const left = Math.max(0, Math.ceil((s.offer.expiresAt - Date.now()) / 1000));
      joinButton.textContent = `Join · ${left}`;
    }
  };
  tick = window.setInterval(render, 1000);

  /** Stop the search and leave a short note on the pill. */
  const stopWithNote = (note: string): void => {
    cancelQuickMatch();
    pillText.textContent = note;
    pill.hidden = false;
    pillTimer = window.setTimeout(() => !search && (pill.hidden = true), 4000);
  };

  const answer = (yes: boolean): void => {
    if (!s.offer || s.offer.answered) return;
    s.offer.answered = true;
    if (!yes) s.closing = true; // declining ends the search; the server closes the socket
    s.ws?.send(JSON.stringify({ t: yes ? "accept" : "decline", offer: s.offer.id }));
    if (yes) {
      joinButton.textContent = "Joining…";
      joinButton.disabled = skipButton.disabled = true;
      say("Opponent found. Joining…");
    } else cancelQuickMatch();
  };

  const showOffer = (msg: Extract<QueueServerMsg, { t: "offer" }>): void => {
    s.offer = { id: msg.offer, expiresAt: Date.now() + msg.expiresIn, answered: false };
    // Watching the search screen means yes. Otherwise (playing the computer, or the app is in the
    // background) ask first.
    if (s.mode === "sheet" && !document.hidden) return answer(true);
    bannerWho.textContent = `${msg.opponent.nickname} (${msg.opponent.rating})`;
    if (s.mode === "sheet") say(`Opponent found: ${bannerWho.textContent}.`);
    joinButton.disabled = skipButton.disabled = false;
    banner.hidden = false;
    pill.hidden = true;
    render();
    joinButton.focus();
  };

  const offerGone = (): void => {
    s.offer = null;
    banner.hidden = true;
    if (s.mode === "background") pill.hidden = false;
    else say(waitingText());
  };

  $("#queue-computer").onclick = () => {
    s.mode = "background";
    sheet.hidden = true;
    pill.hidden = !!s.offer;
    render();
    handlers.computer();
  };
  $("#queue-cancel").onclick = cancelQuickMatch;
  $("#queue-pill-stop").onclick = cancelQuickMatch;
  // Left the search screen open and came back while the offer is still open: that's a yes.
  onVisible = () => {
    if (search === s && s.mode === "sheet" && !document.hidden) answer(true);
  };
  joinButton.onclick = () => answer(true);
  skipButton.onclick = () => answer(false);

  const connect = (): void => {
    const scheme = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${scheme}//${location.host}/ws/queue/${table}`);
    s.ws = socket;

    socket.addEventListener("open", () => {
      const code = identity.code;
      if (!code) {
        say("This device has no player. Create or restore one first.");
        return cancelQuickMatch();
      }
      socket.send(JSON.stringify({ t: "queue", code }));
    });

    socket.addEventListener("message", (e) => {
      if (search !== s) return;
      const msg = JSON.parse(String(e.data)) as QueueServerMsg;
      if (msg.t === "offer") showOffer(msg);
      else if (msg.t === "offer_cancelled") offerGone();
      else if (msg.t === "matched") {
        cancelQuickMatch();
        handlers.matched(msg.room, msg.table);
      } else if (msg.t === "error") {
        s.closing = true; // the server is about to close this socket on purpose
        window.clearInterval(tick);
        const why = msg.error === "already_queued" ? "You're already looking for a match in another tab." : "Couldn't join the queue. Try again.";
        if (s.mode === "background") stopWithNote(why);
        else say(why);
      }
    });

    socket.addEventListener("close", (e) => {
      if (search !== s || s.closing || socket !== s.ws) return;
      // The offer ran out before this player said yes: the server took them out of the queue.
      if (e.code === 4408) return s.mode === "background" ? stopWithNote("Missed that one. Search stopped.") : cancelQuickMatch();
      // A dropped connection: try again a few times, keeping the player in line as best we can.
      s.offer = null;
      banner.hidden = true;
      if (s.reconnects++ >= MAX_RECONNECTS) {
        window.clearInterval(tick);
        const why = "Can't reach the server. Check your connection and try again.";
        return s.mode === "background" ? stopWithNote(why) : say(why);
      }
      window.setTimeout(() => search === s && !s.closing && connect(), 1000);
    });
  };
  connect();
}
