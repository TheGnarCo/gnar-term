/**
 * Debounced persistence scheduler. Successive `schedulePersist()` calls
 * collapse into a single trailing call after `delayMs` of quiet. `flush()`
 * cancels any pending timer and runs `fn` immediately — used from app
 * shutdown hooks so pending writes don't get dropped. `cancel()` clears
 * the timer without invoking `fn` — used by test resets that don't want
 * the in-memory state flushed to disk.
 */
export interface PersistScheduler {
  schedulePersist: () => void;
  flush: () => Promise<void>;
  cancel: () => void;
}

export function makePersistScheduler(
  fn: () => Promise<void>,
  delayMs: number,
): PersistScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    schedulePersist(): void {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void fn();
      }, delayMs);
    },
    async flush(): Promise<void> {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await fn();
    },
    cancel(): void {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
