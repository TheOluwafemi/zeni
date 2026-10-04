import { describe, expect, test } from "vitest";
import { isSessionId, MAX_TRACKED, ONLINE_WINDOW_MS, PresenceBook } from "./presence-core";

const T0 = 1_000_000;
const id = (n: number) => `tab-${String(n).padStart(8, "0")}`;

describe("PresenceBook", () => {
  test("counts each open tab once, however often it pings", () => {
    const book = new PresenceBook();
    book.ping(id(1), T0);
    book.ping(id(1), T0 + 30_000);
    expect(book.ping(id(2), T0 + 31_000).online).toBe(2);
  });

  test("a tab that says goodbye stops counting at once, so a refresh isn't a second visitor", () => {
    const book = new PresenceBook();
    book.ping(id(1), T0);
    book.leave(id(1));
    book.leave("not a session"); // ignored
    expect(book.ping(id(2), T0 + 1_000).online).toBe(1);
  });

  test("forgets a tab that stops pinging", () => {
    const book = new PresenceBook();
    book.ping(id(1), T0);
    book.ping(id(2), T0 + 60_000);
    expect(book.info(T0 + ONLINE_WINDOW_MS + 10_000).online).toBe(1); // tab 1 went quiet
    expect(book.info(T0 + 60_000 + ONLINE_WINDOW_MS + 10_000).online).toBe(0);
  });

  test("reports how many are searching on each table", () => {
    const book = new PresenceBook();
    book.setSearching("easy", 2);
    book.setSearching("hard", 1);
    expect(book.ping(id(1), T0)).toEqual({ online: 1, searching: { easy: 2, hard: 1 } });
    book.setSearching("easy", -3); // nonsense is clamped
    expect(book.info(T0).searching.easy).toBe(0);
  });

  test("ignores malformed ids, but still answers", () => {
    const book = new PresenceBook();
    for (const bad of [undefined, null, 42, "", "short", "has spaces in it", "x".repeat(41), "<script>alert(1)</script>"]) {
      expect(book.ping(bad, T0).online).toBe(0);
    }
    expect(isSessionId("3f2b9c1e-7d4a-4e8b-9a6f-0c1d2e3f4a5b")).toBe(true);
  });

  test("stops tracking new ids past the ceiling, but keeps counting known ones", () => {
    const book = new PresenceBook();
    for (let i = 0; i < MAX_TRACKED; i++) book.ping(id(i), T0);
    expect(book.ping(id(MAX_TRACKED + 1), T0).online).toBe(MAX_TRACKED);
    expect(book.ping(id(5), T0 + 1000).online).toBe(MAX_TRACKED);
  });
});
