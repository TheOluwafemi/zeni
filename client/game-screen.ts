import type { AiLevel } from "../shared/ai";
import { CHARACTERS, lookFromSeed, lookSeed, type Expression, type Look } from "../shared/avatar";
import { COIN_COUNT, COIN_RADIUS, DEFAULT_PHYSICS, type Difficulty } from "../shared/constants";
import { AIM_SEND_MS, TURN_MS, type MatchInfo, type OverInfo, type Players, type ServerMsg } from "../shared/protocol";
import { newRoomCode } from "../shared/room-code";
import { randomSeed } from "../shared/rng";
import { newGame, other } from "../shared/rules";
import { tierChange, tierFor } from "../shared/tiers";
import type { GameState, Seat } from "../shared/types";
import { currentPlayer } from "./account";
import { AimThrottle } from "./aim-relay";
import { avatarSvg } from "./avatar-svg";
import { sound } from "./audio";
import { RoomClient, type Fatal, type Link } from "./net";
import { REACTIONS } from "../shared/reactions";
import { onReact, showBubble, showReactions } from "./reactions";
import { tierBadge } from "./tier";
import { ComputerPlayer } from "./game/computer";
import { LocalGame, type Resolved } from "./game/local-game";
import { setOpponentColor } from "./game/overlay";
import { FlatView, type TableView } from "./game/table-view";
import type { Table3D } from "./game/table-3d";
import type { PlaceId } from "../shared/places";
import { DAILY_TABLE, DAILY_TURNS, dailyNumber, dailySeed, shareLine } from "../shared/daily";
import { mountTuning } from "./tune";

/** Who sits in seat 1: a friend on the same device, the computer at some level, or someone online. */
export type Opponent = "friend" | AiLevel | "online" | "daily" | "tutorial";
export interface Setup {
  opponent: Opponent;
  difficulty: Difficulty;
  /** A single game, or a best-of-3 (rounds alternate who goes first). */
  bestOf?: 1 | 3;
}

/** " · Round 2 of 3 · 1–0" for a best-of-3, nothing for a single game. */
function roundLabel(m: MatchInfo, you: Seat = 0): string {
  if (m.bestOf === 1) return "";
  return ` · Round ${m.round} of 3 · ${m.wins[you]}–${m.wins[you === 0 ? 1 : 0]}`;
}

/** A best-of-3 on this device: the round being played and the rounds each seat has won. */
const localMatch = { round: 1, wins: [0, 0] as [number, number], counted: false };
/** The result card's main button starts the next round rather than a new match. */
let nextIsRound = false;

const COMPUTER_SEAT: Seat = 1;
const AIM_PREVIEW_MS = 650;
const FLY_MS = 480;
const LEVEL_NAMES: Record<AiLevel, string> = { beginner: "Beginner", skilled: "Skilled", master: "Master" };
const character = () => CHARACTERS[setup.opponent as AiLevel];

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const canvas = $<HTMLCanvasElement>("#board");
const wrap = $("#board-wrap");
const message = $("#message");
const result = $("#result");
const lobby = $("#sheet-lobby");
const notice = $("#notice");
const conn = $("#conn");
const bars = [0, 1].map((seat) => $(`.player[data-seat="${seat}"]`));

const params = new URLSearchParams(location.search);
// ?seed=123 replays the same layout every game, handy while tuning.
const fixedSeed = params.has("seed") ? Number(params.get("seed")) >>> 0 : null;
const nextSeed = () => fixedSeed ?? randomSeed();

/** The flat view until the 3D table has loaded (or for good, if this device can't show 3D). */
let view: TableView = new FlatView(canvas, wrap);
const viewToggle = $<HTMLButtonElement>("#view-toggle");
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

/** The online room this device is in, if any. */
interface Online {
  client: RoomClient;
  code: string;
  /** What this device asked for, so a code clash can be retried. */
  created: Difficulty | null;
  /** A Quick Match room: the opponent is already on their way, so there's no code to share. */
  quick: boolean;
  /** A single game or a best-of-3, and how it stands. */
  match: MatchInfo;
  /** A challenge room: who it's with. There's no code to share either; they see it on Home. */
  challenge: string | null;
  seat: Seat;
  players: Players;
  status: "waiting" | "playing" | "over";
  over: OverInfo | null;
  rematch: [boolean, boolean];
}
let online: Online | null = null;
/** When the current turn runs out, by this device's clock. */
let deadlineAt: number | null = null;
/** Why the online game ended, for the result card (the rematch line is added beneath it). */
let resultReason = "";

if (params.has("tune")) mountTuning($("#tune"), game.physics);

/** Called when the player leaves the game for the home screen. */
let onExit: () => void = () => {};
export function setOnExit(fn: () => void): void {
  onExit = fn;
}

// --- Names and wording ---------------------------------------------------

const isOnline = () => setup.opponent === "online";
const isDaily = () => setup.opponent === "daily";
const isTutorial = () => setup.opponent === "tutorial";
/** Played alone on this device: the daily puzzle and the tutorial. */
const solo = () => isDaily() || isTutorial();
const vsComputer = () => setup.opponent !== "friend" && setup.opponent !== "online" && !solo();
/** The seat this device plays, or null when everyone shares the device. */
const youSeat = (): Seat | null => (isOnline() ? (online?.seat ?? null) : vsComputer() || solo() ? 0 : null);
const isYou = (seat: Seat) => youSeat() === seat;
const isComputerTurn = () => vsComputer() && game.state.turn === COMPUTER_SEAT;

function name(seat: Seat): string {
  if (isOnline()) return isYou(seat) ? "You" : (online?.players[seat]?.nickname ?? "Opponent");
  if (isDaily()) return seat === 0 ? "You" : "The floor";
  if (isTutorial()) return seat === 0 ? "You" : "Your opponent";
  if (!vsComputer()) return seat === 0 ? "Player 1" : "Player 2";
  return seat === COMPUTER_SEAT ? character().name : "You";
}
const keeps = (seat: Seat) => `${name(seat)} ${isYou(seat) ? "keep" : "keeps"}`;
const gets = (seat: Seat) => `${name(seat)} ${isYou(seat) ? "get" : "gets"}`;
const turnOf = (seat: Seat) => (isYou(seat) ? "Your turn." : `${name(seat)}'s turn.`);
const goesFirst = (seat: Seat) => `${name(seat)} ${isYou(seat) ? "go" : "goes"} first.`;

// --- Bars and messages ----------------------------------------------------

// --- Avatars ----------------------------------------------------------------

/** Each seat's face right now. They react to shots, then relax. */
const faces: [Expression, Expression] = ["neutral", "neutral"];
let relaxTimer = 0;

/** Who each seat looks like, or null for the two players sharing a device. */
function lookFor(seat: Seat): Look | null {
  if (isOnline()) {
    const info = online?.players[seat];
    return info ? lookFromSeed(info.look) : null;
  }
  if (!vsComputer() && !solo()) return null;
  if (seat === COMPUTER_SEAT) return solo() ? null : character().look;
  const me = currentPlayer();
  return me ? lookFromSeed(lookSeed(me.playerId)) : null;
}

/** The shooter's face after a shot, and the other player's the opposite way. */
function react(shooter: Seat, face: Expression): void {
  faces[shooter] = face;
  faces[other(shooter)] = face === "pleased" ? "dismayed" : "pleased";
  window.clearTimeout(relaxTimer);
  const over = game.state.status === "over";
  if (!over) relaxTimer = window.setTimeout(() => ((faces[0] = faces[1] = "neutral"), updateBars()), 2200);
  else {
    const w = game.state.winner;
    if (w === "draw") faces[0] = faces[1] = "neutral";
    else ((faces[w as Seat] = "pleased"), (faces[other(w as Seat)] = "dismayed"));
  }
  updateBars();
}

/** Draw the avatars into the bars (only when something changed) and set the opponent's colour. */
function renderAvatars(): void {
  bars.forEach((bar, i) => {
    const seat = i as Seat;
    const look = lookFor(seat);
    const slot = bar.querySelector<HTMLElement>(".avatar")!;
    const key = look ? `${JSON.stringify(look)}:${faces[seat]}` : "";
    if (slot.dataset.key === key) return;
    slot.dataset.key = key;
    slot.innerHTML = look ? avatarSvg(look, faces[seat], { size: 36 }) : "";
  });
  // Their colour is their shirt: their aim line and their bubbles. In 3D they sit across the table.
  const theirSeat = isOnline() && online ? other(online.seat) : vsComputer() ? COMPUTER_SEAT : null;
  const theirs = theirSeat === null ? null : lookFor(theirSeat);
  view.setOpponent(theirs, theirSeat === null ? "neutral" : faces[theirSeat], theirSeat !== null && game.state.status === "playing" && game.state.turn === theirSeat);
  const colour = theirs?.shirt ?? "#6cc8e0";
  setOpponentColor(colour);
  document.documentElement.style.setProperty("--their", colour);
}

/** Redraw both player bars. A newly kept coin for `awaiting` stays hidden until its flight lands. */
function updateBars(opts: { thinking?: boolean; awaiting?: Seat } = {}): void {
  const { scores, turn, status } = game.state;
  renderAvatars();
  showReactions(isOnline() && !!online && online.status !== "waiting" && !!online.players[0] && !!online.players[1]);
  bars.forEach((bar, i) => {
    const seat = i as Seat;
    bar.classList.toggle("active", status === "playing" && turn === seat);
    const info = isOnline() ? online?.players[seat] : null;
    const slot = bar.querySelector<HTMLElement>(".badge-slot")!;
    const chip = bar.querySelector<HTMLElement>(".rating-chip")!;
    const tierKey = info ? tierFor(info.rating).id : "";
    if (slot.dataset.tier !== tierKey) {
      slot.dataset.tier = tierKey;
      slot.replaceChildren(...(info ? [tierBadge(info.rating)] : []));
    }
    chip.textContent = info ? String(info.rating) : "";
    const dropped = isOnline() && online?.players[seat]?.connected === false;
    bar.querySelector(".name")!.textContent =
      name(seat) + (opts.thinking && seat === COMPUTER_SEAT ? " · thinking…" : "") + (dropped ? " · reconnecting…" : "");
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

// --- The tutorial table ----------------------------------------------------------
// Three guided shots on the real table: flick, keep one, mind the edge. Each step has a fixed
// layout and starts again if the shot doesn't do what it asks.

const tutorial = { step: 1 };
const TUTORIAL = [
  {
    title: "Flick",
    text: "Step 1: press the coin with the gold ring, drag back like a slingshot, and let go. The further you pull, the harder it flies.",
  },
  {
    title: "Keep one",
    text: "Step 2: hit the other coin with it. Touch exactly one coin and you keep it, then go again with the same coin. Touch two, or none, and your turn ends.",
  },
  {
    title: "Mind the edge",
    text: "Step 3: keep that coin near the edge without knocking anything off. Coins that fall off go to your opponent, so gently does it. Tea cups block the way, but you can bounce off them.",
  },
];
const tutorialLabel = () => `How to play · Step ${tutorial.step} of ${TUTORIAL.length}: ${TUTORIAL[tutorial.step - 1].title}`;

/** The table for a step: hand-placed coins, the shooting coin ringed in gold. */
function tutorialTable(step: number): GameState {
  const base = newGame(1, "easy", 0);
  const coin = (id: number, x: number, y: number) => ({ id, x, y, vx: 0, vy: 0 });
  const layouts: Pick<GameState, "coins" | "cups">[] = [
    { coins: [coin(0, 500, 640)], cups: [] },
    { coins: [coin(0, 500, 700), coin(1, 500, 470)], cups: [{ x: 300, y: 360 }] },
    // Close enough to the edge to matter, far enough that a medium flick keeps it on the table.
    { coins: [coin(0, 440, 500), coin(1, 390, 270)], cups: [{ x: 680, y: 380 }, { x: 250, y: 470 }] },
  ];
  return { ...base, ...layouts[step - 1], shooter: 0, turn: 0, scores: [0, 0] };
}

function tutorialAfterShot(outcome: Resolved["outcome"], token: number): void {
  const step = tutorial.step;
  const passed = step === 1 || (outcome.captured !== null && (step === 2 || outcome.fallen.length === 0));
  if (!passed) {
    const why =
      outcome.fallen.length > 0
        ? "That went off the edge. A little softer."
        : outcome.touched === 0
          ? "Didn't touch it. Aim at the other coin, and pull a little further if it stopped short."
          : "So close. Try again.";
    const again = TUTORIAL[step - 1].text.replace(/^Step \d: /, "");
    say(`${why} ${again[0].toUpperCase()}${again.slice(1)}`);
    window.setTimeout(() => token === gameToken && (game.load(tutorialTable(step)), updateBars(), (dirty = true)), 900);
    return;
  }
  toast(step === 1 ? "Nice flick!" : step === 2 ? "Clean hit! You keep it." : "Perfect!", true);
  window.setTimeout(() => {
    if (token !== gameToken) return;
    if (step === TUTORIAL.length) return finishTutorial();
    tutorial.step++;
    game.load(tutorialTable(tutorial.step));
    shownPips[0] = 0;
    bars[0].querySelector(".pips")!.replaceChildren();
    $("#game-label").textContent = tutorialLabel();
    updateBars();
    say(TUTORIAL[tutorial.step - 1].text);
    dirty = true;
  }, 1100);
}

function finishTutorial(): void {
  $("#result-title").textContent = "You're ready!";
  $("#result-score").textContent = "That's the whole game: flick, keep exactly one, and mind the edge.";
  $("#result-note").textContent = "Kenta, a barista on his break, is a friendly first opponent.";
  $("#result-rating").textContent = "";
  $("#result-tier").replaceChildren();
  $<HTMLButtonElement>("#rematch").textContent = "Play Kenta";
  result.hidden = false;
  sound.win();
  $<HTMLButtonElement>("#rematch").focus();
}

// --- The daily puzzle ------------------------------------------------------------

const daily = { n: 0, turn: 1 };
const DAILY_KEY = "zeni.daily";

/** Today's first finished result, if there is one. Later tries are practice. */
function dailyResult(): { n: number; kept: number } | null {
  try {
    const r = JSON.parse(localStorage.getItem(DAILY_KEY) ?? "null") as { n: number; kept: number } | null;
    return r && r.n === dailyNumber() ? r : null;
  } catch {
    return null;
  }
}
const dailyDone = () => dailyResult() !== null;
const dailyLabel = () => `Daily puzzle #${daily.n} · Turn ${daily.turn} of ${DAILY_TURNS}`;

/** After each shot: carry on, start the next of your turns, or finish. */
function dailyAfterShot(outcome: Resolved["outcome"], landed: Promise<void>, token: number): void {
  const kept = game.state.scores[0];
  const cleared = game.state.coins.length === 0 || game.state.status === "over";
  const turnEnded = !outcome.again;
  if (!cleared && !turnEnded) return say(`Kept ${kept} so far. Shoot again with the same coin.`);
  if (!cleared && daily.turn < DAILY_TURNS) {
    daily.turn++;
    // Your turn again: nobody else plays the daily puzzle.
    game.state = { ...game.state, turn: 0, shooter: null };
    $("#game-label").textContent = dailyLabel();
    updateBars();
    return say(`Kept ${kept} so far. Turn ${daily.turn} of ${DAILY_TURNS}: pick any coin.`);
  }
  game.state = { ...game.state, status: "over" };
  updateBars();
  say("That's your puzzle done.");
  void landed.then(() => setTimeout(() => token === gameToken && finishDaily(kept), 250));
}

function finishDaily(kept: number): void {
  const first = !dailyDone();
  if (first) {
    try {
      localStorage.setItem(DAILY_KEY, JSON.stringify({ n: daily.n, kept }));
    } catch {
      // Private mode: the result just isn't remembered.
    }
  }
  const today = dailyResult();
  $("#result-title").textContent = `Daily puzzle #${daily.n}`;
  $("#result-score").textContent = `You kept ${kept} of ${COIN_COUNT} coins`;
  $("#result-note").textContent = first
    ? "Same table for everyone today. A new one at midnight UTC."
    : `Practice. Today's result is ${today?.kept ?? kept}.`;
  $("#result-rating").textContent = "";
  $("#result-tier").replaceChildren();
  $<HTMLButtonElement>("#rematch").textContent = "Share";
  result.hidden = false;
  if (kept > 0) sound.win();
  $<HTMLButtonElement>("#rematch").focus();
}

/** Share today's result: the phone's share sheet, or copy it. */
async function shareDaily(): Promise<void> {
  const r = dailyResult();
  const text = shareLine(daily.n, r?.kept ?? game.state.scores[0]);
  const button = $<HTMLButtonElement>("#rematch");
  try {
    if (navigator.share) await navigator.share({ text });
    else {
      await navigator.clipboard.writeText(text);
      button.textContent = "Copied";
      setTimeout(() => (button.textContent = "Share"), 1500);
    }
  } catch {
    // Cancelled, or not allowed: nothing to do.
  }
}

// --- Toasts ------------------------------------------------------------------

const toastEl = $("#toast");
let toastTimer = 0;

/** A short note at the top of the table: "Clean hit!", "Off the table: Kenta takes it". */
function toast(text: string, good = false): void {
  window.clearTimeout(toastTimer);
  toastEl.textContent = text;
  toastEl.classList.toggle("good", good);
  // Restart the entrance animation.
  toastEl.hidden = true;
  void toastEl.offsetWidth;
  toastEl.hidden = false;
  toastTimer = window.setTimeout(() => (toastEl.hidden = true), 1800);
}

/** The toast for a shot, in a few words. */
function shotToast(shooter: Seat, outcome: Resolved["outcome"]): void {
  const them = other(shooter);
  const fell = outcome.fallen.length;
  const yourTurnNext = !outcome.again && youSeat() !== null && isYou(them);
  const tail = yourTurnNext ? " · Your turn" : "";
  if (outcome.captured !== null) return toast(`Clean hit!${outcome.again ? " Go again" : ""}`, true);
  if (fell > 0) {
    const taker = isYou(them) ? "you take" : `${name(them)} takes`;
    return toast(`Off the table: ${taker} ${fell === 1 ? "it" : "them"}${tail}`);
  }
  if (outcome.touched === 0) return toast(`Missed${tail}`);
  const count = ["", "", "Two", "Three", "Four"][outcome.touched] ?? String(outcome.touched);
  toast(`${count} coins touched${tail}`);
}

/** Fly a kept coin from the table into the player's tray. */
function flyToTray(kept: NonNullable<Resolved["kept"]>, seat: Seat): Promise<void> {
  const pip = bars[seat].querySelector<HTMLElement>(".pip.awaiting:last-child");
  if (!pip) return Promise.resolve();
  const from = view.toClient(kept.x, kept.y);
  const size = COIN_RADIUS * 2 * view.cssScale(kept.x, kept.y);
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

/** Start a game. `rematch` swaps who goes first; `nextRound` carries on a best-of-3 match. */
export function start(next: Setup, rematch = false, nextRound = false): void {
  if (nextRound) localMatch.round++;
  else Object.assign(localMatch, { round: 1, wins: [0, 0] });
  localMatch.counted = false;
  leaveRoom();
  setup = next;
  gameToken++;
  running = true;
  game.controlledSeat = null;
  game.awaitServer = false;
  firstPlayer = rematch ? other(firstPlayer) : (Math.random() < 0.5 ? 0 : 1);
  if (isTutorial()) {
    tutorial.step = 1;
    firstPlayer = 0;
    game.load(tutorialTable(1));
  } else if (isDaily()) {
    // Today's table, the same for everyone, and it's always your turn.
    daily.n = dailyNumber();
    daily.turn = 1;
    firstPlayer = 0;
    game.reset(dailySeed(daily.n), DAILY_TABLE, 0);
  } else {
    game.reset(nextSeed(), setup.difficulty, firstPlayer);
  }
  bars[1].hidden = solo();
  result.hidden = true;
  $<HTMLButtonElement>("#rematch").disabled = false;
  $<HTMLButtonElement>("#rematch").textContent = "Rematch";
  $("#result-rating").textContent = "";
  $("#result-tier").replaceChildren();
  shownPips[0] = shownPips[1] = 0;
  for (const bar of bars) bar.querySelector(".pips")!.replaceChildren();
  $("#game-label").textContent = isTutorial()
    ? tutorialLabel()
    : isDaily()
    ? dailyLabel()
    : `${vsComputer() ? `vs ${character().name} · ${LEVEL_NAMES[setup.opponent as AiLevel]}` : "Two players"} · ${setup.difficulty === "easy" ? "Easy table" : "Hard table"}` +
      roundLabel({ bestOf: setup.bestOf ?? 1, round: localMatch.round, wins: localMatch.wins });
  faces[0] = faces[1] = "neutral";
  updateBars();
  say(
    isTutorial()
      ? TUTORIAL[0].text
      : isDaily()
      ? `Keep as many coins as you can in ${DAILY_TURNS} turns. A clean hit lets you go again.${dailyDone() ? " (Practice: today's result is already in.)" : ""}`
      : `${goesFirst(game.state.turn)} Drag back from a coin and let go.`,
  );
  // The computer's character says hello (not on a rematch: once is enough).
  if (vsComputer() && !rematch && !nextRound) {
    const token = gameToken;
    window.setTimeout(() => token === gameToken && showBubble(bars[COMPUTER_SEAT], character().line, true, 4200), 350);
  }
  dirty = true;
  requestAnimationFrame(() => {
    if (view.resize()) dirty = true;
  });
  void playComputerTurn();
}

export function stop(): void {
  leaveRoom();
  running = false;
  gameToken++;
  game.cancelAim();
  result.hidden = true;
}

function showResult(): void {
  const { winner, scores } = game.state;
  const youWon = winner !== "draw" && isYou(winner as Seat);
  const nextFirst = other(firstPlayer);
  const goes = `${isYou(nextFirst) ? "you go" : `${name(nextFirst)} goes`} first`;
  const coins = vsComputer() ? `You ${scores[0]} – ${scores[1]} ${character().name}` : `Player 1 ${scores[0]} – ${scores[1]} Player 2`;

  // A best-of-3 carries on until someone has won two rounds. A drawn round doesn't count.
  let matchOver = true;
  if ((setup.bestOf ?? 1) === 3) {
    if (!localMatch.counted && winner !== "draw") localMatch.wins[winner as Seat]++;
    localMatch.counted = true;
    matchOver = localMatch.wins.some((w) => w >= 2);
  }
  nextIsRound = !matchOver;
  const [w0, w1] = localMatch.wins;
  const rounds = vsComputer() ? `Rounds: You ${w0} – ${w1} ${character().name}` : `Rounds: Player 1 ${w0} – ${w1} Player 2`;

  if ((setup.bestOf ?? 1) === 1) {
    $("#result-title").textContent = winner === "draw" ? "It's a draw" : youWon ? "You win!" : `${name(winner as Seat)} wins`;
    $("#result-score").textContent = coins;
    $("#result-note").textContent = `In the rematch, ${goes}.`;
  } else if (!matchOver) {
    $("#result-title").textContent =
      winner === "draw" ? `Round ${localMatch.round} is a draw` : youWon ? `You take round ${localMatch.round}` : `${name(winner as Seat)} takes round ${localMatch.round}`;
    $("#result-score").textContent = `${rounds} · this round ${coins}`;
    $("#result-note").textContent = `Next round: ${goes}.`;
  } else {
    const champ = (w0 > w1 ? 0 : 1) as Seat;
    $("#result-title").textContent = isYou(champ) ? "You win the match!" : `${name(champ)} wins the match`;
    $("#result-score").textContent = rounds;
    $("#result-note").textContent = `In a new match, ${goes}.`;
  }
  $<HTMLButtonElement>("#rematch").textContent = nextIsRound ? "Next round" : (setup.bestOf ?? 1) === 3 ? "New match" : "Rematch";
  result.hidden = false;
  if (vsComputer() && winner !== "draw") (youWon ? sound.win() : sound.lose());
  else sound.win();
  $<HTMLButtonElement>("#rematch").focus();
}

game.onFire = (shot) => sound.flick(shot.power);
game.onLocalShot = (shot, seq) => {
  if (isOnline()) online?.client.send({ t: "shot", seq, coinId: shot.coinId, angle: shot.angle, power: shot.power });
};
game.onSimEvents = (events) => sound.events(events);

game.onResolved = ({ shooter, outcome, kept }: Resolved) => {
  const token = gameToken;
  const them = other(shooter);
  // The scoreboard first, so a kept coin's place stays empty for its flight; faces after (they redraw too).
  updateBars({ awaiting: kept ? shooter : undefined });
  const landed = kept ? flyToTray(kept, shooter) : Promise.resolve();
  react(shooter, outcome.captured !== null ? "pleased" : "dismayed");
  if (game.state.status !== "over") shotToast(shooter, outcome);
  if (kept) {
    sound.keep();
    if (youSeat() === null || isYou(shooter)) navigator.vibrate?.(12);
  }

  if (isTutorial()) return tutorialAfterShot(outcome, token);
  if (isDaily()) return dailyAfterShot(outcome, landed, token);

  // Online, the server announces the end of the game (with ratings); show the card once the last shot has played.
  // Online, a best-of-3 round ended but the match goes on: the server starts the next round itself.
  if (isOnline() && online && !online.over && game.state.status === "over" && online.match.bestOf === 3) {
    const w = game.state.winner;
    const m = online.match;
    toast(w === "draw" ? "Drawn round" : isYou(w as Seat) ? `You take round ${m.round}` : `${name(w as Seat)} takes round ${m.round}`, w !== "draw" && isYou(w as Seat));
    say(`Rounds: you ${m.wins[online.seat]} – ${m.wins[other(online.seat)]} ${name(other(online.seat))}. The next round starts in a moment.`);
    return;
  }
  if (game.state.status === "over" || (isOnline() && online?.over)) {
    say("Game over.");
    void landed.then(() => setTimeout(() => token === gameToken && (isOnline() ? showOnlineResult() : showResult()), 250));
    return;
  }

  const fell = outcome.fallen.length;
  const fellText = fell === 1 ? "A coin fell off the table" : `${fell} coins fell off the table`;
  const handedOver = `${gets(them)} ${fell === 1 ? "it" : "them"}.`;
  if (outcome.again) {
    say(youSeat() === null || isYou(shooter)
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

$("#rematch").addEventListener("click", () => {
  if (isDaily()) return void shareDaily();
  if (isTutorial()) return start({ opponent: "beginner", difficulty: setup.difficulty }); // "Play Kenta"
  if (isOnline() && online) {
    online.rematch[online.seat] = true; // show it straight away; the server confirms
    online.client.send({ t: "rematch" });
    renderRematch();
  } else {
    start(setup, true, nextIsRound);
  }
});
$("#result-home").addEventListener("click", () => {
  stop();
  onExit();
});
function leaveGame(): void {
  const live = isOnline() ? online?.status === "playing" : game.state.status === "playing" && game.state.shots > 0;
  const warning = isOnline() ? "Leave this game? You'll forfeit it and lose rating." : "Leave this game? It won't be saved.";
  if (live && !confirm(warning)) return;
  if (isOnline() && online?.status === "playing") online.client.send({ t: "resign" });
  stop();
  onExit();
}
$("#leave").addEventListener("click", leaveGame);
$("#lobby-cancel").addEventListener("click", leaveGame);
function roomLink(): string {
  return `${location.origin}/r/${online?.code ?? ""}`;
}
$("#lobby-copy").addEventListener("click", async (e) => {
  const button = e.currentTarget as HTMLButtonElement;
  const label = button.textContent;
  try {
    await navigator.clipboard.writeText(roomLink());
    button.textContent = "Copied";
  } catch {
    button.textContent = "Copy failed";
  }
  setTimeout(() => (button.textContent = label), 1500);
});
$("#lobby-share").addEventListener("click", async () => {
  const code = online?.code ?? "";
  try {
    if (navigator.share) {
      await navigator.share({ title: "Zeni", text: `Play me at Zeni! Room ${code}`, url: roomLink() });
    } else {
      await navigator.clipboard.writeText(roomLink());
      $("#lobby-share").textContent = "Link copied";
      setTimeout(() => ($("#lobby-share").textContent = "Share"), 1500);
    }
  } catch {
    // The person closed the share sheet; nothing to do.
  }
});
$("#notice-home").addEventListener("click", () => {
  stop();
  onExit();
});


// --- Online rooms ---------------------------------------------------------

/** An empty round table, shown while waiting for an opponent. */
function emptyTable(difficulty: Difficulty): GameState {
  return { ...newGame(1, difficulty), coins: [] };
}

/** Join or create a room. `create` is the table to open a new room with, or null to join an existing one. */
export function startOnline(
  code: string,
  create: Difficulty | null,
  opts: { attempt?: number; quick?: boolean; challenge?: string; bestOf?: 1 | 3 } = {},
): void {
  const attempt = opts.attempt ?? 0;
  stop();
  const token = ++gameToken;
  running = true;
  setup = { opponent: "online", difficulty: create ?? "easy" };
  bars[1].hidden = false;
  game.physics = { ...DEFAULT_PHYSICS }; // both players must simulate with the same numbers
  game.controlledSeat = 0;
  game.awaitServer = true;
  game.load(emptyTable(setup.difficulty));
  result.hidden = true;
  notice.hidden = true;
  lobby.hidden = true;
  shownPips[0] = shownPips[1] = 0;
  for (const bar of bars) bar.querySelector(".pips")!.replaceChildren();
  $("#game-label").textContent = `Room ${code}`;

  const client = new RoomClient(code, create, {
    message: (m) => token === gameToken && onServer(m),
    link: (l) => token === gameToken && showLink(l),
    fatal: (reason) => {
      if (token !== gameToken) return;
      // Someone else already has this code: try another.
      if (reason === "room_exists" && create && attempt < 3) return startOnline(newRoomCode(), create, { attempt: attempt + 1, bestOf: opts.bestOf });
      showFatal(reason);
    },
  }, opts.bestOf ?? 1);
  online = { client, code, created: create, quick: !!opts.quick, match: { bestOf: opts.bestOf ?? 1, round: 1, wins: [0, 0] }, challenge: opts.challenge ?? null, seat: 0, players: [null, null], status: "waiting", over: null, rematch: [false, false] };
  say(create ? "Opening your room…" : "Joining…");
  updateBars();
  dirty = true;
  requestAnimationFrame(() => view.resize() && (dirty = true));
  history.replaceState(null, "", `/r/${code}`); // a reload rejoins the same room
  client.connect();
}

let noShowTimer = 0;

function leaveRoom(): void {
  window.clearTimeout(noShowTimer);
  if (!online) return;
  online.client.leave();
  online = null;
  deadlineAt = null;
  game.controlledSeat = null;
  game.awaitServer = false;
  lobby.hidden = true;
  notice.hidden = true;
  conn.hidden = true;
  if (location.pathname.startsWith("/r/")) history.replaceState(null, "", "/");
}

function showLink(l: Link): void {
  conn.hidden = l !== "reconnecting";
}

function showFatal(reason: Fatal | "no_show"): void {
  const copy: Record<string, [string, string]> = {
    no_room: ["Room not found", "Check the code with your friend. Rooms close after a while if nobody plays."],
    room_full: ["That room is full", "Two people are already playing in it."],
    unauthorized: ["Sign in again", "This device's player code isn't valid. Restore your player from the home screen."],
    signed_out: ["Sign in again", "This device has no player code. Create or restore your player from the home screen."],
    no_show: ["Your opponent didn't show up", "They may have lost connection. Try Quick Match again."],
    gave_up: ["Connection lost", "We couldn't get back in. If the game was still going, you may have forfeited it."],
  };
  const [title, text] = copy[reason] ?? ["Something went wrong", "Go back and try again."];
  $("#notice-title").textContent = title;
  $("#notice-text").textContent = text;
  lobby.hidden = true;
  notice.hidden = false;
  $<HTMLButtonElement>("#notice-home").focus();
}

/** "Room K7QXM · Easy table · Round 2 of 3 · 1–0" */
function onlineLabel(): void {
  const o = online;
  if (!o) return;
  $("#game-label").textContent = `Room ${o.code} · ${setup.difficulty === "easy" ? "Easy" : "Hard"} table${roundLabel(o.match, o.seat)}`;
}

function onServer(msg: ServerMsg): void {
  const o = online;
  if (!o) return;
  const resetPips = (state: GameState) => {
    shownPips[0] = state.scores[0];
    shownPips[1] = state.scores[1];
  };

  switch (msg.t) {
    case "welcome": {
      // Sent on joining and on every reconnect: adopt the server's picture of the room.
      o.seat = msg.you;
      o.players = msg.players;
      o.status = msg.room.status;
      o.over = msg.over;
      o.rematch = msg.rematch;
      game.controlledSeat = msg.you;
      setup.difficulty = msg.room.table;
      o.match = msg.room.match;
      onlineLabel();
      const state = msg.state ?? emptyTable(msg.room.table);
      game.load(state);
      resetPips(state);
      deadlineAt = msg.deadlineIn === null ? null : Date.now() + msg.deadlineIn;
      updateBars();
      window.clearTimeout(noShowTimer);
      // The code is only useful while there's a seat to fill; once both are taken, nobody needs it.
      lobby.hidden = msg.room.status !== "waiting" || o.quick || waitingForAbsentPlayer();
      if (msg.room.status === "waiting" && o.quick) {
        // The matchmaker found someone: they're just connecting. Give them a little while.
        sayWaiting();
        const token = gameToken;
        noShowTimer = window.setTimeout(() => token === gameToken && online?.status === "waiting" && showFatal("no_show"), 25_000);
      } else if (msg.room.status === "waiting") {
        fillLobby(o);
        sayWaiting();
      } else if (msg.over) {
        say("Game over.");
        showOnlineResult();
      } else if (msg.room.nextRoundIn !== null) {
        result.hidden = true;
        say("The next round starts in a moment.");
      } else {
        result.hidden = true;
        say(`${turnOf(state.turn)} Drag back from a coin and let go.`);
      }
      dirty = true;
      break;
    }
    case "players":
      o.players = msg.players;
      updateBars();
      if (o.status === "waiting") {
        // A friend arrived while we were waiting for them, or someone dropped before the game began.
        lobby.hidden = o.quick || waitingForAbsentPlayer();
        if (!lobby.hidden) fillLobby(o);
        sayWaiting();
      }
      break;
    case "start":
      window.clearTimeout(noShowTimer);
      o.match = msg.match;
      onlineLabel();
      o.status = "playing";
      o.over = null;
      o.rematch = [false, false];
      o.players = msg.players;
      game.load(msg.state);
      shownPips[0] = shownPips[1] = 0;
      for (const bar of bars) bar.querySelector(".pips")!.replaceChildren();
      deadlineAt = Date.now() + msg.deadlineIn;
      lobby.hidden = true;
      result.hidden = true;
      updateBars();
      say(`${msg.match.bestOf === 3 ? `Round ${msg.match.round}. ` : ""}${goesFirst(msg.state.turn)} Drag back from a coin and let go.`);
      dirty = true;
      break;
    case "round_over":
      // Shown when the last shot has finished playing (see onResolved).
      o.match = msg.match;
      break;
    case "shot": {
      deadlineAt = Date.now() + msg.deadlineIn;
      if (game.serverShot(msg) === "snapped") {
        resetPips(msg.state);
        updateBars();
        say(turnOf(msg.state.turn));
      }
      break;
    }
    case "turn":
      game.load(msg.state);
      resetPips(msg.state);
      deadlineAt = Date.now() + msg.deadlineIn;
      updateBars();
      say(`${name(msg.who)} ran out of time. ${turnOf(msg.state.turn)}`);
      dirty = true;
      break;
    case "over":
      o.status = "over";
      o.over = msg.over;
      deadlineAt = null;
      updateBars();
      if (!game.animating) showOnlineResult(); // otherwise the last shot's playback shows it when it ends
      break;
    case "aim":
      if (msg.by !== o.seat) game.setRemoteAim({ coinId: msg.coinId, angle: msg.angle, power: msg.power });
      dirty = true;
      break;
    case "aim_end":
      game.setRemoteAim(null);
      dirty = true;
      break;
    case "react":
      showBubble(bars[msg.by], REACTIONS[msg.r], true);
      break;
    case "rematch":
      o.rematch = msg.votes;
      renderRematch();
      break;
    case "error":
      // A rejected move is followed by a fresh snapshot, which puts the board right.
      break;
  }
}

/** Both players have a seat but one isn't connected, so the game is waiting for them to come back. */
function waitingForAbsentPlayer(): boolean {
  const o = online;
  return !!o && o.status === "waiting" && !!o.players[0] && !!o.players[1];
}

/** The waiting sheet: a code to share with a friend, or, for a challenge, who you're waiting for. */
function fillLobby(o: Online): void {
  $("#lobby-title").textContent = o.challenge ? `Waiting for ${o.challenge}` : "Waiting for a friend";
  $("#lobby-text").textContent = o.challenge
    ? "The game starts as soon as you're both here. If they're not on Zeni right now, they'll see it on their home screen."
    : "Send them this code or the link. The game starts as soon as they join.";
  $("#lobby-code").textContent = o.code;
  $("#lobby-code").hidden = $("#lobby-share-row").hidden = !!o.challenge;
}

function sayWaiting(): void {
  const o = online;
  if (!o) return;
  if (waitingForAbsentPlayer()) say(`Waiting for ${name(other(o.seat))} to come back…`);
  else if (o.quick) say("Opponent found. Waiting for them to connect…");
  else if (o.challenge) say(`Waiting for ${o.challenge} to join.`);
  else say("Waiting for a friend to join.");
}

/** The countdown in the active player's bar. */
function updateClock(): void {
  const live = isOnline() && online?.status === "playing" && deadlineAt !== null;
  const turn = game.state.turn;
  bars.forEach((bar, i) => {
    const el = bar.querySelector<HTMLElement>(".clock")!;
    if (!live || i !== turn) {
      if (el.textContent) el.textContent = "";
      el.classList.remove("urgent");
      return;
    }
    // The server's deadline includes the last shot's playback; the visible clock only starts once it ends.
    const secs = Math.min(TURN_MS / 1000, Math.ceil(Math.max(0, deadlineAt! - Date.now()) / 1000));
    const text = `0:${String(secs).padStart(2, "0")}`;
    if (el.textContent !== text) el.textContent = text;
    el.classList.toggle("urgent", secs <= 5);
  });
}

const REASONS = {
  resign: ["resigned.", "You resigned."],
  forfeit: ["disconnected.", "You were disconnected for too long."],
  timeout: ["ran out of time.", "You ran out of time."],
} as const;

function showOnlineResult(): void {
  const o = online;
  const over = o?.over;
  if (!o || !over) return;

  const youWon = over.winner === o.seat;
  const opponent = name(other(o.seat));
  if (over.wins) {
    $("#result-title").textContent = over.winner === "draw" ? "It's a draw" : youWon ? "You win the match!" : `${opponent} wins the match`;
    $("#result-score").textContent = `Rounds: you ${over.wins[o.seat]} – ${over.wins[other(o.seat)]} ${opponent}`;
  } else {
    $("#result-title").textContent = over.winner === "draw" ? "It's a draw" : youWon ? "You win!" : `${opponent} wins`;
    $("#result-score").textContent = `You ${over.scores[o.seat]} – ${over.scores[other(o.seat)]} ${opponent}`;
  }

  resultReason = over.reason === "normal" ? "" : youWon ? `${opponent} ${REASONS[over.reason][0]}` : REASONS[over.reason][1];
  const r = over.ratings;
  const change = r ? r.after[o.seat] - r.before[o.seat] : 0;
  $("#result-rating").textContent = r
    ? `Rating ${r.before[o.seat]} → ${r.after[o.seat]} (${change >= 0 ? "+" : "−"}${Math.abs(change)})`
    : "";

  const tier = $("#result-tier");
  tier.className = "";
  tier.replaceChildren();
  if (r) {
    const move = tierChange(r.before[o.seat], r.after[o.seat]);
    if (move !== "same") {
      const now = tierFor(r.after[o.seat]);
      tier.className = move === "down" ? "down" : "";
      tier.append(tierBadge(r.after[o.seat], "large"), document.createTextNode(move === "up" ? `Promoted to ${now.name}!` : `Moved down to ${now.name}`));
    }
  }

  renderRematch();
  if (result.hidden) {
    result.hidden = false;
    if (over.winner === "draw" || youWon) sound.win();
    else sound.lose();
  }
  $<HTMLButtonElement>("#rematch").focus();
}

function renderRematch(): void {
  const o = online;
  if (!o) return;
  const button = $<HTMLButtonElement>("#rematch");
  const mine = o.rematch[o.seat];
  const theirs = o.rematch[other(o.seat)];
  const opponent = name(other(o.seat));
  button.disabled = mine;
  button.textContent = mine ? "Waiting…" : theirs ? "Accept rematch" : "Rematch";
  const hint = mine ? `Waiting for ${opponent} to accept.` : theirs ? `${opponent} wants a rematch.` : "";
  $("#result-note").textContent = [resultReason, hint].filter(Boolean).join("\n");
}

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

onReact((r) => {
  if (!online) return;
  online.client.send({ t: "react", r });
  showBubble(bars[online.seat], REACTIONS[r], false);
});

// --- Input ----------------------------------------------------------------

let aimingPointer: number | null = null;

/** Online: let the other player watch you aim. */
const sharesAim = () => isOnline() && online?.status === "playing";
const aimSender = new AimThrottle(
  (a) => online?.client.send({ t: "aim", seq: game.state.shots, coinId: a.coinId, angle: a.angle, power: a.power }),
  AIM_SEND_MS,
);
function shareAim(): void {
  if (sharesAim() && game.aim) aimSender.update({ coinId: game.aim.coinId, angle: game.aim.angle, power: game.aim.power });
}

// Events are on the board's container, so they reach whichever view is showing.
wrap.addEventListener("pointerdown", (e) => {
  if (e.target === viewToggle) return;
  sound.unlock();
  if (aimingPointer !== null) return;
  const mayAim = !isComputerTurn() && !(isOnline() && !online?.client.open);
  const p = view.toBoard(e.clientX, e.clientY);
  // Press a coin to aim; press anywhere else to turn the table (in 3D).
  if (!mayAim || !p || !game.startAim(p)) {
    if (view.beginTurn(e)) view.element.style.cursor = "grabbing";
    return;
  }
  aimingPointer = e.pointerId;
  try {
    view.element.setPointerCapture(e.pointerId);
  } catch {
    // Synthetic or already-released pointers can't be captured; aiming still works.
  }
  view.element.style.cursor = "grabbing";
  shareAim();
  dirty = true;
});

wrap.addEventListener("pointermove", (e) => {
  const p = view.toBoard(e.clientX, e.clientY);
  if (e.pointerId === aimingPointer) {
    if (!p) return; // pointing past the horizon: keep the last aim
    game.moveAim(p);
    shareAim();
    dirty = true;
  } else if (e.pointerType === "mouse" && aimingPointer === null && !view.moving()) {
    view.element.style.cursor = !isComputerTurn() && p && game.coinAt(p) ? "grab" : "default";
  }
});
wrap.addEventListener("pointerup", () => {
  if (aimingPointer === null) view.element.style.cursor = "default";
});

function endAim(e: PointerEvent, fire: boolean): void {
  if (e.pointerId !== aimingPointer) return;
  aimingPointer = null;
  view.element.style.cursor = "default";
  const seq = game.state.shots;
  if (fire) game.releaseAim();
  else game.cancelAim();
  aimSender.stop();
  // A shot ends the aim on its own; letting go without shooting needs saying.
  if (sharesAim() && !game.animating) online?.client.send({ t: "aim_end", seq });
  dirty = true;
}

wrap.addEventListener("pointerup", (e) => endAim(e, true));
wrap.addEventListener("pointercancel", (e) => endAim(e, false));

// --- The 3D table ---------------------------------------------------------

let table3d: Table3D | null = null;
let placeId: PlaceId = "kitchen";

/** Where the 3D table stands. Remembered until the next call; applied when the 3D view loads. */
export function setPlace(id: PlaceId): void {
  placeId = id;
  table3d?.setPlace(id);
  dirty = true;
}

/** Swap in the 3D table once it has loaded. Stays flat if this device can't show 3D. */
export async function load3D(): Promise<void> {
  if (table3d) return;
  try {
    const { Table3D } = await import("./game/table-3d");
    const t = new Table3D(wrap);
    t.setPlace(placeId);
    view.dispose();
    canvas.hidden = true;
    table3d = t;
    view = t;
    view.resize();
    updateBars(); // tells the new view who sits across the table
    viewToggle.hidden = false;
    renderViewToggle();
    dirty = true;
  } catch (e) {
    console.warn("Staying with the flat table:", e);
  }
}

function renderViewToggle(): void {
  const top = table3d?.topDown ?? false;
  viewToggle.textContent = top ? "Tilt" : "Top view";
  viewToggle.setAttribute("aria-pressed", String(top));
  viewToggle.setAttribute("aria-label", top ? "Tilt the table" : "Look straight down");
}

viewToggle.addEventListener("click", () => {
  if (!table3d) return;
  table3d.setTopDown(!table3d.topDown);
  renderViewToggle();
  dirty = true;
});

// --- Loop -----------------------------------------------------------------

new ResizeObserver(() => {
  if (view.resize()) dirty = true;
}).observe(wrap);

let last = performance.now();
let lastClock = 0;
function frame(now: number): void {
  const moving = game.update((now - last) / 1000, now);
  last = now;
  if (now - lastClock > 200) {
    lastClock = now;
    updateClock();
  }
  if (running && (moving || dirty || view.moving())) {
    view.draw(game, now);
    dirty = false;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
