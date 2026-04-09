/**
 * Harness Status Detection — three-layer status inference for harness surfaces.
 *
 * Priority: OSC 9 (notification) > Title parsing > Process state (idle timeout).
 */

import type { AgentStatus, HarnessSurface, TerminalSurface } from "./types";

// --- Layer 2: Title Pattern Matching ---

const TITLE_PATTERNS: Array<{ pattern: RegExp; status: AgentStatus }> = [
  { pattern: /thinking/i, status: "running" },
  { pattern: /working/i, status: "running" },
  { pattern: /starting/i, status: "running" },
  { pattern: /waiting/i, status: "waiting" },
  { pattern: /^ready$/i, status: "idle" },
];

/**
 * Parse agent status from a terminal title string.
 * Returns the matched status or null if no pattern matches.
 */
export function parseStatusFromTitle(title: string): AgentStatus | null {
  if (!title) return null;
  for (const { pattern, status } of TITLE_PATTERNS) {
    if (pattern.test(title)) return status;
  }
  return null;
}

// --- Status Tracker ---

export interface HarnessStatusTrackerOptions {
  idleThresholdMs: number;
  onChange?: (ptyId: number, status: AgentStatus) => void;
}

export interface HarnessStatusTracker {
  register(surface: HarnessSurface): void;
  registerTerminal(surface: TerminalSurface): void;
  unregister(ptyId: number): void;
  handleNotification(ptyId: number, text: string): void;
  handleTitle(ptyId: number, title: string): void;
  handleOutput(ptyId: number): void;
  handleExit(ptyId: number, exitCode: number): void;
  isTracked(ptyId: number): boolean;
  dispose(): void;
}

interface TrackedHarness {
  surface: HarnessSurface | TerminalSurface;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

export function createHarnessStatusTracker(
  options: HarnessStatusTrackerOptions,
): HarnessStatusTracker {
  const tracked = new Map<number, TrackedHarness>();

  function getStatus(entry: TrackedHarness): AgentStatus {
    return entry.surface.kind === "harness"
      ? entry.surface.status
      : entry.surface.agentStatus || "idle";
  }

  function writeStatus(entry: TrackedHarness, status: AgentStatus) {
    if (entry.surface.kind === "harness") {
      entry.surface.status = status;
    } else {
      entry.surface.agentStatus = status;
    }
  }

  function setStatus(ptyId: number, newStatus: AgentStatus) {
    const entry = tracked.get(ptyId);
    if (!entry) return;
    const oldStatus = getStatus(entry);
    if (oldStatus === newStatus) return;
    writeStatus(entry, newStatus);
    options.onChange?.(ptyId, newStatus);
  }

  function clearIdleTimer(entry: TrackedHarness) {
    if (entry.idleTimer !== null) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }
  }

  function startIdleTimer(ptyId: number) {
    const entry = tracked.get(ptyId);
    if (!entry) return;
    clearIdleTimer(entry);
    entry.idleTimer = setTimeout(() => {
      // Only revert to idle if status hasn't been set by a higher-priority layer
      // (Layer 3 is lowest priority, so we only set idle if still active)
      const current = getStatus(entry);
      if (current === "running" || current === "waiting") {
        setStatus(ptyId, "idle");
      }
    }, options.idleThresholdMs);
  }

  return {
    register(surface: HarnessSurface) {
      tracked.set(surface.ptyId, { surface, idleTimer: null });
    },

    registerTerminal(surface: TerminalSurface) {
      if (tracked.has(surface.ptyId)) return;
      surface.agentStatus = "running";
      tracked.set(surface.ptyId, { surface, idleTimer: null });
    },

    isTracked(ptyId: number) {
      return tracked.has(ptyId);
    },

    unregister(ptyId: number) {
      const entry = tracked.get(ptyId);
      if (entry) {
        clearIdleTimer(entry);
        tracked.delete(ptyId);
      }
    },

    // Layer 1: OSC 9 notification — highest priority
    handleNotification(ptyId: number, _text: string) {
      if (!tracked.has(ptyId)) return;
      setStatus(ptyId, "waiting");
    },

    // Layer 2: Title parsing
    handleTitle(ptyId: number, title: string) {
      if (!tracked.has(ptyId)) return;
      const status = parseStatusFromTitle(title);
      if (status) {
        setStatus(ptyId, status);
      }
    },

    // Layer 3: Process output — track activity, set idle after threshold
    handleOutput(ptyId: number) {
      if (!tracked.has(ptyId)) return;
      startIdleTimer(ptyId);
    },

    // Exit handling — terminal event
    handleExit(ptyId: number, exitCode: number) {
      if (!tracked.has(ptyId)) return;
      const entry = tracked.get(ptyId)!;
      clearIdleTimer(entry);
      setStatus(ptyId, exitCode === 0 ? "exited" : "error");
    },

    dispose() {
      for (const entry of tracked.values()) {
        clearIdleTimer(entry);
      }
      tracked.clear();
    },
  };
}
