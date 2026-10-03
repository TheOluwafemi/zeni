import type { Difficulty } from "../shared/constants";
import { randomSeed } from "../shared/rng";
import { other } from "../shared/rules";
import type { Seat } from "../shared/types";
import { LocalGame, type Resolved } from "./game/local-game";
import { Renderer } from "./game/render";
import { BoardView } from "./game/view";
import { mountTuning } from "./tune";

const NAMES = ["Player 1", "Player 2"] as const;

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const canvas = $<HTMLCanvasElement>("#board");
const wrap = $("#board-wrap");
const message = $("#message");
const result = $("#result");
const bars = [0, 1].map((seat) => $(`.player[data-seat="${seat}"]`));

// ?seed=123 replays the same layout every game, handy while tuning.
const params = new URLSearchParams(location.search);
const fixedSeed = params.has("seed") ? Number(params.get("seed")) >>> 0 : null;
const nextSeed = () => fixedSeed ?? randomSeed();

let difficulty: Difficulty = params.get("difficulty") === "hard" ? "hard" : "easy";

const view = new BoardView(canvas, wrap);
const renderer = new Renderer(view);
const game = new LocalGame(nextSeed(), difficulty);
let dirty = true;

if (params.has("tune")) mountTuning($("#tune"), game.physics);

// --- UI -------------------------------------------------------------------

function updateBars(): void {
  const { scores, turn, status } = game.state;
  bars.forEach((bar, seat) => {
    bar.classList.toggle("active", status === "playing" && turn === seat);
    bar.querySelector(".score")!.textContent = String(scores[seat]);
    const pips = bar.querySelector(".pips")!;
    pips.replaceChildren(
      ...Array.from({ length: scores[seat] }, () => {
        const p = document.createElement("span");
        p.className = "pip";
        return p;
      }),
    );
  });
}

function say(text: string): void {
  message.textContent = text;
}

function startGame(): void {
  game.reset(nextSeed(), difficulty);
  result.hidden = true;
  for (const b of difficultyButtons) b.classList.toggle("current", b.dataset.difficulty === difficulty);
  updateBars();
  say(
    `${NAMES[game.state.turn]} goes first. Drag back from a coin and let go. Hit exactly one coin to keep it, but anything that falls off goes to your opponent.`,
  );
  dirty = true;
}

function showResult(): void {
  const { winner, scores } = game.state;
  $("#result-title").textContent = winner === "draw" ? "It's a draw" : `${NAMES[winner as Seat]} wins`;
  $("#result-score").textContent = `${scores[0]} – ${scores[1]}`;
  result.hidden = false;
  $<HTMLButtonElement>("#play-again").focus();
}

game.onResolved = ({ shooter, outcome }: Resolved) => {
  updateBars();
  if (game.state.status === "over") {
    say("Game over.");
    // Let the capture animation play before the result card covers the board.
    setTimeout(showResult, 600);
    return;
  }
  const me = NAMES[shooter];
  const them = NAMES[other(shooter)];
  const fell = outcome.fallen.length;
  const fellText = fell === 1 ? "A coin fell off the table" : `${fell} coins fell off the table`;
  const gives = `${them} gets ${fell === 1 ? "it" : "them"}`;

  if (outcome.captured !== null) navigator.vibrate?.(12);
  if (outcome.again) {
    say(`${me} keeps a coin! Shoot again with the same coin.`);
  } else if (outcome.blocked) {
    say(`${me} keeps a coin, but their coin stopped touching another, so it can't go again. ${them}'s turn.`);
  } else if (outcome.captured !== null) {
    say(`${me} keeps a coin, but ${fellText.toLowerCase()}. ${gives}, and it's ${them}'s turn.`);
  } else if (fell > 0) {
    say(`${fellText}. ${gives}, and it's ${them}'s turn.`);
  } else if (outcome.touched === 0) {
    say(`No touch. ${them}'s turn.`);
  } else {
    say(`Touched ${outcome.touched} coins, so none kept. ${them}'s turn.`);
  }
};

const difficultyButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-difficulty]")];
for (const b of difficultyButtons) {
  b.addEventListener("click", () => {
    difficulty = b.dataset.difficulty as Difficulty;
    startGame();
  });
}
$("#play-again").addEventListener("click", startGame);

// --- Input ----------------------------------------------------------------

let aimingPointer: number | null = null;

canvas.addEventListener("pointerdown", (e) => {
  if (aimingPointer !== null) return;
  if (!game.startAim(view.toBoard(e.clientX, e.clientY))) return;
  aimingPointer = e.pointerId;
  canvas.setPointerCapture(e.pointerId);
  canvas.style.cursor = "grabbing";
  dirty = true;
});

canvas.addEventListener("pointermove", (e) => {
  const p = view.toBoard(e.clientX, e.clientY);
  if (e.pointerId === aimingPointer) {
    game.moveAim(p);
    dirty = true;
  } else if (e.pointerType === "mouse" && aimingPointer === null) {
    canvas.style.cursor = game.coinAt(p) ? "grab" : "default";
  }
});

function endAim(e: PointerEvent, fire: boolean): void {
  if (e.pointerId !== aimingPointer) return;
  aimingPointer = null;
  canvas.style.cursor = "default";
  if (fire) game.releaseAim();
  else game.cancelAim();
  dirty = true;
}

canvas.addEventListener("pointerup", (e) => endAim(e, true));
canvas.addEventListener("pointercancel", (e) => endAim(e, false));

// --- Loop -----------------------------------------------------------------

new ResizeObserver(() => {
  if (view.resize()) dirty = true;
}).observe(wrap);

let last = performance.now();
function frame(now: number): void {
  const moving = game.update((now - last) / 1000, now);
  last = now;
  if (moving || dirty) {
    renderer.draw(game, now);
    dirty = false;
  }
  requestAnimationFrame(frame);
}

view.resize();
startGame();
requestAnimationFrame(frame);
