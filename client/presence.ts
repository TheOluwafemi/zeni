// "3 online · 1 looking for a game". Pings every 30 seconds while the app is visible, with a random
// id made fresh for this tab and never stored, so the count can't be tied to anyone.

import type { PresenceInfo } from "./presence-text";

export { describePresence, type PresenceInfo } from "./presence-text";

const PING_MS = 30_000;
const session = crypto.randomUUID();
let latest: PresenceInfo | null = null;
let listener: (info: PresenceInfo) => void = () => {};

async function ping(): Promise<void> {
  if (document.visibilityState === "hidden") return;
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

export function startPresence(onUpdate: (info: PresenceInfo) => void): void {
  listener = onUpdate;
  void ping();
  window.setInterval(() => void ping(), PING_MS);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && void ping());
}

/** Refresh soon, for example right after joining or leaving the queue. */
export function pingSoon(): void {
  window.setTimeout(() => void ping(), 600);
}

export const latestPresence = (): PresenceInfo | null => latest;
