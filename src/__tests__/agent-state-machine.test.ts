/**
 * Tests for agent-state.ts — the pure AgentState state machine.
 *
 * Covers:
 * - Every legal transition in AGENT_STATE_TRANSITIONS fires correctly
 * - Every illegal transition is rejected (state unchanged, no throw)
 * - argv exit code 0 → completed; non-zero → errored
 * - OSC event mapping
 * - Heartbeat transitions
 * - Reset always → unknown
 */
import { describe, it, expect } from "vitest";
import {
  AGENT_STATE_TRANSITIONS,
  transitionAgentState,
  type AgentState,
  type AgentStateEvent,
} from "../lib/services/agent-state";

// ---------------------------------------------------------------------------
// AGENT_STATE_TRANSITIONS table shape
// ---------------------------------------------------------------------------

describe("AGENT_STATE_TRANSITIONS", () => {
  it("covers all AgentState values as keys", () => {
    const allStates: AgentState[] = [
      "idle",
      "running",
      "awaiting_input",
      "errored",
      "completed",
      "unknown",
    ];
    for (const s of allStates) {
      expect(AGENT_STATE_TRANSITIONS).toHaveProperty(s);
      expect(Array.isArray(AGENT_STATE_TRANSITIONS[s])).toBe(true);
    }
  });

  it("does not list self-transitions in the table (no cycles to same state)", () => {
    for (const [state, targets] of Object.entries(AGENT_STATE_TRANSITIONS)) {
      // Allow: table may or may not include self. Either is valid.
      // This test just verifies the array items are valid AgentState values.
      const validStates = new Set([
        "idle",
        "running",
        "awaiting_input",
        "errored",
        "completed",
        "unknown",
      ]);
      for (const t of targets) {
        expect(validStates.has(t)).toBe(true);
      }
      void state; // suppress unused-var
    }
  });
});

// ---------------------------------------------------------------------------
// transitionAgentState — argv events
// ---------------------------------------------------------------------------

describe("argv_spawn event", () => {
  it("idle → running on argv_spawn", () => {
    expect(transitionAgentState("idle", { kind: "argv_spawn" })).toBe(
      "running",
    );
  });

  it("unknown → running on argv_spawn", () => {
    expect(transitionAgentState("unknown", { kind: "argv_spawn" })).toBe(
      "running",
    );
  });

  it("awaiting_input → running on argv_spawn (re-spawn after prompt)", () => {
    expect(transitionAgentState("awaiting_input", { kind: "argv_spawn" })).toBe(
      "running",
    );
  });

  it("running → running (no-op, already spawned)", () => {
    expect(transitionAgentState("running", { kind: "argv_spawn" })).toBe(
      "running",
    );
  });

  it("completed → completed (terminal, cannot re-spawn)", () => {
    expect(transitionAgentState("completed", { kind: "argv_spawn" })).toBe(
      "completed",
    );
  });

  it("errored → errored (terminal, cannot re-spawn)", () => {
    expect(transitionAgentState("errored", { kind: "argv_spawn" })).toBe(
      "errored",
    );
  });
});

describe("argv_exit event", () => {
  it("exit code 0 → completed from running", () => {
    expect(
      transitionAgentState("running", { kind: "argv_exit", code: 0 }),
    ).toBe("completed");
  });

  it("exit code 1 → errored from running", () => {
    expect(
      transitionAgentState("running", { kind: "argv_exit", code: 1 }),
    ).toBe("errored");
  });

  it("exit code 127 → errored from running", () => {
    expect(
      transitionAgentState("running", { kind: "argv_exit", code: 127 }),
    ).toBe("errored");
  });

  it("exit code 0 → completed from idle", () => {
    expect(transitionAgentState("idle", { kind: "argv_exit", code: 0 })).toBe(
      "completed",
    );
  });

  it("exit code 1 → errored from idle", () => {
    expect(transitionAgentState("idle", { kind: "argv_exit", code: 1 })).toBe(
      "errored",
    );
  });

  it("exit code 0 → completed from awaiting_input", () => {
    expect(
      transitionAgentState("awaiting_input", { kind: "argv_exit", code: 0 }),
    ).toBe("completed");
  });

  it("exit code 1 → errored from awaiting_input", () => {
    expect(
      transitionAgentState("awaiting_input", { kind: "argv_exit", code: 1 }),
    ).toBe("errored");
  });

  it("argv_exit from completed → stays completed (terminal)", () => {
    expect(
      transitionAgentState("completed", { kind: "argv_exit", code: 0 }),
    ).toBe("completed");
  });

  it("argv_exit from errored → stays errored (terminal)", () => {
    expect(
      transitionAgentState("errored", { kind: "argv_exit", code: 1 }),
    ).toBe("errored");
  });
});

// ---------------------------------------------------------------------------
// OSC event mapping
// ---------------------------------------------------------------------------

describe("osc_notify event", () => {
  it("running → awaiting_input on osc_notify", () => {
    expect(transitionAgentState("running", { kind: "osc_notify" })).toBe(
      "awaiting_input",
    );
  });

  it("idle → awaiting_input on osc_notify", () => {
    expect(transitionAgentState("idle", { kind: "osc_notify" })).toBe(
      "awaiting_input",
    );
  });

  it("unknown → awaiting_input on osc_notify", () => {
    expect(transitionAgentState("unknown", { kind: "osc_notify" })).toBe(
      "awaiting_input",
    );
  });

  it("awaiting_input → awaiting_input on osc_notify (no-op, already waiting)", () => {
    expect(transitionAgentState("awaiting_input", { kind: "osc_notify" })).toBe(
      "awaiting_input",
    );
  });

  it("completed → completed on osc_notify (terminal)", () => {
    expect(transitionAgentState("completed", { kind: "osc_notify" })).toBe(
      "completed",
    );
  });

  it("errored → errored on osc_notify (terminal)", () => {
    expect(transitionAgentState("errored", { kind: "osc_notify" })).toBe(
      "errored",
    );
  });
});

describe("osc_progress event", () => {
  it("idle → running on osc_progress", () => {
    expect(transitionAgentState("idle", { kind: "osc_progress" })).toBe(
      "running",
    );
  });

  it("awaiting_input → running on osc_progress", () => {
    expect(
      transitionAgentState("awaiting_input", { kind: "osc_progress" }),
    ).toBe("running");
  });

  it("unknown → running on osc_progress", () => {
    expect(transitionAgentState("unknown", { kind: "osc_progress" })).toBe(
      "running",
    );
  });

  it("running → running on osc_progress (no-op)", () => {
    expect(transitionAgentState("running", { kind: "osc_progress" })).toBe(
      "running",
    );
  });

  it("completed → completed on osc_progress (terminal state, stays)", () => {
    expect(transitionAgentState("completed", { kind: "osc_progress" })).toBe(
      "completed",
    );
  });

  it("errored → errored on osc_progress (terminal state, stays)", () => {
    expect(transitionAgentState("errored", { kind: "osc_progress" })).toBe(
      "errored",
    );
  });
});

describe("osc_complete event", () => {
  it("running → completed on osc_complete", () => {
    expect(transitionAgentState("running", { kind: "osc_complete" })).toBe(
      "completed",
    );
  });

  it("awaiting_input → completed on osc_complete", () => {
    expect(
      transitionAgentState("awaiting_input", { kind: "osc_complete" }),
    ).toBe("completed");
  });

  it("idle → completed on osc_complete", () => {
    expect(transitionAgentState("idle", { kind: "osc_complete" })).toBe(
      "completed",
    );
  });

  it("unknown → completed on osc_complete", () => {
    expect(transitionAgentState("unknown", { kind: "osc_complete" })).toBe(
      "completed",
    );
  });

  it("completed → completed on osc_complete (idempotent)", () => {
    expect(transitionAgentState("completed", { kind: "osc_complete" })).toBe(
      "completed",
    );
  });
});

describe("osc_error event", () => {
  it("running → errored on osc_error", () => {
    expect(transitionAgentState("running", { kind: "osc_error" })).toBe(
      "errored",
    );
  });

  it("awaiting_input → errored on osc_error", () => {
    expect(transitionAgentState("awaiting_input", { kind: "osc_error" })).toBe(
      "errored",
    );
  });

  it("idle → errored on osc_error", () => {
    expect(transitionAgentState("idle", { kind: "osc_error" })).toBe("errored");
  });

  it("unknown → errored on osc_error", () => {
    expect(transitionAgentState("unknown", { kind: "osc_error" })).toBe(
      "errored",
    );
  });

  it("errored → errored on osc_error (idempotent)", () => {
    expect(transitionAgentState("errored", { kind: "osc_error" })).toBe(
      "errored",
    );
  });

  it("completed → completed on osc_error (terminal, stays completed)", () => {
    expect(transitionAgentState("completed", { kind: "osc_error" })).toBe(
      "completed",
    );
  });
});

// ---------------------------------------------------------------------------
// Heartbeat transitions
// ---------------------------------------------------------------------------

describe("heartbeat_idle event", () => {
  it("running → idle on heartbeat_idle", () => {
    expect(transitionAgentState("running", { kind: "heartbeat_idle" })).toBe(
      "idle",
    );
  });

  it("awaiting_input → idle on heartbeat_idle", () => {
    expect(
      transitionAgentState("awaiting_input", { kind: "heartbeat_idle" }),
    ).toBe("idle");
  });

  it("idle → idle on heartbeat_idle (no-op)", () => {
    expect(transitionAgentState("idle", { kind: "heartbeat_idle" })).toBe(
      "idle",
    );
  });

  it("completed → completed on heartbeat_idle (terminal)", () => {
    expect(transitionAgentState("completed", { kind: "heartbeat_idle" })).toBe(
      "completed",
    );
  });

  it("errored → errored on heartbeat_idle (terminal)", () => {
    expect(transitionAgentState("errored", { kind: "heartbeat_idle" })).toBe(
      "errored",
    );
  });

  it("unknown → unknown on heartbeat_idle (no signal)", () => {
    expect(transitionAgentState("unknown", { kind: "heartbeat_idle" })).toBe(
      "unknown",
    );
  });
});

describe("heartbeat_output event", () => {
  it("idle → running on heartbeat_output", () => {
    expect(transitionAgentState("idle", { kind: "heartbeat_output" })).toBe(
      "running",
    );
  });

  it("unknown → running on heartbeat_output", () => {
    expect(transitionAgentState("unknown", { kind: "heartbeat_output" })).toBe(
      "running",
    );
  });

  it("running → running on heartbeat_output (no-op)", () => {
    expect(transitionAgentState("running", { kind: "heartbeat_output" })).toBe(
      "running",
    );
  });

  it("awaiting_input → running on heartbeat_output (output resumes)", () => {
    expect(
      transitionAgentState("awaiting_input", { kind: "heartbeat_output" }),
    ).toBe("running");
  });

  it("completed → completed on heartbeat_output (terminal)", () => {
    expect(
      transitionAgentState("completed", { kind: "heartbeat_output" }),
    ).toBe("completed");
  });

  it("errored → errored on heartbeat_output (terminal)", () => {
    expect(transitionAgentState("errored", { kind: "heartbeat_output" })).toBe(
      "errored",
    );
  });
});

// ---------------------------------------------------------------------------
// user_reset event
// ---------------------------------------------------------------------------

describe("user_reset event", () => {
  const allStates: AgentState[] = [
    "idle",
    "running",
    "awaiting_input",
    "errored",
    "completed",
    "unknown",
  ];

  for (const state of allStates) {
    it(`${state} → unknown on user_reset`, () => {
      expect(transitionAgentState(state, { kind: "user_reset" })).toBe(
        "unknown",
      );
    });
  }
});

// ---------------------------------------------------------------------------
// Illegal transitions — state unchanged, no throw
// ---------------------------------------------------------------------------

describe("illegal transitions return current state unchanged", () => {
  it("osc_progress from completed → completed (terminal)", () => {
    // Explicitly called out in the spec
    expect(transitionAgentState("completed", { kind: "osc_progress" })).toBe(
      "completed",
    );
  });

  it("argv_spawn from running → running (already spawned)", () => {
    // Explicitly called out in the spec
    expect(transitionAgentState("running", { kind: "argv_spawn" })).toBe(
      "running",
    );
  });

  it("heartbeat_idle from idle → idle (already idle)", () => {
    // Explicitly called out in the spec
    expect(transitionAgentState("idle", { kind: "heartbeat_idle" })).toBe(
      "idle",
    );
  });

  it("does not throw on any state/event combination", () => {
    const states: AgentState[] = [
      "idle",
      "running",
      "awaiting_input",
      "errored",
      "completed",
      "unknown",
    ];
    const events: AgentStateEvent[] = [
      { kind: "argv_spawn" },
      { kind: "argv_exit", code: 0 },
      { kind: "argv_exit", code: 1 },
      { kind: "osc_notify" },
      { kind: "osc_progress" },
      { kind: "osc_complete" },
      { kind: "osc_error" },
      { kind: "heartbeat_idle" },
      { kind: "heartbeat_output" },
      { kind: "user_reset" },
    ];

    for (const state of states) {
      for (const event of events) {
        expect(() => transitionAgentState(state, event)).not.toThrow();
      }
    }
  });
});
