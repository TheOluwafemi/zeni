import { describe, expect, test } from "vitest";
import { formatCode, hashCode, newCode, normalizeCode, validateNickname } from "./auth";

describe("player codes", () => {
  test("are 16 characters from the Crockford alphabet and differ each time", () => {
    const codes = new Set(Array.from({ length: 200 }, newCode));
    expect(codes.size).toBe(200);
    for (const c of codes) expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/);
  });

  test("format and normalize round-trip", () => {
    const code = newCode();
    const shown = formatCode(code);
    expect(shown).toMatch(/^ZENI-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(normalizeCode(shown)).toBe(code);
  });

  test("forgives pasted variations", () => {
    const code = "7KQ4M2XP9HTA3WCE";
    for (const v of ["ZENI-7KQ4-M2XP-9HTA-3WCE", "zeni-7kq4-m2xp-9hta-3wce", "  7KQ4 M2XP 9HTA 3WCE ", "7KQ4M2XP9HTA3WCE"]) {
      expect(normalizeCode(v)).toBe(code);
    }
    // Crockford's look-alikes: O reads as 0, I and L read as 1.
    expect(normalizeCode("OOOOOOOOOOOOOOOO")).toBe("0000000000000000");
    expect(normalizeCode("ILILILILILILILIL")).toBe("1111111111111111");
  });

  test("rejects things that can't be a code", () => {
    for (const bad of ["", "ZENI-", "TOO-SHORT", "7KQ4M2XP9HTA3WC", "7KQ4M2XP9HTA3WCEE", "7KQ4M2XP9HTA3WC!", "UUUUUUUUUUUUUUUU"]) {
      expect(normalizeCode(bad)).toBeNull();
    }
  });

  test("hashes are stable, hex, and not the code", async () => {
    const h = await hashCode("7KQ4M2XP9HTA3WCE");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashCode("7KQ4M2XP9HTA3WCE")).toBe(h);
    expect(await hashCode("7KQ4M2XP9HTA3WCF")).not.toBe(h);
  });
});

describe("validateNickname", () => {
  test.each(["Ada", "kenji_99", "A1B2C3D4E5F6G7H8", "___"])("accepts %s", (n) => {
    expect(validateNickname(n)).toEqual({ ok: true });
  });

  test("rejects bad lengths, characters, reserved and blocked names", () => {
    expect(validateNickname("ab")).toEqual({ ok: false, reason: "length" });
    expect(validateNickname("A".repeat(17))).toEqual({ ok: false, reason: "length" });
    expect(validateNickname("Kénji")).toEqual({ ok: false, reason: "characters" });
    expect(validateNickname("has space")).toEqual({ ok: false, reason: "characters" });
    expect(validateNickname("名前です")).toEqual({ ok: false, reason: "characters" });
    expect(validateNickname("Admin")).toEqual({ ok: false, reason: "reserved" });
    expect(validateNickname("ZENI")).toEqual({ ok: false, reason: "reserved" });
    expect(validateNickname("hitler")).toEqual({ ok: false, reason: "blocked" });
    expect(validateNickname("h1tl3r")).toEqual({ ok: false, reason: "blocked" });
    expect(validateNickname("n_a_z_i")).toEqual({ ok: false, reason: "blocked" });
  });

  test("doesn't block innocent names that merely contain a short word", () => {
    for (const n of ["Scunthorpe", "Dickens", "Cocktail", "Assassin", "Shiitake"]) {
      expect(validateNickname(n)).toEqual({ ok: true });
    }
  });
});
