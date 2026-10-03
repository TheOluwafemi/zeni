// Room codes are 5 characters from the same unambiguous alphabet as player codes.
// 32^5 is about 33 million codes, plenty for rooms that live for minutes.

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const ROOM_CODE_LENGTH = 5;

export function newRoomCode(): string {
  const bytes = new Uint8Array(ROOM_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b & 31]).join("");
}

/** Accepts any case, and reads O as 0 and I or L as 1. Null if it can't be a room code. */
export function normalizeRoomCode(input: string): string | null {
  const s = input.trim().toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1");
  return /^[0-9A-HJKMNP-TV-Z]{5}$/.test(s) ? s : null;
}
