// Pure helpers for player codes and nicknames. No Cloudflare APIs, so they run in tests.

// Crockford base32: no I, L, O or U, so a code read aloud or typed by hand is hard to get wrong.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 16; // 16 × 5 bits = 80 bits of randomness

/** A fresh random player code, 16 characters. */
export function newCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  // 256 is a multiple of 32, so masking to 5 bits keeps every character equally likely.
  return Array.from(bytes, (b) => ALPHABET[b & 31]).join("");
}

/** `ABCD1234EFGH5678` → `ZENI-ABCD-1234-EFGH-5678`. */
export function formatCode(code: string): string {
  return `ZENI-${code.match(/.{4}/g)!.join("-")}`;
}

/** Accepts pasted codes with or without the prefix, dashes, spaces or odd case. Null if it can't be a code. */
export function normalizeCode(input: string): string | null {
  let s = input.toUpperCase().replace(/[\s-]/g, "");
  if (s.startsWith("ZENI")) s = s.slice(4); // no real code can start with ZENI: there is no I in the alphabet
  s = s.replace(/O/g, "0").replace(/[IL]/g, "1"); // Crockford's forgiving reads
  return /^[0-9A-HJKMNP-TV-Z]{16}$/.test(s) ? s : null;
}

/** What goes in the database. A fast hash is fine: the code is random, not a human-chosen password. */
export async function hashCode(normalized: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export type NicknameProblem = "length" | "characters" | "reserved" | "blocked";

const RESERVED = new Set(["zeni", "admin", "administrator", "moderator", "support", "system", "computer", "you", "player1", "player2", "bot", "guest", "null", "undefined"]);

// A small starter list of strongly offensive terms, matched after folding look-alike characters.
// Long, unambiguous terms are blocked anywhere in a name. Short ones hide inside innocent words
// ("Scunthorpe"), so they only block when they are the whole name. Curate as reports come in.
const BLOCKED_ANYWHERE = ["fuck", "nigg", "fagg", "hitler", "whore", "rapist"];
const BLOCKED_EXACT = new Set(["shit", "cunt", "slut", "nazi"]);

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b" };

export function validateNickname(nickname: string): { ok: true } | { ok: false; reason: NicknameProblem } {
  if (nickname.length < 3 || nickname.length > 16) return { ok: false, reason: "length" };
  // Letters, digits and underscore only: also blocks look-alike letters such as "Kénji".
  if (!/^[A-Za-z0-9_]+$/.test(nickname)) return { ok: false, reason: "characters" };
  const lower = nickname.toLowerCase();
  if (RESERVED.has(lower)) return { ok: false, reason: "reserved" };
  const folded = lower.replace(/_/g, "").replace(/[01345 78]/g, (c) => LEET[c] ?? c);
  if (BLOCKED_EXACT.has(folded) || BLOCKED_ANYWHERE.some((w) => folded.includes(w))) return { ok: false, reason: "blocked" };
  return { ok: true };
}
