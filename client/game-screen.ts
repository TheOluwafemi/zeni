import type { AiLevel } from "../shared/ai";
import { COIN_RADIUS, type Difficulty } from "../shared/constants";
import { randomSeed } from "../shared/rng";
import { other } from "../shared/rules";
import type { Seat } from "../shared/types";
import { sound } from "./audio";
import { ComputerPlayer } from "./game/computer";
import { LocalGame, type Resolved } from "./game/local-game";
import { Renderer } from "./game/render";
import { BoardView } from "./game/view";
import { mountTuning } from "./tune";

/** Who sits in seat 1: a friend on the same device, or the computer at some level. */
export type Opponent = "friend" | AiLevel;
export interface Setup {
  opponent: Opponent;
  difficulty: Difficulty;
}

const COMPUTER_SEAT: Seat = 1;
const AIM_PREVIEW_MS = 650;
const FLY_MS = 480;
const LEVEL_NAMES: Record<AiLevel, string> = { beginner: "Beginner", skilled: "Skilled", master: "Master" };

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const canvas = $<HTMLCanvasElement>("#board");
const wrap = $("#board-wrap");
const message = $("#message");
const result = $("#result");
const bars = [0, 1].map((seat) => $(`.player[data-seat="${seat}"]`));

const params = new URLSearchParams(location.search);
// ?seed=123 replays the same layout every game, handy while tuning.
const fixedSeed = params.has("seed") ? Number(params.get("seed")) >>> 0 : null;
const nextSeed = () => fixedSeed ?? randomSeed();

const view = new BoardView(canvas, wrap);
const renderer = new Renderer(view);
const game = new LocalGame(nextSeed(), "easy");
let computer: ComputerPlayer | null = null;
let setup: Setup = { opponent: "friend", difficulty: "easy" };
let firstPlayer: Seat = 0;
let dirty = true;
let running = false;
/** Bumped on every new game so callbacks from an old game are ignored. */
let gameToken = 0;
/** Pips shown per seat, so only new ones animate in. */
const shownPips = [0, 0];

if (params.has("tune")) mountTuning($("#tune"), game.physics);

/** Called when the player leaves the game for the home screen. */
let onExit: () => void = () => {};
export function setOnExit(fn: () => void): void {
  onExit = fn;
}

// --- Names and wording ---------------------------------------------------

const vsComputer = () => setup.opponent !== "friend";
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

// --- Bars and messages ----------------------------------------------------

/** Redraw both player bars. A newly kept coin for `awaiting` stays hidden until its flight lands. */
function updateBars(opts: { thinking?: boolean; awaiting?: Seat } = {}): void {
  const { scores, turn, status } = game.state;
  bars.forEach((bar, i) => {
    const seat = i as Seat;
    bar.classList.toggle("active", status === "playing" && turn === seat);
    bar.querySelector(".name")!.textContent =
      name(seat) + (opts.thinking && seat === COMPUTER_SEAT ? " · thinking…" : "");
    bar.querySelector(".score")!.textContent = String(scores[seat]);

    const pips = bar.querySelector(".pips")!;
    while (pips.children.length > scores[seat]) pips.lastElementChild!.remove();
    while (pips.children.length < scores[seat]) {
      const p = document.createElement("span");
      p.className = "pip";
      if (pips.children.length >= shownPips[seat]) {
        const isLastNew = pips.children.length === scores[seat] - 1;
        p.classList.add(opts.awaiting === seat && isLastNew ? "awaiting" : "pop");
      }
      pips.append(p);
    }
    shownPips[seat] = scores[seat];
  });
}

function say(text: string): void {
  message.textContent = text;
}

/** Fly a kept coin from the table into the player's tray. */
function flyToTray(kept: NonNullable<Resolved["kept"]>, seat: Seat): Promise<void> {
  const pip = bars[seat].querySelector<HTMLElement>(".pip.awaiting:last-child");
  if (!pip) return Promise.resolve();
  const from = view.toClient(kept.x, kept.y);
  const size = COIN_RADIUS * 2 * view.cssScale();
  const to = pip.getBoundingClientRect();
  const coin = document.createElement("div");
  coin.className = `flying-coin metal-${kept.metal}`;
  Object.assign(coin.style, { width: `${size}px`, height: `${size}px`, left: `${from.x - size / 2}px`, top: `${from.y - size / 2}px` });
  document.body.append(coin);

  const dx = to.left + to.width / 2 - from.x;
  const dy = to.top + to.height / 2 - from.y;
  const end = to.width / size;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const flight = coin.animate(
    [
      { transform: "translate(0, 0) scale(1)" },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 40}px) scale(1.15)`, offset: 0.45 },
      { transform: `translate(${dx}px, ${dy}px) scale(${end})` },
    ],
    { duration: reduce ? 1 : FLY_MS, easing: "cubic-bezier(0.4, 0, 0.2, 1)" },
  );
  return flight.finished.then(() => {
    coin.remove();
    pip.classList.remove("awaiting");
    pip.classList.add("pop");
  });
}

// --- Game flow ------------------------------------------------------------

export function start(next: Setup, rematch = false): void {
  setup = next;
  gameToken++;
  running = true;
  firstPlayer = rematch ? other(firstPlayer) : (Math.random() < 0.5 ? 0 : 1);
  game.reset(nextSeed(), setup.difficulty, firstPlayer);
  result.hidden = true;
  shownPips[0] = shownPips[1] = 0;
  for (const bar of bars) bar.querySelector(".pips")!.replaceChildren();
  $("#game-label").textContent =
    `${vsComputer() ? `vs ${LEVEL_NAMES[setup.opponent as AiLevel]}` : "Two players"} · ${setup.difficulty === "easy" ? "Easy table" : "Hard table"}`;
  updateBars();
  say(`${goesFirst(game.state.turn)} Drag back from a coin and let go.`);
  dirty = true;
  requestAnimationFrame(() => {
    if (view.resize()) dirty = true;
  });
  void playComputerTurn();
}

export function stop(): void {
  running = false;
  gameToken++;
  game.cancelAim();
  result.hidden = true;
}

function showResult(): void {
  const { winner, scores } = game.state;
  const youWon = winner !== "draw" && isYou(winner as Seat);
  const title = winner === "draw" ? "It's a draw" : youWon ? "You win!" : `${name(winner as Seat)} wins`;
  $("#result-title").textContent = title;
  $("#result-score").textContent = vsComputer()
    ? `You ${scores[0]} – ${scores[1]} Computer`
    : `Player 1 ${scores[0]} – ${scores[1]} Player 2`;
  const nextFirst = other(firstPlayer);
  $("#result-note").textContent = `In the rematch, ${isYou(nextFirst) ? "you go" : `${name(nextFirst)} goes`} first.`;
  result.hidden = false;
  if (vsComputer() && winner !== "draw") (youWon ? sound.win() : sound.lose());
  else sound.win();
  $<HTMLButtonElement>("#rematch").focus();
}

game.onFire = (shot) => sound.flick(shot.power);
game.onSimEvents = (events) => sound.events(events);

game.onResolved = ({ shooter, outcome, kept }: Resolved) => {
  const token = gameToken;
  const them = other(shooter);
  updateBars({ awaiting: kept ? shooter : undefined });
  const landed = kept ? flyToTray(kept, shooter) : Promise.resolve();
  if (kept) {
    sound.keep();
    if (isYou(shooter) || !vsComputer()) navigator.vibrate?.(12);
  }

  if (game.state.status === "over") {
    say("Game over.");
    void landed.then(() => setTimeout(() => token === gameToken && showResult(), 250));
    return;
  }

  const fell = outcome.fallen.length;
  const fellText = fell === 1 ? "A coin fell off the table" : `${fell} coins fell off the table`;
  const handedOver = `${gets(them)} ${fell === 1 ? "it" : "them"}.`;
  if (outcome.again) {
    say(isYou(shooter) || !vsComputer()
      ? `${keeps(shooter)} a coin! Shoot again with the same coin.`
      : `${keeps(shooter)} a coin and goes again with the same coin.`);
  } else if (outcome.blocked) {
    say(`${keeps(shooter)} a coin, but that coin stopped touching another, so it can't go again. ${turnOf(them)}`);
  } else if (kept) {
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

$("#rematch").addEventListener("click", () => start(setup, true));
$("#result-home").addEventListener("click", () => {
  stop();
  onExit();
});
$("#leave").addEventListener("click", () => {
  const midGame = game.state.status === "playing" && game.state.shots > 0;
  if (midGame && !confirm("Leave this game? It won't be saved.")) return;
  stop();
  onExit();
});

// --- Computer opponent ----------------------------------------------------

async function playComputerTurn(): Promise<void> {
  if (!isComputerTurn() || game.state.status !== "playing" || !game.canAim) return;
  const token = gameToken;
  computer ??= new ComputerPlayer();
  updateBars({ thinking: true });

  const shot = await computer.think(game.state, setup.opponent as AiLevel, game.physics);
  if (token !== gameToken) return;
  updateBars();

  // Draw the shot back like a player would, then let go.
  const begin = performance.now();
  await new Promise<void>((done) => {
    const pull = (now: number) => {
      if (token !== gameToken) return done();
      const t = Math.min(1, (now - begin) / AIM_PREVIEW_MS);
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
  sound.unlock();
  if (aimingPointer !== null || isComputerTurn()) return;
  if (!game.startAim(view.toBoard(e.clientX, e.clientY))) return;
  aimingPointer = e.pointerId;
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    // Synthetic or already-released pointers can't be captured; aiming still works.
  }
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
  if (running && (moving || dirty)) {
    renderer.draw(game, now);
    dirty = false;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
