// Quick Match: join the queue for a table, wait to be paired, then hand over to the room.

import type { Difficulty } from "../shared/constants";
import type { QueueServerMsg } from "../shared/protocol";
import { identity } from "./api";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const sheet = $("#sheet-queue");
const text = $("#queue-text");
const computerButton = $("#queue-computer");

/** After this long with no opponent, offer a game against the computer instead. */
const OFFER_COMPUTER_MS = 20_000;
const MAX_RECONNECTS = 5;

export interface QuickMatchHandlers {
  /** An opponent was found and a room is ready for you both. */
  matched(room: string, table: Difficulty): void;
  /** The player chose to play the computer instead of waiting. */
  computer(): void;
}

let ws: WebSocket | null = null;
let tick = 0;
let closing = false;

function cleanup(): void {
  closing = true;
  window.clearInterval(tick);
  try {
    ws?.close(1000, "done");
  } catch {
    // Already closed.
  }
  ws = null;
  sheet.hidden = true;
}

export function cancelQuickMatch(): void {
  if (!sheet.hidden || ws) cleanup();
}

export function openQuickMatch(table: Difficulty, handlers: QuickMatchHandlers): void {
  cancelQuickMatch();
  closing = false;
  const tableName = table === "easy" ? "Easy" : "Hard";
  const started = Date.now();
  let reconnects = 0;

  const say = (t: string) => (text.textContent = t);
  const waitingText = () => `Looking for an opponent on the ${tableName} table… ${Math.floor((Date.now() - started) / 1000)}s`;
  say(waitingText());
  computerButton.hidden = true;
  sheet.hidden = false;
  $<HTMLButtonElement>("#queue-cancel").focus();

  window.clearInterval(tick);
  tick = window.setInterval(() => {
    if (ws) say(waitingText());
    if (Date.now() - started >= OFFER_COMPUTER_MS) computerButton.hidden = false;
  }, 1000);

  computerButton.onclick = () => {
    cleanup();
    handlers.computer();
  };
  $("#queue-cancel").onclick = cleanup;

  const connect = (): void => {
    const scheme = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${scheme}//${location.host}/ws/queue/${table}`);
    ws = socket;

    socket.addEventListener("open", () => {
      const code = identity.code;
      if (!code) {
        say("This device has no player. Create or restore one first.");
        return cleanup();
      }
      socket.send(JSON.stringify({ t: "queue", code }));
    });

    socket.addEventListener("message", (e) => {
      const msg = JSON.parse(String(e.data)) as QueueServerMsg;
      if (msg.t === "matched") {
        cleanup();
        handlers.matched(msg.room, msg.table);
      } else if (msg.t === "error") {
        closing = true; // the server is about to close this socket on purpose
        window.clearInterval(tick);
        say(msg.error === "already_queued" ? "You're already looking for a match in another tab." : "Couldn't join the queue. Try again.");
      }
    });

    socket.addEventListener("close", () => {
      if (closing || socket !== ws) return;
      // A dropped connection: try again a few times, keeping the player in line as best we can.
      if (reconnects++ >= MAX_RECONNECTS) {
        window.clearInterval(tick);
        return say("Can't reach the server. Check your connection and try again.");
      }
      window.setTimeout(() => !closing && connect(), 1000);
    });
  };
  connect();
}
