/**
 * Status tracker for AI agent harness surfaces.
 *
 * Tracks three states based on PTY activity:
 * - "running" — recent output received or title indicates active work
 * - "waiting" — OSC notification received (agent awaiting user input)
 * - "idle" — no output for the configured timeout, or title indicates done
 */

export type HarnessStatus = "running" | "waiting" | "idle";

export interface StatusTracker {
  getStatus(): HarnessStatus;
  /** Call when PTY output is received. */
  onOutput(): void;
  /** Call when an OSC notification is received from the PTY. */
  onNotification(text: string): void;
  /** Call when the PTY title changes. */
  onTitleChange(title: string): void;
  /** Clean up timers. Must be called on component destroy. */
  destroy(): void;
}

/** Title patterns that indicate the harness is actively working. */
const RUNNING_PATTERNS = ["thinking", "working"];

/** Title patterns that indicate the harness is done / idle. */
const IDLE_PATTERNS = ["ready", "done"];

function matchesAny(text: string, patterns: string[]): boolean {
  const lower = text.toLowerCase();
  return patterns.some((p) => lower.includes(p));
}

export function createStatusTracker(
  idleTimeoutMs: number,
  onStatusChange: (status: HarnessStatus) => void,
): StatusTracker {
  let status: HarnessStatus = "idle";
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  function setStatus(next: HarnessStatus): void {
    if (next !== status) {
      status = next;
      onStatusChange(status);
    }
  }

  function resetIdleTimer(): void {
    if (idleTimer !== undefined) {
      clearTimeout(idleTimer);
    }
    idleTimer = setTimeout(() => {
      setStatus("idle");
    }, idleTimeoutMs);
  }

  return {
    getStatus(): HarnessStatus {
      return status;
    },

    onOutput(): void {
      setStatus("running");
      resetIdleTimer();
    },

    onNotification(_text: string): void {
      setStatus("waiting");
      // Clear idle timer — waiting is an explicit state, not time-based
      if (idleTimer !== undefined) {
        clearTimeout(idleTimer);
        idleTimer = undefined;
      }
    },

    onTitleChange(title: string): void {
      if (matchesAny(title, RUNNING_PATTERNS)) {
        setStatus("running");
        resetIdleTimer();
      } else if (matchesAny(title, IDLE_PATTERNS)) {
        if (idleTimer !== undefined) {
          clearTimeout(idleTimer);
          idleTimer = undefined;
        }
        setStatus("idle");
      }
    },

    destroy(): void {
      if (idleTimer !== undefined) {
        clearTimeout(idleTimer);
        idleTimer = undefined;
      }
    },
  };
}
