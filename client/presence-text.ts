// Wording for the presence line. Kept apart from presence.ts (which uses browser APIs) so it can be tested in Node.

import { DIFFICULTIES, TABLE_NAMES, type Difficulty } from "../shared/constants";

export interface PresenceInfo {
  online: number;
  searching: Record<Difficulty, number>;
}

/** The line shown on Home, phrased for the table the player has chosen. */
export function describePresence(info: PresenceInfo, table: Difficulty): string {
  const here = info.searching[table] ?? 0;
  // Elsewhere, name the busiest other table.
  const other = DIFFICULTIES.filter((t) => t !== table).reduce((a, b) => ((info.searching[b] ?? 0) > (info.searching[a] ?? 0) ? b : a));
  const there = info.searching[other] ?? 0;
  if (info.online <= 1 && here + there === 0) return "Quiet right now. Send a friend a room link, or try Quick Match later.";
  const parts = [`${info.online} online`];
  if (here > 0) parts.push(`${here} looking for a game`);
  else if (there > 0) parts.push(`${there} looking for a game on the ${TABLE_NAMES[other]} table`);
  return parts.join(" · ");
}
