/**
 * Agent preset configuration — workspace-scoped agent spawn presets.
 *
 * Distinct from `AgentsConfig` (detection patterns). An `AgentPreset` describes
 * how to launch a specific agent tool (e.g. Claude Code, Aider) in a new pane,
 * including its command, environment, and optional initial prompt.
 */

/**
 * A single agent spawn preset. Each entry in `GnarTermConfig.agents` describes
 * one launchable agent configuration.
 */
export interface AgentPreset {
  /** Human-readable label shown in the command palette / spawn UI. */
  name: string;
  /** Shell command used to start the agent, e.g. `"claude"`. */
  command: string;
  /** Extra environment variables injected into the spawned pane. */
  env?: Record<string, string>;
  /**
   * Which built-in detection entry this preset maps to (e.g. `"claude-code"`).
   * Used to correlate spawned panes with agent-detection patterns.
   */
  intendedAgent?: string;
  /** Override working directory for the spawned pane. */
  defaultCwd?: string;
  /**
   * When true, this preset is automatically spawned in new workspaces
   * (subject to workspace-level opt-in). Defaults to false.
   */
  autoSpawn?: boolean;
  /** Text sent to the agent pane immediately after spawn. */
  initialPrompt?: string;
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

/**
 * Shape returned by `migrateAgentsConfig`. Callers spread `otherFields` back
 * onto the config object to preserve unknown keys for round-trip compat.
 */
export interface MigratedAgentsShape {
  agentDetection?: unknown;
  agents?: AgentPreset[];
  /** All other top-level keys from the raw config, untouched. */
  otherFields: Record<string, unknown>;
}

/**
 * Detects whether the raw config object uses the OLD `agents` shape
 * (sub-fields `knownAgents` / `idleTimeout`) or the NEW shape (array of
 * presets with `command` fields), and normalises accordingly.
 *
 * Old shape  → moves `agents` value under `agentDetection`; `agents` becomes undefined.
 * New shape  → keeps `agents` as-is (preset array); `agentDetection` untouched.
 * Both keys present → preserves both (new shape wins for `agents`).
 * Neither present  → no-op.
 *
 * The function is pure and idempotent.
 */
export function migrateAgentsConfig(raw: unknown): MigratedAgentsShape {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { otherFields: {} };
  }

  const obj = raw as Record<string, unknown>;

  // Pull out the three keys we care about; everything else goes to otherFields.
  const { agents, agentDetection, ...otherFields } = obj;

  let resolvedAgentDetection: unknown = agentDetection;
  let resolvedAgents: AgentPreset[] | undefined = undefined;

  if (agents !== undefined) {
    if (isOldAgentsShape(agents)) {
      // Old shape: move to agentDetection (only if agentDetection not already set)
      if (resolvedAgentDetection === undefined) {
        resolvedAgentDetection = agents;
      }
      // resolvedAgents stays undefined
    } else if (isNewAgentsShape(agents)) {
      // New shape: keep as preset list
      resolvedAgents = agents as AgentPreset[];
    }
    // If agents is present but fits neither shape (e.g. empty object), discard it.
  }

  const result: MigratedAgentsShape = { otherFields };
  if (resolvedAgentDetection !== undefined) {
    result.agentDetection = resolvedAgentDetection;
  }
  if (resolvedAgents !== undefined) {
    result.agents = resolvedAgents;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Shape guards
// ---------------------------------------------------------------------------

/**
 * Returns true if `value` looks like the old `AgentsConfig` detection shape
 * (an object with `knownAgents` and/or `idleTimeout` sub-fields).
 */
function isOldAgentsShape(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return "knownAgents" in v || "idleTimeout" in v;
}

/**
 * Returns true if `value` looks like the new preset array shape
 * (a non-empty array whose first element has a `command` string field).
 */
function isNewAgentsShape(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  if (value.length === 0) return true; // empty array is a valid (empty) preset list
  const first = value[0];
  return (
    first !== null &&
    typeof first === "object" &&
    "command" in (first as object)
  );
}
