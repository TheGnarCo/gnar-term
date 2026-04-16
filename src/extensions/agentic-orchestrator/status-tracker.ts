/**
 * Status tracker for detected AI agents.
 *
 * Supports two modes based on agent detection capabilities:
 *
 * - "osc" mode: 3 states (running, waiting, idle) — for agents like
 *   Claude Code that emit OSC notifications for status changes.
 *   Output sets "running", OSC sets "waiting", timeout sets "idle".
 *
 * - "title-only" mode: 2 states (active, idle) — for agents detected
 *   only by title pattern. Output sets "active", timeout sets "idle".
 *   onNotification() is a no-op.
 */

export type TrackerMode = "osc" | "title-only";

export type HarnessStatus = "running" | "waiting" | "idle" | "active";

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

/** Title patterns that indicate the agent is actively working. */
const RUNNING_PATTERNS = ["thinking", "working"];

/** Title patterns that indicate the agent is done / idle. */
const IDLE_PATTERNS = ["ready", "done"];

function matchesAny(text: string, patterns: string[]): boolean {
  const lower = text.toLowerCase();
  return patterns.some((p) => lower.includes(p));
}

export function createStatusTracker(
  idleTimeoutMs: number,
  onStatusChange: (status: HarnessStatus) => void,
  mode: TrackerMode = "osc",
): StatusTracker {
  const initialStatus: HarnessStatus = "idle";
  let status: HarnessStatus = initialStatus;
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
      if (mode === "osc") {
        setStatus("running");
      } else {
        setStatus("active");
      }
      resetIdleTimer();
    },

    onNotification(_text: string): void {
      if (mode !== "osc") return;
      setStatus("waiting");
      // Clear idle timer — waiting is an explicit state, not time-based
      if (idleTimer !== undefined) {
        clearTimeout(idleTimer);
        idleTimer = undefined;
      }
    },

    onTitleChange(title: string): void {
      if (matchesAny(title, RUNNING_PATTERNS)) {
        if (mode === "osc") {
          setStatus("running");
        } else {
          setStatus("active");
        }
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
