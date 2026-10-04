import { describe, expect, test } from "vitest";
import { describePresence } from "./presence-text";

const info = (online: number, easy: number, hard: number) => ({ online, searching: { easy, hard } });

describe("describePresence", () => {
  test("invites the player to bring a friend when nobody else is around", () => {
    expect(describePresence(info(1, 0, 0), "easy")).toMatch(/^Quiet right now/);
    expect(describePresence(info(0, 0, 0), "hard")).toMatch(/^Quiet right now/);
  });

  test("counts people online, and those searching on the chosen table", () => {
    expect(describePresence(info(5, 0, 0), "easy")).toBe("5 online");
    expect(describePresence(info(5, 2, 0), "easy")).toBe("5 online · 2 looking for a game");
  });

  test("points to the other table when that's where someone is waiting", () => {
    expect(describePresence(info(3, 0, 1), "easy")).toBe("3 online · 1 looking for a game on the Hard table");
    expect(describePresence(info(3, 1, 0), "hard")).toBe("3 online · 1 looking for a game on the Easy table");
  });

  test("prefers the chosen table when both have people waiting", () => {
    expect(describePresence(info(8, 1, 3), "easy")).toBe("8 online · 1 looking for a game");
  });
});
