/**
 * Nightly extraction scheduler.
 *
 * Pure logic: given the current time, the last successful run, and the
 * configured hour-of-day, decide whether a run is due. The runtime wrapper
 * polls this on a `setInterval` — see Section 12 decision #3 of the spec
 * ("simple setInterval loop checking now >= nextRun works well enough").
 *
 * Missed-run catch-up (machine off at the scheduled hour) falls out for free:
 * we compare against the *most recent* scheduled tick, not the next one. If
 * the machine wakes up at 09:00 and the schedule is 02:00, the 02:00 tick is
 * still in the past, so we run.
 */

/** Interval at which the scheduler re-checks whether a run is due. */
export const SCHEDULER_POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * The most recent scheduled tick at or before `now`. If `now` is past today's
 * scheduled hour, that's today; otherwise yesterday.
 */
export function mostRecentScheduledTick(nowMs: number, hour: number): number {
  const d = new Date(nowMs);
  const todayTick = new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    hour,
    0,
    0,
    0,
  ).getTime();
  if (nowMs >= todayTick) return todayTick;
  // Subtract 24h. DST shifts mean this can be off by an hour, but the next
  // poll will correct it — we're not doing astronomy here.
  return todayTick - 24 * 60 * 60 * 1000;
}

/** True iff a nightly run is due given last run and configured hour. */
export function isRunDue(
  nowMs: number,
  lastRunIso: string | null,
  hour: number,
): boolean {
  if (lastRunIso == null) return true;
  const lastRunMs = Date.parse(lastRunIso);
  if (Number.isNaN(lastRunMs)) return true;
  return lastRunMs < mostRecentScheduledTick(nowMs, hour);
}

export interface SchedulerOptions {
  /** Hour of day (0–23) at which extraction should fire. */
  hour: number;
  /** Returns the last successful run ISO string (or null if never). */
  getLastRunIso: () => string | null;
  /** Returns true if extraction is currently running — skip if so. */
  isExtractionRunning: () => boolean;
  /** Triggers an extraction. The scheduler does not await it. */
  trigger: () => void;
  /** Injection seam for tests. Defaults to `Date.now`. */
  now?: () => number;
  /** Injection seam for tests. Defaults to `setInterval`/`clearInterval`. */
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  /** Override poll interval (defaults to SCHEDULER_POLL_INTERVAL_MS). */
  pollIntervalMs?: number;
}

export class Scheduler {
  private handle: unknown = null;
  private readonly opts: Required<
    Omit<SchedulerOptions, "setInterval" | "clearInterval" | "pollIntervalMs">
  > & {
    setInterval: NonNullable<SchedulerOptions["setInterval"]>;
    clearInterval: NonNullable<SchedulerOptions["clearInterval"]>;
    pollIntervalMs: number;
  };

  constructor(options: SchedulerOptions) {
    this.opts = {
      hour: options.hour,
      getLastRunIso: options.getLastRunIso,
      isExtractionRunning: options.isExtractionRunning,
      trigger: options.trigger,
      now: options.now ?? ((): number => Date.now()),
      setInterval:
        options.setInterval ??
        ((fn, ms): unknown => globalThis.setInterval(fn, ms)),
      clearInterval:
        options.clearInterval ??
        ((handle): void => {
          globalThis.clearInterval(handle as ReturnType<typeof setInterval>);
        }),
      pollIntervalMs: options.pollIntervalMs ?? SCHEDULER_POLL_INTERVAL_MS,
    };
  }

  /** Start polling. Also performs an immediate check (catch-up after start). */
  start(): void {
    if (this.handle !== null) return;
    this.check();
    this.handle = this.opts.setInterval(
      () => this.check(),
      this.opts.pollIntervalMs,
    );
  }

  stop(): void {
    if (this.handle === null) return;
    this.opts.clearInterval(this.handle);
    this.handle = null;
  }

  /** Public for tests — run a single tick of the check loop. */
  check(): void {
    if (this.opts.isExtractionRunning()) return;
    if (!isRunDue(this.opts.now(), this.opts.getLastRunIso(), this.opts.hour)) {
      return;
    }
    this.opts.trigger();
  }
}
