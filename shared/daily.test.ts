import { expect, test } from "vitest";
import { dailyNumber, dailySeed, shareLine } from "./daily";
import { newGame } from "./rules";

test("puzzles are numbered by day, changing at midnight UTC", () => {
  expect(dailyNumber(Date.UTC(2026, 9, 1, 0, 0))).toBe(1);
  expect(dailyNumber(Date.UTC(2026, 9, 1, 23, 59))).toBe(1);
  expect(dailyNumber(Date.UTC(2026, 9, 4, 12))).toBe(4);
});

test("everyone gets the same table on the same day, and a different one the next", () => {
  expect(newGame(dailySeed(4), "easy", 0)).toEqual(newGame(dailySeed(4), "easy", 0));
  expect(newGame(dailySeed(5), "easy", 0).coins).not.toEqual(newGame(dailySeed(4), "easy", 0).coins);
});

test("the share line shows the score and a coin for each one kept", () => {
  expect(shareLine(27, 5, 14)).toBe("Zeni #27 · 5/14 🪙🪙🪙🪙🪙");
  expect(shareLine(3, 0, 14)).toBe("Zeni #3 · 0/14 —");
});
