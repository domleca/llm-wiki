import { describe, expect, it, vi } from "vitest";
import {
  Scheduler,
  isRunDue,
  mostRecentScheduledTick,
} from "../../src/runtime/scheduler.js";

// Helper: build a local-time millisecond timestamp.
const at = (
  y: number,
  m: number,
  d: number,
  h: number,
  min = 0,
): number => new Date(y, m - 1, d, h, min, 0, 0).getTime();

describe("mostRecentScheduledTick", () => {
  it("returns today's tick when now is past the scheduled hour", () => {
    const now = at(2026, 4, 7, 9, 30);
    expect(mostRecentScheduledTick(now, 2)).toBe(at(2026, 4, 7, 2));
  });

  it("returns yesterday's tick when now is before the scheduled hour", () => {
    const now = at(2026, 4, 7, 1, 30);
    expect(mostRecentScheduledTick(now, 2)).toBe(at(2026, 4, 6, 2));
  });

  it("returns today's tick exactly at the scheduled hour", () => {
    const now = at(2026, 4, 7, 2, 0);
    expect(mostRecentScheduledTick(now, 2)).toBe(at(2026, 4, 7, 2));
  });
});

describe("isRunDue", () => {
  it("is due when there is no recorded last run", () => {
    expect(isRunDue(at(2026, 4, 7, 9), null, 2)).toBe(true);
  });

  it("is due when last run was before the most recent tick", () => {
    const now = at(2026, 4, 7, 9);
    const lastRun = new Date(at(2026, 4, 6, 23)).toISOString();
    expect(isRunDue(now, lastRun, 2)).toBe(true);
  });

  it("is not due when last run was after the most recent tick", () => {
    const now = at(2026, 4, 7, 9);
    const lastRun = new Date(at(2026, 4, 7, 3)).toISOString();
    expect(isRunDue(now, lastRun, 2)).toBe(false);
  });

  it("catches up a missed run from days ago", () => {
    const now = at(2026, 4, 7, 9);
    const lastRun = new Date(at(2026, 4, 1, 2, 30)).toISOString();
    expect(isRunDue(now, lastRun, 2)).toBe(true);
  });

  it("treats a malformed ISO string as 'never run'", () => {
    expect(isRunDue(at(2026, 4, 7, 9), "not-a-date", 2)).toBe(true);
  });
});

describe("Scheduler", () => {
  function makeHarness(opts: {
    now: number;
    lastRunIso: string | null;
    running?: boolean;
  }): {
    trigger: ReturnType<typeof vi.fn>;
    setIntervalFn: ReturnType<typeof vi.fn>;
    clearIntervalFn: ReturnType<typeof vi.fn>;
    scheduler: Scheduler;
  } {
    const trigger = vi.fn();
    const setIntervalFn = vi.fn((): unknown => "handle");
    const clearIntervalFn = vi.fn();
    const scheduler = new Scheduler({
      hour: 2,
      getLastRunIso: () => opts.lastRunIso,
      isExtractionRunning: () => opts.running ?? false,
      trigger,
      now: () => opts.now,
      setInterval: setIntervalFn,
      clearInterval: clearIntervalFn,
    });
    return { trigger, setIntervalFn, clearIntervalFn, scheduler };
  }

  it("triggers immediately on start when a run is due", () => {
    const h = makeHarness({ now: at(2026, 4, 7, 9), lastRunIso: null });
    h.scheduler.start();
    expect(h.trigger).toHaveBeenCalledOnce();
    expect(h.setIntervalFn).toHaveBeenCalledOnce();
  });

  it("does not trigger on start when not due", () => {
    const lastRun = new Date(at(2026, 4, 7, 3)).toISOString();
    const h = makeHarness({ now: at(2026, 4, 7, 9), lastRunIso: lastRun });
    h.scheduler.start();
    expect(h.trigger).not.toHaveBeenCalled();
  });

  it("does not trigger if extraction is already running", () => {
    const h = makeHarness({
      now: at(2026, 4, 7, 9),
      lastRunIso: null,
      running: true,
    });
    h.scheduler.start();
    expect(h.trigger).not.toHaveBeenCalled();
  });

  it("stop() clears the interval and is idempotent", () => {
    const h = makeHarness({
      now: at(2026, 4, 7, 9),
      lastRunIso: new Date(at(2026, 4, 7, 3)).toISOString(),
    });
    h.scheduler.start();
    h.scheduler.stop();
    h.scheduler.stop();
    expect(h.clearIntervalFn).toHaveBeenCalledOnce();
  });

  it("start() is idempotent", () => {
    const h = makeHarness({
      now: at(2026, 4, 7, 9),
      lastRunIso: new Date(at(2026, 4, 7, 3)).toISOString(),
    });
    h.scheduler.start();
    h.scheduler.start();
    expect(h.setIntervalFn).toHaveBeenCalledOnce();
  });
});
