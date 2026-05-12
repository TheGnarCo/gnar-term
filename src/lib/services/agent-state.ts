/**
 * Agent State Machine — pure, side-effect-free.
 *
 * Defines the AgentState type, a typed transition table, and a transition
 * function. Side effects (timers, subscriptions, stores) live in the callers
 * (agent-detection-service.ts).
 *
 * Design principles:
 * - Illegal transitions return the current state unchanged (no throw).
 * - Terminal states (completed, errored) resist all events except user_reset.
 * - user_reset always goes to unknown regardless of current state.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type AgentState =
  | "idle"
  | "running"
  | "awaiting_input"
  | "errored"
  | "completed"
  | "unknown";

export type AgentStateEvent =
  | { kind: "argv_spawn" }
  | { kind: "argv_exit"; code: number }
  | { kind: "osc_notify" }
  | { kind: "osc_progress" }
  | { kind: "osc_complete" }
  | { kind: "osc_error" }
  | { kind: "heartbeat_idle" }
  | { kind: "heartbeat_output" }
  | { kind: "user_reset" };

/**
 * Allowed target states for each source state.
 * Used for documentation and optional validation by callers.
 * Terminal states (completed, errored) only allow user_reset → unknown,
 * which is handled explicitly in transitionAgentState rather than being
 * listed here (since user_reset is universal).
 */
export const AGENT_STATE_TRANSITIONS: Record<AgentState, AgentState[]> = {
  unknown: ["running", "awaiting_input", "idle"],
  idle: ["running", "awaiting_input", "errored", "completed"],
  running: ["idle", "awaiting_input", "errored", "completed"],
  awaiting_input: ["running", "idle", "errored", "completed"],
  // Terminal states — only user_reset can move these (to unknown).
  errored: [],
  completed: [],
};

// ---------------------------------------------------------------------------
// Transition function
// ---------------------------------------------------------------------------

/**
 * Compute the next AgentState given a current state and an event.
 * Returns `current` if the transition is not legal for the current state.
 * Never throws.
 */
export function transitionAgentState(
  current: AgentState,
  event: AgentStateEvent,
): AgentState {
  // user_reset is universal — always resets to unknown regardless of state.
  if (event.kind === "user_reset") {
    return "unknown";
  }

  // Terminal states resist all other events.
  if (current === "completed" || current === "errored") {
    return current;
  }

  switch (event.kind) {
    case "argv_spawn":
      // Idempotent: already running stays running.
      return current === "running" ? "running" : "running";

    case "argv_exit":
      return event.code === 0 ? "completed" : "errored";

    case "osc_notify":
      // Idempotent: already awaiting stays awaiting.
      return "awaiting_input";

    case "osc_progress":
      // Progress → running.
      return "running";

    case "osc_complete":
      return "completed";

    case "osc_error":
      return "errored";

    case "heartbeat_idle":
      // Only meaningful from running or awaiting_input; other non-terminal
      // states stay put.
      if (current === "running" || current === "awaiting_input") {
        return "idle";
      }
      return current;

    case "heartbeat_output":
      // Bootstrap only. The OSC progress / notify events own every
      // steady-state flip between `idle`, `running`, and
      // `awaiting_input` — heartbeat output is too coarse (cursor
      // redraws, TUI repaints, shell prompt noise all trip it) to
      // override a state the OSC stream has already settled on.
      // `unknown` is the one exception: a freshly spawned pane needs
      // *some* signal to leave `unknown`, and the first output byte
      // (usually a banner) arrives before the agent's first OSC.
      if (current === "unknown") {
        return "running";
      }
      return current;

    default: {
      // Exhaustiveness guard — TypeScript narrows event to never here.
      const _exhaustive: never = event;
      return current;
      void _exhaustive;
    }
  }
}
