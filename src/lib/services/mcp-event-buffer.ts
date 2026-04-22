/**
 * Ring buffer for MCP lifecycle events.
 *
 * The webview maintains a 500-entry buffer of lifecycle events that MCP
 * extensions poll via the `poll_events` tool. Events carry a monotonically
 * increasing cursor so clients can resume where they left off. If the caller's
 * cursor is older than the oldest buffered event, the read returns
 * `{ truncated: true }` alongside whatever is still available.
 */

export type McpEvent =
  | { type: "pane.focused"; cursor: number; paneId: string; workspaceId: string }
  | { type: "pane.created"; cursor: number; paneId: string; workspaceId: string }
  | { type: "pane.closed"; cursor: number; paneId: string; workspaceId: string }
  | {
      type: "session.statusChanged";
      cursor: number;
      sessionId: string;
      status: "starting" | "running" | "idle" | "exited";
    }
  | { type: "workspace.changed"; cursor: number; workspaceId: string }
  | {
      type: "sidebar.item_clicked";
      cursor: number;
      side: "primary" | "secondary";
      sectionId: string;
      itemId: string;
    };

// Distribute Omit across the union so TS preserves the discriminant and all
// per-variant fields (Omit collapses the union into `never` otherwise).
export type McpEventInput = McpEvent extends infer E
  ? E extends { cursor: number }
    ? Omit<E, "cursor">
    : never
  : never;

const MAX_EVENTS = 500;

let buffer: McpEvent[] = [];
let nextCursor = 1;

export function pushEvent(event: McpEventInput): McpEvent {
  const stamped = { ...event, cursor: nextCursor++ } as McpEvent;
  buffer.push(stamped);
  if (buffer.length > MAX_EVENTS) {
    buffer.shift();
  }
  return stamped;
}

export interface PollResult {
  events: McpEvent[];
  cursor: number;
  truncated?: boolean;
}

/**
 * Read events strictly after `cursor`. If the caller's cursor is older than
 * the oldest buffered event, `truncated: true` is set.
 */
export function pollEvents(opts: { cursor?: number; max?: number } = {}): PollResult {
  const max = Math.max(1, Math.min(opts.max ?? MAX_EVENTS, MAX_EVENTS));
  const latestEmitted = nextCursor - 1;
  if (buffer.length === 0) {
    return { events: [], cursor: latestEmitted };
  }
  const oldest = buffer[0].cursor;
  const callerCursor = opts.cursor ?? 0;
  let truncated = false;
  let startIdx: number;
  if (callerCursor + 1 < oldest) {
    // Caller lagged behind the ring buffer.
    truncated = true;
    startIdx = 0;
  } else {
    startIdx = buffer.findIndex((e) => e.cursor > callerCursor);
    if (startIdx < 0) startIdx = buffer.length;
  }
  const slice = buffer.slice(startIdx, startIdx + max);
  const resultCursor = slice.length > 0 ? slice[slice.length - 1].cursor : Math.max(callerCursor, latestEmitted);
  return {
    events: slice,
    cursor: resultCursor,
    ...(truncated ? { truncated: true } : {}),
  };
}

/** Test hook — reset the buffer between tests. */
export function _resetEventBufferForTest(): void {
  buffer = [];
  nextCursor = 1;
}

export function getEventBufferSizeForTest(): number {
  return buffer.length;
}
