import { describe, expect, test } from "vitest";
import { CHARACTERS, HAIR_STYLES, lookFromSeed, lookSeed, PATTERNS, SHIRT_COLORS } from "../shared/avatar";
import { avatarSvg } from "./avatar-svg";

describe("generated looks", () => {
  test("the same player always looks the same", () => {
    expect(lookFromSeed(lookSeed("player-123"))).toEqual(lookFromSeed(lookSeed("player-123")));
  });

  test("players look different from each other, across every option", () => {
    const looks = Array.from({ length: 400 }, (_, i) => lookFromSeed(lookSeed(`p${i}`)));
    expect(new Set(looks.map((l) => JSON.stringify(l))).size).toBeGreaterThan(390);
    expect(new Set(looks.map((l) => l.hair))).toEqual(new Set(HAIR_STYLES));
    expect(new Set(looks.map((l) => l.pattern))).toEqual(new Set(PATTERNS));
    expect(new Set(looks.map((l) => l.shirt))).toEqual(new Set(SHIRT_COLORS));
    expect(looks.some((l) => l.glasses) && looks.some((l) => !l.glasses)).toBe(true);
  });

  test("the seed is a 32-bit number, not the id", () => {
    const seed = lookSeed("6d10485e-0abc-4587-ae61-b7a92bb40cf5");
    expect(Number.isInteger(seed) && seed >= 0 && seed < 2 ** 32).toBe(true);
  });
});

describe("drawing", () => {
  test("every character and expression draws a complete SVG", () => {
    for (const c of Object.values(CHARACTERS)) {
      for (const e of ["neutral", "pleased", "dismayed"] as const) {
        const svg = avatarSvg(c.look, e);
        expect(svg.startsWith("<svg")).toBe(true);
        expect(svg.endsWith("</svg>")).toBe(true);
        expect(svg).toContain(c.look.shirt);
      }
    }
  });

  test("expressions differ", () => {
    const look = CHARACTERS.beginner.look;
    const strip = (s: string) => s.replace(/av\d+/g, "");
    const faces = ["neutral", "pleased", "dismayed"].map((e) => strip(avatarSvg(look, e as "neutral")));
    expect(new Set(faces).size).toBe(3);
  });

  test("two avatars on one page don't share pattern ids", () => {
    const a = avatarSvg(CHARACTERS.skilled.look);
    const b = avatarSvg(CHARACTERS.skilled.look);
    expect(a.match(/id="(av\d+)c"/)![1]).not.toBe(b.match(/id="(av\d+)c"/)![1]);
  });
});
