/**
 * OSC Notification Service
 *
 * Parses OSC 9, OSC 9;4, OSC 99, and OSC 777 sequences from PTY output
 * chunks and emits typed OscNotification events.
 *
 * Design:
 * - parseOscNotification(paneId, chunk) -- pure parser, no side effects.
 * - feedPaneOutput(paneId, chunk) -- feeds chunk into the shared store.
 * - oscNotificationStore -- Readable<OscNotification[]>, ring-buffered to 200.
 *
 * Malformed sequences are silently dropped (no throw, no log).
 * This service does NOT modify agent-detection-service.ts.
 */

import { writable, type Readable } from "svelte/store";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type OscNotificationKind = "notify" | "progress" | "complete" | "error";

export interface OscNotification {
  paneId: string;
  kind: OscNotificationKind;
  title?: string;
  body?: string;
  level?: "info" | "warn" | "error";
  /** 0-100, only present for kind: 'progress' */
  progress?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RING_CAP = 200;

/**
 * Matches any OSC sequence with BEL (\x07) or ST (\x1b\\) terminator.
 * Group 1 = the content between ESC ] and the terminator.
 * Non-greedy so multiple sequences in one chunk are all captured.
 */
const OSC_RE = /\x1b\]([\s\S]*?)(?:\x07|\x1b\\)/g;

// ---------------------------------------------------------------------------
// Store (internal writable, exposed as Readable)
// ---------------------------------------------------------------------------

const _store = writable<OscNotification[]>([]);

export const oscNotificationStore: Readable<OscNotification[]> = {
  subscribe: _store.subscribe,
};

/** Reset store to empty - for use in tests only. */
export function resetOscNotificationStoreForTests(): void {
  _store.set([]);
}

// ---------------------------------------------------------------------------
// Parser helpers
// ---------------------------------------------------------------------------

/** Clamp a number to [0, 100]. */
function clampProgress(n: number): number {
  return Math.min(100, Math.max(0, n));
}

const VALID_KINDS = new Set<string>([
  "notify",
  "progress",
  "complete",
  "error",
]);
const VALID_LEVELS = new Set<string>(["info", "warn", "error"]);

/**
 * Parse OSC 99 (and the cmux-semantic: body from OSC 9) key=value payload.
 * Format: key=value[;key=value...]
 * Returns null if parsing fails or the kind is unrecognised.
 */
function parseCmuxSemantic(
  paneId: string,
  payload: string,
): OscNotification | null {
  const pairs = payload.split(";");
  const kv: Record<string, string> = {};
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const key = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (key) kv[key] = value;
  }

  const kind = kv["kind"];
  if (!kind || !VALID_KINDS.has(kind)) return null;

  const notification: OscNotification = {
    paneId,
    kind: kind as OscNotificationKind,
  };

  if (kv["title"] !== undefined) notification.title = kv["title"];
  if (kv["body"] !== undefined) notification.body = kv["body"];
  if (kv["level"] && VALID_LEVELS.has(kv["level"])) {
    notification.level = kv["level"] as "info" | "warn" | "error";
  }

  return notification;
}

/**
 * Parse a single OSC content string (the part between ESC ] and terminator).
 * Returns null on any parse failure.
 */
function parseOscContent(
  paneId: string,
  content: string,
): OscNotification | null {
  // OSC 9;4 - progress (must be tested before OSC 9 since it starts with '9;4').
  // Intercept anything starting with '9;4' (with or without trailing ';state') so
  // a bare '9;4' is treated as malformed OSC 9;4 rather than an OSC 9 body of '4'.
  if (content === "9;4" || content.startsWith("9;4;")) {
    if (!content.startsWith("9;4;")) return null; // bare '9;4' = malformed, drop
    const rest = content.slice(4); // everything after '9;4;'
    const parts = rest.split(";");
    if (parts.length < 1) return null;

    const state = parseInt(parts[0] ?? "", 10);
    if (isNaN(state)) return null;

    // State 0 = clear -> no event
    if (state === 0) return null;

    const rawProgress = parts.length >= 2 ? parseInt(parts[1] ?? "", 10) : NaN;

    if (state === 1) {
      return {
        paneId,
        kind: "progress",
        progress: isNaN(rawProgress) ? 0 : clampProgress(rawProgress),
      };
    }

    if (state === 2) {
      return {
        paneId,
        kind: "error",
        progress: isNaN(rawProgress) ? 0 : clampProgress(rawProgress),
      };
    }

    if (state === 3) {
      // indeterminate - no progress field
      return { paneId, kind: "progress" };
    }

    if (state === 4) {
      return {
        paneId,
        kind: "progress",
        level: "warn",
        progress: isNaN(rawProgress) ? 0 : clampProgress(rawProgress),
      };
    }

    return null;
  }

  // OSC 9 - generic notification (and cmux-semantic: delegation)
  if (content.startsWith("9;")) {
    const body = content.slice(2); // everything after '9;'
    if (body.startsWith("cmux-semantic:")) {
      return parseCmuxSemantic(paneId, body.slice("cmux-semantic:".length));
    }
    return { paneId, kind: "notify", body };
  }

  // OSC 99 - cmux-semantic notifications
  if (content.startsWith("99;")) {
    const payload = content.slice(3);
    if (!payload) return null;
    return parseCmuxSemantic(paneId, payload);
  }

  // OSC 777 - urxvt notify
  if (content.startsWith("777;")) {
    const rest = content.slice(4);
    const firstSemi = rest.indexOf(";");
    if (firstSemi === -1) return null;

    const subcommand = rest.slice(0, firstSemi);
    if (subcommand !== "notify") return null;

    const remaining = rest.slice(firstSemi + 1);
    const secondSemi = remaining.indexOf(";");
    if (secondSemi === -1) return null;

    const title = remaining.slice(0, secondSemi);
    const body = remaining.slice(secondSemi + 1);
    return { paneId, kind: "notify", title, body };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse all OSC notification sequences from a PTY output chunk.
 * Returns one OscNotification per valid sequence found.
 * Malformed sequences are silently dropped.
 */
export function parseOscNotification(
  paneId: string,
  chunk: string,
): OscNotification[] {
  if (!chunk) return [];

  const results: OscNotification[] = [];
  let match: RegExpExecArray | null;

  // Reset lastIndex since OSC_RE is module-level with /g flag
  OSC_RE.lastIndex = 0;

  while ((match = OSC_RE.exec(chunk)) !== null) {
    const content = match[1] ?? "";
    const notification = parseOscContent(paneId, content);
    if (notification !== null) {
      results.push(notification);
    }
  }

  return results;
}

/**
 * Feed PTY output chunk into the shared store.
 * Parsed events are appended; oldest events are evicted when the ring cap
 * (200) is exceeded.
 */
export function feedPaneOutput(paneId: string, chunk: string): void {
  const events = parseOscNotification(paneId, chunk);
  if (events.length === 0) return;

  _store.update((current) => {
    const next = [...current, ...events];
    return next.length > RING_CAP ? next.slice(next.length - RING_CAP) : next;
  });
}
