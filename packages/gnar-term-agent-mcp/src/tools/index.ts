import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SessionStore } from "../session-store.js";
import type { PtyManager } from "../pty-manager.js";
import { registerSessionTools } from "./session.js";
import { registerInteractionTools } from "./interaction.js";
import { registerOrchestrationTools } from "./orchestration.js";

export function registerAllTools(
  server: McpServer,
  sessions: SessionStore,
  ptyManager: PtyManager
): void {
  registerSessionTools(server, sessions, ptyManager);
  registerInteractionTools(server, sessions, ptyManager);
  registerOrchestrationTools(server, sessions, ptyManager);
}
