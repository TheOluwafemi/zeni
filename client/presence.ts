// "3 online · 1 looking for a game". Pings every minute while someone is using the app (not when
// it's hidden or idle), with a random id made fresh for this tab and never stored, so the count
// can't be tied to anyone. The server counts a tab as online for 90 seconds after its last ping.

import { inUse, onReturn } from "./activity";
import type { PresenceInfo } from "./presence-text";

export { describePresence, type PresenceInfo } from "./presence-text";

const PING_MS = 60_000;
const session = crypto.randomUUID();
let latest: PresenceInfo | null = null;
let listener: (info: PresenceInfo) => void = () => {};

async function ping(force = false): Promise<void> {
  if (!force && !inUse()) return;
  try {
    const res = await fetch("/api/presence", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session }),
    });
    if (!res.ok) return;
    latest = (await res.json()) as PresenceInfo;
    listener(latest);
  } catch {
    // Offline: keep showing the last count, or nothing.
  }
}

/** Say goodbye as the page goes away, so refreshing doesn't count as another person arriving. */
function leave(): void {
  const body = new Blob([JSON.stringify({ session, leaving: true })], { type: "application/json" });
  navigator.sendBeacon?.("/api/presence", body);
}

export function startPresence(onUpdate: (info: PresenceInfo) => void): void {
  listener = onUpdate;
  window.addEventListener("pagehide", leave);
  void ping();
  window.setInterval(() => void ping(), PING_MS);
  onReturn(() => void ping(true));
}

/** Refresh soon, for example right after joining or leaving the queue. */
export function pingSoon(): void {
  window.setTimeout(() => void ping(true), 600);
}

export const latestPresence = (): PresenceInfo | null => latest;
