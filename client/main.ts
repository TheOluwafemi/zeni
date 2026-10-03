// App shell: home screen, settings, How to Play, and moving between screens.

import { AI_LEVELS, type AiLevel } from "../shared/ai";
import type { Difficulty } from "../shared/constants";
import { sound } from "./audio";
import { start, setOnExit, type Opponent } from "./game-screen";
import { refreshPlayer } from "./account";
import { setupInstall } from "./install";
import { makeCoinSprite } from "./game/sprites";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const home = $("#home");
const gameScreen = $("#game");
const howto = $("#howto");

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

// --- Screens --------------------------------------------------------------

function show(screen: "home" | "game"): void {
  home.hidden = screen !== "home";
  gameScreen.hidden = screen !== "game";
  if (screen === "home") void refreshPlayer(); // ratings change after online games
}

function play(opponent: Opponent): void {
  sound.unlock();
  show("game");
  start({ opponent, difficulty: table });
}

setOnExit(() => show("home"));

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

bindSegment("level", level, (v) => save("zeni.level", (level = v as AiLevel)));
bindSegment("table", table, (v) => save("zeni.table", (table = v as Difficulty)));

$("#play-computer").addEventListener("click", () => play(level));
$("#play-friend").addEventListener("click", () => play("friend"));

const soundButton = $<HTMLButtonElement>("#toggle-sound");
function syncSound(): void {
  soundButton.textContent = sound.enabled ? "Sound on" : "Sound off";
  soundButton.setAttribute("aria-pressed", String(sound.enabled));
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
const brandSize = 96;
brand.width = brand.height = brandSize * dpr;
brand.style.width = brand.style.height = `${brandSize}px`;
const art = makeCoinSprite(1, (brandSize * dpr * 0.94) / 72); // 72 = coin diameter in board units
brand.getContext("2d")!.drawImage(art, (brand.width - art.width) / 2, (brand.height - art.height) / 2);

// --- How to play ----------------------------------------------------------

const slides = [...howto.querySelectorAll<HTMLElement>(".slides li")];
const dots = [...howto.querySelectorAll<HTMLElement>(".dots span")];
const next = $<HTMLButtonElement>("#howto-next");
let slide = 0;

function showSlide(i: number): void {
  slide = i;
  slides.forEach((s, j) => (s.hidden = j !== i));
  dots.forEach((d, j) => d.classList.toggle("on", j === i));
  next.textContent = i === slides.length - 1 ? "Let's play" : "Next";
}

function openHowTo(): void {
  showSlide(0);
  howto.hidden = false;
  next.focus();
}

function closeHowTo(): void {
  howto.hidden = true;
  save("zeni.seenHowTo", "1");
}

next.addEventListener("click", () => (slide < slides.length - 1 ? showSlide(slide + 1) : closeHowTo()));
$("#howto-skip").addEventListener("click", closeHowTo);
$("#open-howto").addEventListener("click", openHowTo);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !howto.hidden) closeHowTo();
});

// --- Start ----------------------------------------------------------------

// Dev shortcut: ?opponent=friend|beginner|skilled|master&difficulty=hard jumps straight into a game.
const params = new URLSearchParams(location.search);
const direct = params.get("opponent");
if (direct === "friend" || AI_LEVELS.includes(direct as AiLevel)) {
  if (params.get("difficulty") === "hard") table = "hard";
  play(direct as Opponent);
} else {
  show("home");
  if (load("zeni.seenHowTo", ["1", "0"] as const, "0") === "0") openHowTo();
}
