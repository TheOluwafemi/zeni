import { expect, test } from "vitest";
import { GAME_NAME, PROTOCOL_VERSION } from "./constants";

test("shared constants load", () => {
  expect(GAME_NAME).toBe("Zeni");
  expect(PROTOCOL_VERSION).toBeGreaterThan(0);
});
