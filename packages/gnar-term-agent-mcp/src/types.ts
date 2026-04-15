export const AGENT_COMMANDS: Record<string, string[]> = {
  "claude-code": ["claude"],
  codex: ["codex"],
  aider: ["aider"],
  custom: [],
};

export const KEY_MAP: Record<string, string> = {
  "ctrl+c": "\x03",
  "ctrl+d": "\x04",
  "ctrl+z": "\x1a",
  "ctrl+l": "\x0c",
  "ctrl+a": "\x01",
  "ctrl+e": "\x05",
  "ctrl+u": "\x15",
  "ctrl+k": "\x0b",
  enter: "\r",
  tab: "\t",
  escape: "\x1b",
  backspace: "\x7f",
  up: "\x1b[A",
  down: "\x1b[B",
  right: "\x1b[C",
  left: "\x1b[D",
};

export type AgentType = "claude-code" | "codex" | "aider" | "custom";
export type SessionStatus = "starting" | "running" | "idle" | "exited";

export interface SpawnOptions {
  name: string;
  agent: AgentType;
  task?: string;
  cwd?: string;
  command?: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
}

export interface AgentSession {
  session_id: string;
  name: string;
  agent: AgentType;
  pid: number | undefined;
  status: SessionStatus;
  cwd: string;
  createdAt: string;
}
