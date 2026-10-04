// App shell: home screen, settings, How to Play, and moving between screens.

import { AI_LEVELS, type AiLevel } from "../shared/ai";
import { COIN_COUNT, CUPS, type Difficulty } from "../shared/constants";
import { CHARACTERS } from "../shared/avatar";
import { avatarSvg } from "./avatar-svg";
import { dailyNumber } from "../shared/daily";
import { sound } from "./audio";
import { BUILD, installErrorReporting, ping, pingOpenOnce, setScreen } from "./diagnostics";
import { openFeedback } from "./feedback";
import { newRoomCode, normalizeRoomCode } from "../shared/room-code";
import { load3D, setPlace, start, startOnline, setOnExit, type Opponent } from "./game-screen";
import { PLACES, placeFor, unlocked } from "../shared/places";
import { TIERS } from "../shared/tiers";
import { currentPlayer, PLAYER_READY, promptForPlayer, refreshPlayer } from "./account";
import { setupInstall } from "./install";
import { openLeaderboard } from "./leaderboard";
import { refresh as refreshChallenges, startChallenges } from "./challenges";
import { cancelQuickMatch, openQuickMatch } from "./quick-match";
import { describePresence, latestPresence, pingSoon, startPresence } from "./presence";
import { makeCoinSprite } from "./game/sprites";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const home = $("#home");
const gameScreen = $("#game");

// --- Remembered choices (per device; safe if storage is unavailable) ------

function load<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not persisted; fine.
  }
}

let level: AiLevel = load("zeni.level", AI_LEVELS, "beginner");
let table: Difficulty = load("zeni.table", ["easy", "hard"] as const, "easy");
let match = load("zeni.match", ["1", "3"] as const, "1");
const bestOf = (): 1 | 3 => (match === "3" ? 3 : 1);

// --- Screens --------------------------------------------------------------

function show(screen: "home" | "game", detail = ""): void {
  setScreen(screen === "home" ? "home" : `game:${detail || "local"}`);
  home.hidden = screen !== "home";
  gameScreen.hidden = screen !== "game";
  gameSheet.hidden = friendSheet.hidden = true; // starting a game closes Home's sheets
  if (screen === "home") {
    renderDaily();
    void refreshPlayer(); // ratings change after online games
    void refreshChallenges();
  }
}

function play(opponent: Opponent): void {
  sound.unlock();
  if (opponent === "daily") ping("daily_puzzle");
  else if (opponent !== "friend" && opponent !== "tutorial") ping("computer_game");
  show("game", opponent === "friend" || opponent === "daily" || opponent === "tutorial" ? opponent : "computer");
  start({ opponent, difficulty: table, bestOf: bestOf() });
}

setOnExit(() => show("home"));

// The 3D table is a separate download: fetch it once Home is up, so the first screen stays quick.
const idle = window.requestIdleCallback ?? ((fn: () => void) => window.setTimeout(fn, 400));
idle(() => void load3D());

installErrorReporting();
pingOpenOnce();
$("#build").textContent = `build ${BUILD}`;
$("#open-feedback").addEventListener("click", openFeedback);

// --- Home -----------------------------------------------------------------

function bindSegment(group: string, current: string, onPick: (v: string) => void): void {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>(`[data-group="${group}"] button`)];
  const sync = (v: string) =>
    buttons.forEach((b) => {
      const on = b.dataset.value === v;
      b.classList.toggle("current", on);
      b.setAttribute("aria-checked", String(on));
    });
  buttons.forEach((b) =>
    b.addEventListener("click", () => {
      onPick(b.dataset.value!);
      sync(b.dataset.value!);
    }),
  );
  sync(current);
}

// Each level is a character: their face and name on the button, the level beneath.
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-group="level"] button')) {
  const lv = b.dataset.value as AiLevel;
  const c = CHARACTERS[lv];
  const levelName = b.textContent!.trim();
  b.innerHTML = `<span class="face">${avatarSvg(c.look, "neutral", { size: 36 })}</span><span class="who"><strong></strong><small></small></span>`;
  b.querySelector("strong")!.textContent = c.name;
  b.querySelector("small")!.textContent = levelName;
  b.setAttribute("aria-label", `${c.name}, ${levelName}`);
}
bindSegment("level", level, (v) => save("zeni.level", (level = v as AiLevel)));
// "Easy · 4 cups": the counts come from the rules, so the labels can't drift from them.
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-group="table"] button')) {
  const d = b.dataset.value as Difficulty;
  b.textContent = `${d === "easy" ? "Easy" : "Hard"} · ${CUPS[d]} cups`;
}
bindSegment("match", match, (v) => {
  save("zeni.match", (match = v as "1" | "3"));
  renderSummary();
});

// --- Places: where the table stands. Reaching a tier opens its place. ----------

const placePicker = $("#place-picker");
const placeNote = $("#place-note");
let pickedPlace: string | null = (() => {
  try {
    return localStorage.getItem("zeni.place");
  } catch {
    return null;
  }
})();

function renderPlaces(): void {
  const rating = currentPlayer()?.rating ?? null;
  const current = placeFor(pickedPlace, rating);
  setPlace(current.id);
  renderSummary();
  placePicker.replaceChildren(
    ...PLACES.map((p) => {
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "radio");
      const open = unlocked(p, rating);
      const tier = TIERS.find((t) => t.id === p.tier)!;
      b.textContent = open ? p.name : `🔒 ${p.name}`;
      b.disabled = !open;
      b.classList.toggle("current", p.id === current.id);
      b.setAttribute("aria-checked", String(p.id === current.id));
      if (!open) b.setAttribute("aria-label", `${p.name}, opens when you reach ${tier.name}`);
      b.addEventListener("click", () => {
        pickedPlace = p.id;
        try {
          localStorage.setItem("zeni.place", p.id);
        } catch {
          // Not remembered in private mode.
        }
        renderPlaces();
      });
      return b;
    }),
  );
  const locked = PLACES.find((p) => !unlocked(p, rating));
  placeNote.textContent = locked
    ? `Win online games to reach ${TIERS.find((t) => t.id === locked.tier)!.name} and open the ${locked.name.toLowerCase()}.`
    : "";
}
renderPlaces();
window.addEventListener(PLAYER_READY, renderPlaces);
bindSegment("table", table, (v) => {
  save("zeni.table", (table = v as Difficulty));
  renderPresence();
  renderSummary();
});

// --- Home's sheets: game settings, and playing a friend ----------------------

const gameSheet = $("#sheet-game");
const friendSheet = $("#sheet-friend");

/** "Easy table · Single game · Kitchen": the settings at a glance; tap to change them. */
function renderSummary(): void {
  const place = placeFor(pickedPlace, currentPlayer()?.rating ?? null);
  $("#settings-summary").textContent = `${table === "easy" ? "Easy" : "Hard"} table · ${match === "3" ? "Best of 3" : "Single game"} · ${place.name}`;
}

function openSheet(sheet: HTMLElement, focus: string): void {
  sheet.hidden = false;
  $<HTMLElement>(focus).focus();
}
$("#open-game-settings").addEventListener("click", () => openSheet(gameSheet, "#game-settings-done"));
$("#game-settings-done").addEventListener("click", () => (gameSheet.hidden = true));
$("#open-friend").addEventListener("click", () => openSheet(friendSheet, "#online-create"));
$("#friend-close").addEventListener("click", () => (friendSheet.hidden = true));
for (const sheet of [gameSheet, friendSheet]) {
  // Tap outside the card to close.
  sheet.addEventListener("click", (e) => e.target === sheet && (sheet.hidden = true));
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") gameSheet.hidden = friendSheet.hidden = true;
});
renderSummary();

function renderPresence(): void {
  const info = latestPresence();
  $("#presence").textContent = (info && describePresence(info, table)) || "Play someone at your level";
}
startPresence(renderPresence);

$("#play-computer").addEventListener("click", () => play(level));
$("#play-friend").addEventListener("click", () => play("friend"));
$("#play-daily").addEventListener("click", () => play("daily"));

/** The daily puzzle banner: today's number, and your result once you've played it. */
function renderDaily(): void {
  const n = dailyNumber();
  $("#daily-title").textContent = `Daily puzzle #${n}`;
  let done: { n: number; kept: number } | null = null;
  try {
    done = JSON.parse(localStorage.getItem("zeni.daily") ?? "null");
  } catch {
    // Nothing stored.
  }
  const today = done?.n === n ? done : null;
  $("#daily-text").textContent = today ? `You kept ${today.kept} of ${COIN_COUNT} today` : "Same table for everyone today";
  $("#daily-cta").textContent = today ? "Practise" : "Play";
}
renderDaily();

const soundButton = $<HTMLButtonElement>("#toggle-sound");
const SPEAKER = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/>';
function syncSound(): void {
  soundButton.innerHTML = sound.enabled
    ? `${SPEAKER}<path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`
    : `${SPEAKER}<path d="M16.5 9.5l5 5m0-5l-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
  soundButton.setAttribute("aria-pressed", String(sound.enabled));
  soundButton.setAttribute("aria-label", sound.enabled ? "Sound on" : "Sound off");
}
soundButton.addEventListener("click", () => {
  sound.unlock();
  sound.setEnabled(!sound.enabled);
  syncSound();
  if (sound.enabled) sound.keep();
});
syncSound();

setupInstall($<HTMLButtonElement>("#install"), $("#ios-hint"), $<HTMLButtonElement>("#ios-hint-dismiss"));

// The big coin on the home screen reuses the in-game coin art.
const brand = $<HTMLCanvasElement>(".brand-coin");
const dpr = Math.min(window.devicePixelRatio || 1, 3);
const brandSize = 34;
brand.width = brand.height = brandSize * dpr;
brand.style.width = brand.style.height = `${brandSize}px`;
const art = makeCoinSprite(1, (brandSize * dpr * 0.94) / 72); // 72 = coin diameter in board units
brand.getContext("2d")!.drawImage(art, (brand.width - art.width) / 2, (brand.height - art.height) / 2);

// --- Online rooms ---------------------------------------------------------

/** Run `action` once this device has a player, asking for one first if it doesn't. */
let pendingAction: (() => void) | null = null;
function needPlayer(action: () => void): void {
  if (currentPlayer()) return action();
  pendingAction = action;
  promptForPlayer();
}
window.addEventListener(PLAYER_READY, () => {
  const action = pendingAction;
  pendingAction = null;
  action?.();
});

function joinRoom(code: string): void {
  cancelQuickMatch(); // going into a friend's room ends any search
  sound.unlock();
  show("game", "online");
  startOnline(code, null);
}

$("#quick-match").addEventListener("click", () =>
  needPlayer(() => {
    sound.unlock();
    pingSoon();
    openQuickMatch(table, {
      matched: (room) => {
        show("game", "online");
        startOnline(room, null, { quick: true });
      },
      computer: () => play(level),
    });
  }),
);

$("#open-leaderboard").addEventListener("click", () => openLeaderboard(table));

startChallenges({
  enter: (room, opponent) => {
    cancelQuickMatch(); // a challenge game replaces any search
    sound.unlock();
    show("game", "online");
    startOnline(room, null, { challenge: opponent });
  },
  homeVisible: () => !home.hidden,
  table: () => table,
  bestOf,
});

$("#online-create").addEventListener("click", () =>
  needPlayer(() => {
    cancelQuickMatch();
    sound.unlock();
    show("game", "online");
    startOnline(newRoomCode(), table, { bestOf: bestOf() });
  }),
);

const joinInput = $<HTMLInputElement>("#online-code");
const joinStatus = $("#online-status");
$("#online-join").addEventListener("submit", (e) => {
  e.preventDefault();
  const code = normalizeRoomCode(joinInput.value);
  if (!code) {
    joinStatus.textContent = "Room codes are 5 letters and numbers.";
    joinStatus.className = "status bad";
    return;
  }
  joinStatus.textContent = "";
  needPlayer(() => joinRoom(code));
});
joinInput.addEventListener("input", () => (joinStatus.textContent = ""));

// --- How to play: the tutorial table ---------------------------------------

function playTutorial(): void {
  save("zeni.seenHowTo", "1");
  play("tutorial");
}
$("#open-howto").addEventListener("click", playTutorial);

// --- Start ----------------------------------------------------------------

// A shared link (/r/K7QXM) goes straight into that room, after making sure there's a player.
const sharedRoom = normalizeRoomCode(location.pathname.match(/^\/r\/([^/]+)\/?$/)?.[1] ?? "");

// Dev shortcut: ?opponent=friend|beginner|skilled|master&difficulty=hard jumps straight into a game.
const params = new URLSearchParams(location.search);
const direct = params.get("opponent");
if (sharedRoom) {
  show("home");
  pendingAction = () => joinRoom(sharedRoom);
  void refreshPlayer().then(() => {
    if (!currentPlayer()) promptForPlayer(); // PLAYER_READY then runs the join
  });
} else if (direct === "friend" || AI_LEVELS.includes(direct as AiLevel)) {
  if (params.get("difficulty") === "hard") table = "hard";
  play(direct as Opponent);
} else {
  show("home");
  // First visit: learn on the real table.
  if (load("zeni.seenHowTo", ["1", "0"] as const, "0") === "0") playTutorial();
}
