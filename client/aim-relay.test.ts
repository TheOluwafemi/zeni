import { describe, expect, test } from "vitest";
import { AimThrottle, aimSettled, approachAim, type AimUpdate, type Clock } from "./aim-relay";

function fakeClock() {
  let t = 0;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let next = 0;
  const clock: Clock = {
    now: () => t,
    later: (fn, ms) => {
      timers.push({ at: t + ms, fn, id: ++next });
      return next;
    },
    cancel: (id) => {
      const i = timers.findIndex((x) => x.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
  };
  const advance = (ms: number) => {
    t += ms;
    for (const due of timers.filter((x) => x.at <= t)) {
      timers.splice(timers.indexOf(due), 1);
      due.fn();
    }
  };
  return { clock, advance };
}

const aim = (angle: number, power = 0.5, coinId = 3): AimUpdate => ({ coinId, angle, power });

describe("sending your aim", () => {
  test("the first update goes straight away, then at most one per gap", () => {
    const { clock, advance } = fakeClock();
    const sent: AimUpdate[] = [];
    const t = new AimThrottle((a) => sent.push(a), 125, clock);
    t.update(aim(0));
    for (let i = 1; i <= 10; i++) {
      advance(10);
      t.update(aim(i));
    }
    expect(sent.map((a) => a.angle)).toEqual([0]);
    advance(25); // 125ms after the first send
    expect(sent.map((a) => a.angle)).toEqual([0, 10]); // the latest, not every one in between
  });

  test("the last position is sent even if the finger stops moving", () => {
    const { clock, advance } = fakeClock();
    const sent: AimUpdate[] = [];
    const t = new AimThrottle((a) => sent.push(a), 125, clock);
    t.update(aim(0));
    advance(20);
    t.update(aim(1));
    advance(500);
    expect(sent.map((a) => a.angle)).toEqual([0, 1]);
  });

  test("stopping drops anything still waiting to be sent", () => {
    const { clock, advance } = fakeClock();
    const sent: AimUpdate[] = [];
    const t = new AimThrottle((a) => sent.push(a), 125, clock);
    t.update(aim(0));
    advance(20);
    t.update(aim(1));
    t.stop();
    advance(500);
    expect(sent.map((a) => a.angle)).toEqual([0]);
  });
});

describe("showing their aim", () => {
  test("moves smoothly toward each update and gets most of the way within one update's gap", () => {
    let shown = approachAim(null, aim(0, 0), 0);
    const target = aim(1, 1);
    for (let i = 0; i < 8; i++) shown = approachAim(shown, target, 1 / 60); // ~133ms of frames
    expect(shown.angle).toBeGreaterThan(0.85);
    expect(shown.angle).toBeLessThan(1);
    expect(shown.power).toBeGreaterThan(0.85);
  });

  test("turns the short way round", () => {
    const shown = approachAim(aim(3.1), aim(-3.1), 1 / 60); // across the ±π seam
    expect(Math.abs(shown.angle)).toBeGreaterThan(3.1);
  });

  test("switching to another coin jumps straight there", () => {
    expect(approachAim(aim(0, 0, 1), aim(2, 0.8, 5), 1 / 60)).toEqual(aim(2, 0.8, 5));
  });

  test("knows when it has caught up", () => {
    expect(aimSettled(aim(1), aim(1.001))).toBe(true);
    expect(aimSettled(aim(1), aim(1.1))).toBe(false);
  });
});
