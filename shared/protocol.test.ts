import { describe, expect, test } from "vitest";
import { MAX_MESSAGE_BYTES, parseClientMsg } from "./protocol";
import { newRoomCode, normalizeRoomCode } from "./room-code";

describe("parseClientMsg", () => {
  test("accepts each well-formed message", () => {
    expect(parseClientMsg('{"t":"hello","code":"ZENI-X"}')).toEqual({ t: "hello", code: "ZENI-X", create: undefined });
    expect(parseClientMsg('{"t":"hello","code":"x","create":"hard"}')).toMatchObject({ create: "hard" });
    expect(parseClientMsg('{"t":"shot","seq":3,"coinId":4,"angle":-1.5,"power":0.7}')).toEqual({ t: "shot", seq: 3, coinId: 4, angle: -1.5, power: 0.7 });
    expect(parseClientMsg('{"t":"resign"}')).toEqual({ t: "resign" });
    expect(parseClientMsg('{"t":"rematch"}')).toEqual({ t: "rematch" });
  });

  test("rejects junk, wrong types and oversized messages", () => {
    for (const bad of [
      "", "not json", "null", "[]", '"hello"', "42", '{"t":"nope"}', '{"t":"hello"}', '{"t":"hello","code":5}',
      '{"t":"hello","code":"x","create":"medium"}', '{"t":"shot","seq":"1","coinId":0,"angle":0,"power":1}',
      '{"t":"shot","seq":1.5,"coinId":0,"angle":0,"power":1}', '{"t":"shot","seq":1,"coinId":0,"angle":null,"power":1}',
      '{"t":"shot","seq":1,"coinId":0,"angle":0}', "x".repeat(MAX_MESSAGE_BYTES + 1),
    ]) {
      expect(parseClientMsg(bad)).toBeNull();
    }
    expect(parseClientMsg(new ArrayBuffer(4))).toBeNull(); // binary frames
  });

  test("a shot with NaN or Infinity can't be written as JSON, so can't arrive", () => {
    expect(JSON.stringify({ a: NaN, b: Infinity })).toBe('{"a":null,"b":null}');
    expect(parseClientMsg('{"t":"shot","seq":0,"coinId":0,"angle":null,"power":null}')).toBeNull();
  });
});

describe("room codes", () => {
  test("are 5 unambiguous characters and normalise forgivingly", () => {
    for (let i = 0; i < 100; i++) expect(newRoomCode()).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}$/);
    expect(normalizeRoomCode(" k7qxm ")).toBe("K7QXM");
    expect(normalizeRoomCode("O1LIO")).toBe("01110");
    for (const bad of ["", "K7QX", "K7QXMM", "K7QX!", "UUUUU"]) expect(normalizeRoomCode(bad)).toBeNull();
  });
});
