import { AI_LEVELS, type AiLevel } from "../shared/ai";
import type { Difficulty } from "../shared/constants";
import { randomSeed } from "../shared/rng";
import { other } from "../shared/rules";
import type { Seat } from "../shared/types";
import { ComputerPlayer } from "./game/computer";
import { LocalGame, type Resolved } from "./game/local-game";
import { Renderer } from "./game/render";
import { BoardView } from "./game/view";
import { mountTuning } from "./tune";

/** Who sits in seat 1: a friend on the same device, or the computer at some level. */
type Opponent = "friend" | AiLevel;
const COMPUTER_SEAT: Seat = 1;
const AIM_PREVIEW_MS = 650;

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const canvas = $<HTMLCanvasElement>("#board");
const wrap = $("#board-wrap");
const message = $("#message");
const result = $("#result");
const opponentSelect = $<HTMLSelectElement>("#opponent");
const bars = [0, 1].map((seat) => $(`.player[data-seat="${seat}"]`));

// ?seed=123 replays the same layout every game, handy while tuning.
const params = new URLSearchParams(location.search);
const fixedSeed = params.has("seed") ? Number(params.get("seed")) >>> 0 : null;
const nextSeed = () => fixedSeed ?? randomSeed();

let difficulty: Difficulty = params.get("difficulty") === "hard" ? "hard" : "easy";
let opponent: Opponent = AI_LEVELS.includes(params.get("opponent") as AiLevel)
  ? (params.get("opponent") as AiLevel)
  : "friend";

const view = new BoardView(canvas, wrap);
const renderer = new Renderer(view);
const game = new LocalGame(nextSeed(), difficulty);
let computer: ComputerPlayer | null = null;
let dirty = true;
/** Bumped on every new game so a computer turn from an old game is ignored. */
let gameToken = 0;

if (params.has("tune")) mountTuning($("#tune"), game.physics);

// --- Names and wording ---------------------------------------------------

const vsComputer = () => opponent !== "friend";
const isYou = (seat: Seat) => vsComputer() && seat !== COMPUTER_SEAT;
const isComputerTurn = () => vsComputer() && game.state.turn === COMPUTER_SEAT;

function name(seat: Seat): string {
  if (!vsComputer()) return seat === 0 ? "Player 1" : "Player 2";
  return seat === COMPUTER_SEAT ? "Computer" : "You";
}
const keeps = (seat: Seat) => `${name(seat)} ${isYou(seat) ? "keep" : "keeps"}`;
const gets = (seat: Seat) => `${name(seat)} ${isYou(seat) ? "get" : "gets"}`;
const turnOf = (seat: Seat) => (isYou(seat) ? "Your turn." : `${name(seat)}'s turn.`);
const goesFirst = (seat: Seat) => `${name(seat)} ${isYou(seat) ? "go" : "goes"} first.`;

// --- UI -------------------------------------------------------------------

function updateBars(thinking = false): void {
  const { scores, turn, status } = game.state;
  bars.forEach((bar, i) => {
    const seat = i as Seat;
    bar.classList.toggle("active", status === "playing" && turn === seat);
    const label = name(seat) + (thinking && seat === COMPUTER_SEAT ? " · thinking…" : "");
    bar.querySelector(".name")!.textContent = label;
    bar.querySelector(".score")!.textContent = String(scores[seat]);
    bar.querySelector(".pips")!.replaceChildren(
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
  gameToken++;
  game.reset(nextSeed(), difficulty);
  result.hidden = true;
  for (const b of difficultyButtons) b.classList.toggle("current", b.dataset.difficulty === difficulty);
  opponentSelect.value = opponent;
  updateBars();
  say(
    `${goesFirst(game.state.turn)} Drag back from a coin and let go. Hit exactly one coin to keep it, but anything that falls off goes to the other player.`,
  );
  dirty = true;
  void playComputerTurn();
}

function showResult(): void {
  const { winner, scores } = game.state;
  const title =
    winner === "draw" ? "It's a draw" : isYou(winner as Seat) ? "You win!" : `${name(winner as Seat)} wins`;
  $("#result-title").textContent = title;
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
  const them = other(shooter);
  const fell = outcome.fallen.length;
  const fellText = fell === 1 ? "A coin fell off the table" : `${fell} coins fell off the table`;
  const handedOver = `${gets(them)} ${fell === 1 ? "it" : "them"}.`;

  if (outcome.captured !== null && isYou(shooter)) navigator.vibrate?.(12);
  if (outcome.again) {
    say(isYou(shooter) || !vsComputer()
      ? `${keeps(shooter)} a coin! Shoot again with the same coin.`
      : `${keeps(shooter)} a coin and goes again with the same coin.`);
  } else if (outcome.blocked) {
    say(`${keeps(shooter)} a coin, but that coin stopped touching another, so it can't go again. ${turnOf(them)}`);
  } else if (outcome.captured !== null) {
    say(`${keeps(shooter)} a coin, but ${fellText.toLowerCase()}. ${handedOver} ${turnOf(them)}`);
  } else if (fell > 0) {
    say(`${fellText}. ${handedOver} ${turnOf(them)}`);
  } else if (outcome.touched === 0) {
    say(`No touch. ${turnOf(them)}`);
  } else {
    say(`Touched ${outcome.touched} coins, so none kept. ${turnOf(them)}`);
  }
  void playComputerTurn();
};

const difficultyButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-difficulty]")];
for (const b of difficultyButtons) {
  b.addEventListener("click", () => {
    difficulty = b.dataset.difficulty as Difficulty;
    startGame();
  });
}
opponentSelect.addEventListener("change", () => {
  opponent = opponentSelect.value as Opponent;
  startGame();
});
$("#play-again").addEventListener("click", startGame);

// --- Computer opponent ----------------------------------------------------

async function playComputerTurn(): Promise<void> {
  if (!isComputerTurn() || game.state.status !== "playing" || !game.canAim) return;
  const token = gameToken;
  computer ??= new ComputerPlayer();
  updateBars(true);

  const shot = await computer.think(game.state, opponent as AiLevel, game.physics);
  if (token !== gameToken) return;
  updateBars();

  // Draw the shot back like a player would, then let go.
  const start = performance.now();
  await new Promise<void>((done) => {
    const pull = (now: number) => {
      if (token !== gameToken) return done();
      const t = Math.min(1, (now - start) / AIM_PREVIEW_MS);
      game.previewAim(shot, 1 - (1 - t) ** 3);
      dirty = true;
      if (t < 1) requestAnimationFrame(pull);
      else done();
    };
    requestAnimationFrame(pull);
  });
  if (token !== gameToken) return;
  game.fire(shot);
}

// --- Input ----------------------------------------------------------------

let aimingPointer: number | null = null;

canvas.addEventListener("pointerdown", (e) => {
  if (aimingPointer !== null || isComputerTurn()) return;
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
    canvas.style.cursor = !isComputerTurn() && game.coinAt(p) ? "grab" : "default";
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
