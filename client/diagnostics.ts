// Crash reporting and anonymous usage pings. Both are best-effort: they never block the game, never
// throw, and send nothing that identifies a person.

export const BUILD: string = __BUILD__;

let screen = "home";

/** Where the player is, attached to crash reports and feedback ("home", "game:computer", "game:online"...). */
export function setScreen(next: string): void {
  screen = next;
}
export const currentScreen = (): string => screen;

// --- Crashes -------------------------------------------------------------------

/** A handful per visit is plenty to diagnose a problem, and stops a loop from flooding the server. */
const MAX_REPORTS = 5;
const sent = new Set<string>();

/** Browser noise that says nothing about our code. */
const IGNORED = [/ResizeObserver loop/i, /^Script error\.?$/i, /Non-Error promise rejection/i];

export function reportError(message: string, stack?: string): void {
  if (!message || sent.size >= MAX_REPORTS || IGNORED.some((re) => re.test(message))) return;
  const key = `${message}|${(stack ?? "").split("\n")[1] ?? ""}`;
  if (sent.has(key)) return;
  sent.add(key);
  try {
    void fetch("/api/log", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, stack, screen, version: BUILD }),
      keepalive: true, // still gets sent if the page is closing
    }).catch(() => {});
  } catch {
    // Reporting a problem must never cause one.
  }
}

export function installErrorReporting(): void {
  window.addEventListener("error", (e) => {
    // Errors from browser extensions and other sites' scripts aren't ours.
    if (e.filename && !e.filename.startsWith(location.origin)) return;
    reportError(e.message, e.error instanceof Error ? e.error.stack : undefined);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason;
    reportError(reason instanceof Error ? reason.message : String(reason), reason instanceof Error ? reason.stack : undefined);
  });
}

// --- Anonymous counts ----------------------------------------------------------

/** Tell the server something happened, with no identifier at all. The server only accepts known names. */
export function ping(name: "open" | "computer_game"): void {
  try {
    void fetch("/api/event", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Counting is optional.
  }
}

/** Count an app open once per browsing session, not on every reload. */
export function pingOpenOnce(): void {
  try {
    if (sessionStorage.getItem("zeni.opened")) return;
    sessionStorage.setItem("zeni.opened", "1");
  } catch {
    // No session storage: count it anyway, once per page load.
  }
  ping("open");
}
