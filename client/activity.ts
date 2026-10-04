// Is someone actually using the page? Background polling (who's online, challenges) pauses after a
// few minutes without a tap, click or key, and refreshes as soon as they're back. A tab left open
// on Home all day would otherwise make thousands of requests, and the free Workers plan allows
// 100,000 a day for everyone together.

import { ActivityClock } from "./activity-clock";

export { IDLE_MS } from "./activity-clock";

const clock = new ActivityClock(Date.now());
let wired = false;

function wire(): void {
  if (wired || typeof window === "undefined") return;
  wired = true;
  const touch = () => clock.touch(Date.now());
  for (const type of ["pointerdown", "keydown", "wheel", "touchstart"]) window.addEventListener(type, touch, { passive: true });
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && clock.shown(Date.now()));
}

/** Worth polling now: the page is visible and someone has used it recently. */
export function inUse(): boolean {
  wire();
  return document.visibilityState !== "hidden" && clock.active(Date.now());
}

/** Run `fn` when someone comes back after being idle (to refresh what's on screen straight away). */
export function onReturn(fn: () => void): void {
  wire();
  clock.onReturn(fn);
}
