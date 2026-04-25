export type FieldType =
  | "string"
  | "enum"
  | "boolean"
  | "string-list"
  | "kv-map"
  | "hooks"
  | "permissions"
  | "plugins"
  | "dir-listing";

export interface SchemaField {
  key: string;
  label: string;
  description: string;
  type: FieldType;
  options?: string[];
  default?: unknown;
}

export interface SchemaSection {
  id: string;
  label: string;
  /** Top-level keys in the JSON that this section owns. */
  ownsKeys: string[];
  fields: SchemaField[];
}

export const SETTINGS_SECTIONS: SchemaSection[] = [
  {
    id: "model",
    label: "Model & Behavior",
    ownsKeys: [
      "model",
      "effortLevel",
      "alwaysThinkingEnabled",
      "outputStyle",
      "language",
      "viewMode",
      "tui",
      "defaultShell",
    ],
    fields: [
      {
        key: "model",
        label: "Model",
        description: "Default Claude model to use.",
        type: "enum",
        options: [
          "sonnet",
          "haiku",
          "opus",
          "claude-sonnet-4-6",
          "claude-haiku-4-5",
          "claude-opus-4-7",
        ],
        default: "sonnet",
      },
      {
        key: "effortLevel",
        label: "Effort level",
        description: "Thinking budget for extended reasoning.",
        type: "enum",
        options: ["xlow", "low", "default", "high", "xhigh"],
        default: "default",
      },
      {
        key: "alwaysThinkingEnabled",
        label: "Always thinking",
        description: "Enable extended thinking on every request.",
        type: "boolean",
        default: false,
      },
      {
        key: "outputStyle",
        label: "Output style",
        description: "Preferred response style.",
        type: "enum",
        options: ["Concise", "Explanatory", "Learning"],
        default: "Concise",
      },
      {
        key: "language",
        label: "Language",
        description: "Response language.",
        type: "string",
        default: "english",
      },
      {
        key: "viewMode",
        label: "View mode",
        description: "Default view density.",
        type: "enum",
        options: ["verbose", "compact"],
        default: "verbose",
      },
      {
        key: "tui",
        label: "TUI mode",
        description: "Terminal UI layout.",
        type: "enum",
        options: ["fullscreen", "inline"],
        default: "fullscreen",
      },
      {
        key: "defaultShell",
        label: "Default shell",
        description: "Shell used for Bash commands.",
        type: "enum",
        options: ["bash", "zsh", "sh"],
        default: "bash",
      },
    ],
  },
  {
    id: "permissions",
    label: "Permissions",
    ownsKeys: ["permissions"],
    fields: [
      {
        key: "permissions.allow",
        label: "Allow list",
        description:
          "Tool invocations always permitted. Supports wildcards: Bash(npm *), Read(~/src/**).",
        type: "permissions",
        default: [],
      },
      {
        key: "permissions.deny",
        label: "Deny list",
        description: "Tool invocations always blocked.",
        type: "permissions",
        default: [],
      },
      {
        key: "permissions.defaultMode",
        label: "Default permission mode",
        description: "Baseline permission level for the session.",
        type: "enum",
        options: [
          "default",
          "acceptEdits",
          "plan",
          "auto",
          "dontAsk",
          "bypassPermissions",
        ],
        default: "default",
      },
    ],
  },
  {
    id: "env",
    label: "Environment Variables",
    ownsKeys: ["env"],
    fields: [
      {
        key: "env",
        label: "Environment variables",
        description:
          "Key/value pairs injected into every session. Supports ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL, and any custom variable.",
        type: "kv-map",
        default: {},
      },
    ],
  },
  {
    id: "hooks",
    label: "Hooks",
    ownsKeys: ["hooks"],
    fields: [
      {
        key: "hooks",
        label: "Hooks",
        description:
          "Shell commands or HTTP endpoints triggered by Claude Code events (PreToolUse, PostToolUse, SessionStart, Stop, etc.).",
        type: "hooks",
        default: {},
      },
    ],
  },
  {
    id: "mcp",
    label: "MCP Servers",
    ownsKeys: [
      "enabledMcpjsonServers",
      "disabledMcpjsonServers",
      "enableAllProjectMcpServers",
    ],
    fields: [
      {
        key: "enableAllProjectMcpServers",
        label: "Enable all project MCP servers",
        description:
          "Auto-enable every MCP server declared in project .mcp.json files.",
        type: "boolean",
        default: false,
      },
      {
        key: "enabledMcpjsonServers",
        label: "Enabled MCP servers",
        description: "Names of MCP servers to enable from .mcp.json.",
        type: "string-list",
        default: [],
      },
      {
        key: "disabledMcpjsonServers",
        label: "Disabled MCP servers",
        description: "Names of MCP servers to disable from .mcp.json.",
        type: "string-list",
        default: [],
      },
    ],
  },
  {
    id: "plugins",
    label: "Plugins",
    ownsKeys: ["enabledPlugins"],
    fields: [
      {
        key: "enabledPlugins",
        label: "Enabled plugins",
        description:
          'Plugin enable/disable map. Keys are "plugin-name@marketplace". True = enabled, false = disabled.',
        type: "plugins",
        default: {},
      },
    ],
  },
  {
    id: "skills",
    label: "Skills",
    ownsKeys: [],
    fields: [
      {
        key: "__skills_dir__",
        label: "Skills directory",
        description:
          "Skill files in .claude/skills/. Each subdirectory with a SKILL.md defines a slash command.",
        type: "dir-listing",
        default: null,
      },
    ],
  },
  {
    id: "agents",
    label: "Agents",
    ownsKeys: [],
    fields: [
      {
        key: "__agents_dir__",
        label: "Agents directory",
        description:
          "Custom agent definitions in .claude/agents/. Each subdirectory defines a named agent.",
        type: "dir-listing",
        default: null,
      },
    ],
  },
  {
    id: "sandbox",
    label: "Sandbox",
    ownsKeys: ["sandbox"],
    fields: [
      {
        key: "sandbox.enabled",
        label: "Sandbox enabled",
        description: "Run commands inside a security sandbox.",
        type: "boolean",
        default: false,
      },
      {
        key: "sandbox.failIfUnavailable",
        label: "Fail if sandbox unavailable",
        description:
          "Error instead of falling back when sandbox is not available.",
        type: "boolean",
        default: false,
      },
    ],
  },
];

export const OWNED_KEYS: Set<string> = new Set(
  SETTINGS_SECTIONS.flatMap((s) => s.ownsKeys),
);
