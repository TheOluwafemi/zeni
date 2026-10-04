// Preset reactions in online games: the buttons, and the speech bubble by whoever sent one.

import { REACT_GAP_MS, REACTIONS, type ReactionId } from "../shared/reactions";

const strips = [...document.querySelectorAll<HTMLElement>(".reactions")];
const BUBBLE_MS = 2600;

let send: (r: ReactionId) => void = () => {};
let coolingUntil = 0;

for (const strip of strips) {
  for (const [id, label] of Object.entries(REACTIONS) as [ReactionId, string][]) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.textContent = label;
    if (id === "clap") b.setAttribute("aria-label", "Applause");
    b.addEventListener("click", () => {
      if (Date.now() < coolingUntil) return;
      coolingUntil = Date.now() + REACT_GAP_MS;
      setDisabled(true);
      window.setTimeout(() => setDisabled(false), REACT_GAP_MS);
      send(id);
    });
    strip.append(b);
  }
}

function setDisabled(disabled: boolean): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>(".reactions button")) b.disabled = disabled;
}

/** Where a sent reaction goes. */
export function onReact(fn: (r: ReactionId) => void): void {
  send = fn;
}

/** Show or hide the buttons (online, once both players are there). */
export function showReactions(visible: boolean): void {
  for (const strip of strips) strip.hidden = !visible;
}

const bubbles = new Map<Element, { el: HTMLElement; timer: number }>();

/** A speech bubble beside a player's bar. Drawn above everything, so it shows over the result card too. */
export function showBubble(bar: HTMLElement, r: ReactionId, theirs: boolean): void {
  bubbles.get(bar)?.el.remove();
  window.clearTimeout(bubbles.get(bar)?.timer);
  const el = document.createElement("div");
  el.className = `bubble${theirs ? " theirs" : ""}`;
  el.setAttribute("role", "status");
  el.textContent = REACTIONS[r];
  const rect = bar.getBoundingClientRect();
  const above = rect.top > window.innerHeight / 2; // the bottom bar's bubble sits above it, the top bar's below
  el.style.left = `${Math.max(12, rect.left + 18)}px`;
  if (above) el.style.bottom = `${window.innerHeight - rect.top + 8}px`;
  else el.style.top = `${rect.bottom + 8}px`;
  el.classList.add(above ? "up" : "down");
  document.body.append(el);
  const timer = window.setTimeout(() => {
    el.remove();
    bubbles.delete(bar);
  }, BUBBLE_MS);
  bubbles.set(bar, { el, timer });
}
