/**
 * AgentType — typed union of all AI coding agents gnar-term can detect.
 *
 * This module is the single source of truth for the agent type taxonomy.
 * `agent-detection-service.ts` reads from here; extension code and UI
 * components should import `AgentType` from here rather than from the
 * detection service so the coupling stays one-directional.
 */

// ---------------------------------------------------------------------------
// Union type
// ---------------------------------------------------------------------------

export type AgentType =
  | "claude"
  | "codex"
  | "gemini"
  | "goose"
  | "aider"
  | "opencode"
  | "cline"
  | "amp"
  | "cursor-agent"
  | "generic";

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

const AGENT_TYPE_SET: ReadonlySet<string> = new Set<AgentType>([
  "claude",
  "codex",
  "gemini",
  "goose",
  "aider",
  "opencode",
  "cline",
  "amp",
  "cursor-agent",
  "generic",
]);

export function isAgentType(value: unknown): value is AgentType {
  return typeof value === "string" && AGENT_TYPE_SET.has(value);
}

// ---------------------------------------------------------------------------
// argv-based classification
// ---------------------------------------------------------------------------

/**
 * Classify an agent type from a process's argv0 and argv[].
 *
 * argv0 is checked first (strongest signal — it is the binary path).
 * If argv0 is a generic interpreter (node, python, ruby, …), argv[1]
 * is checked as a script-path fallback so that e.g. `node claude-code/cli.js`
 * is correctly classified as "claude".
 *
 * Returns null when no match is found. The detection service maps null
 * to "generic" when it needs a non-nullable AgentType.
 */
export function parseAgentTypeFromArgv(
  argv0: string,
  argv: string[],
): AgentType | null {
  // argv0 direct match — fastest path
  const fromArgv0 = classifyBinaryName(argv0);
  if (fromArgv0 !== null) return fromArgv0;

  // argv[1] fallback for interpreted runtimes
  if (argv.length > 0) {
    const fromScript = classifyBinaryName(argv[0] ?? "");
    if (fromScript !== null) return fromScript;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extract the binary/script name from a full path and match it against
 * the known agent taxonomy.
 *
 * Rules (applied in priority order):
 *   1. Path segment ends with `claude-code` or `claude` → "claude"
 *   2. Path segment ends with `cursor-agent` → "cursor-agent"
 *   3. Exact binary name matches for remaining agents
 *
 * Case-sensitive: real binary names are lowercase on all platforms.
 */
function classifyBinaryName(rawPath: string): AgentType | null {
  if (!rawPath) return null;

  // Extract the last path component (works for both / and Windows \)
  const segments = rawPath.split(/[/\\]/);
  const basename = segments[segments.length - 1] ?? "";

  // Strip common extensions (.exe, .cmd, .sh, …) so platform variants match
  const name = basename.replace(/\.[a-z]{1,4}$/, "");

  // Priority rules
  if (name === "claude" || name === "claude-code") return "claude";
  if (name === "cursor-agent") return "cursor-agent";
  if (name === "codex") return "codex";
  if (name === "gemini") return "gemini";
  if (name === "goose") return "goose";
  if (name === "aider") return "aider";
  if (name === "opencode") return "opencode";
  if (name === "cline") return "cline";
  if (name === "amp") return "amp";

  // Check if the full path contains a recognisable agent-code segment
  // (covers paths like `/node_modules/@anthropic-ai/claude-code/cli.js`)
  if (rawPath.includes("claude-code") || rawPath.includes("claude_code"))
    return "claude";

  return null;
}
