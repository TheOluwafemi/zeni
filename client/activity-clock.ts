// How long since someone used the page, without any browser APIs, so it can be tested in Node.

/** No input for this long counts as idle. */
export const IDLE_MS = 5 * 60_000;

/** The pure part, so it can be tested without a browser. */
export class ActivityClock {
  private last: number;
  private readonly returned = new Set<() => void>();

  constructor(now: number) {
    this.last = now;
  }

  /** Someone did something. If they'd been idle, tell whoever is waiting for their return. */
  touch(now: number): void {
    const wasIdle = now - this.last > IDLE_MS;
    this.last = now;
    if (wasIdle) for (const fn of this.returned) fn();
  }

  /** The page became visible again: refresh straight away, whether or not they'd been idle. */
  shown(now: number): void {
    this.last = now;
    for (const fn of this.returned) fn();
  }

  active(now: number): boolean {
    return now - this.last <= IDLE_MS;
  }

  onReturn(fn: () => void): void {
    this.returned.add(fn);
  }
}
