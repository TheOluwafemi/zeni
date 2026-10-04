import { expect, test } from "vitest";
import { ActivityClock, IDLE_MS } from "./activity-clock";

test("someone is active until they've done nothing for a while", () => {
  const c = new ActivityClock(0);
  expect(c.active(IDLE_MS)).toBe(true);
  expect(c.active(IDLE_MS + 1)).toBe(false);
  c.touch(IDLE_MS + 10);
  expect(c.active(IDLE_MS + 20)).toBe(true);
});

test("coming back after being idle is announced once; ordinary activity isn't", () => {
  const c = new ActivityClock(0);
  let returns = 0;
  c.onReturn(() => returns++);
  c.touch(1000);
  c.touch(2000);
  expect(returns).toBe(0);
  c.touch(2000 + IDLE_MS + 1);
  expect(returns).toBe(1);
  c.touch(2000 + IDLE_MS + 500);
  expect(returns).toBe(1);
});

test("the page becoming visible again refreshes straight away", () => {
  const c = new ActivityClock(0);
  let returns = 0;
  c.onReturn(() => returns++);
  c.shown(1000);
  expect(returns).toBe(1);
  expect(c.active(1000 + IDLE_MS)).toBe(true);
});
