/**
 * createPoller — shared lifecycle scaffold for interval-driven polling
 * services. Encapsulates the `_timer` + `_inFlight` re-entrancy guard +
 * `start`/`stop` boilerplate that every poller in this codebase has been
 * hand-rolling identically.
 *
 * Usage:
 *
 *   const poller = createPoller({
 *     intervalMs: 60_000,
 *     tick: async () => { ...do work... },
 *   });
 *   const dispose = poller.start();  // kicks an immediate tick + sets interval
 *   ...
 *   dispose();  // or poller.stop()
 *
 * Contract:
 *   - `start()` is idempotent: calling it again clears the prior timer.
 *   - `immediate !== false` (the default) means the first tick fires
 *     synchronously on `start()`; pass `immediate: false` to skip it.
 *   - The `_inFlight` guard prevents overlapping ticks when `tick` is
 *     slower than `intervalMs`. The second concurrent tick is a no-op,
 *     not queued. This is the right semantic for "freshness pollers":
 *     stale work shouldn't pile up.
 *   - `stop()` clears the timer but does NOT interrupt an in-flight
 *     tick — the promise resolves on its own; only the next interval
 *     firing is cancelled.
 *
 * Why a helper instead of inlining:
 *   Pr-state, branch-commits, and dirty-status pollers all duplicated
 *   this 30-line scaffold. The shape was identical; only the tick body
 *   differed. Sharing the lifecycle removes drift risk and makes future
 *   additions (jittered backoff, telemetry, pause-on-blur) one-touch.
 */

export interface PollerHandle {
  /**
   * Start the timer. Idempotent — clears any prior interval first.
   * Returns a `stop` thunk for ergonomic teardown in `onDestroy`.
   */
  start(): () => void;
  /** Stop the timer. Safe to call when already stopped. */
  stop(): void;
}

export interface CreatePollerOptions {
  intervalMs: number;
  tick: () => Promise<void>;
  /** Fire one tick on `start()`. Defaults to `true`. */
  immediate?: boolean;
  /**
   * Optional handler for thrown errors / rejected ticks. Defaults to
   * `console.warn`. Always provided so the timer can't be killed by an
   * unhandled rejection.
   */
  onError?: (err: unknown) => void;
}

export function createPoller(options: CreatePollerOptions): PollerHandle {
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;
  const onError =
    options.onError ?? ((err: unknown) => console.warn("[poller]", err));

  const guardedTick = async (): Promise<void> => {
    if (inFlight) return;
    inFlight = true;
    try {
      await options.tick();
    } catch (err) {
      onError(err);
    } finally {
      inFlight = false;
    }
  };

  const stop = (): void => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  const start = (): (() => void) => {
    stop();
    if (options.immediate !== false) void guardedTick();
    timer = setInterval(() => void guardedTick(), options.intervalMs);
    return stop;
  };

  return { start, stop };
}
