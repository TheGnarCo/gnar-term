import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SessionStore } from "../session-store.js";
import type { PtyManager } from "../pty-manager.js";
import { registerSessionTools } from "./session.js";
import { registerInteractionTools } from "./interaction.js";
import { registerOrchestrationTools } from "./orchestration.js";
import { registerScreenTools } from "./screen.js";
import { registerPaneTools } from "./pane.js";
import { registerPreviewTools } from "./preview.js";

export function registerAllTools(
  server: McpServer,
  sessions: SessionStore,
  ptyManager: PtyManager,
): void {
  registerSessionTools(server, sessions, ptyManager);
  registerInteractionTools(server, sessions, ptyManager);
  registerOrchestrationTools(server, sessions, ptyManager);
  registerScreenTools(server, sessions, ptyManager);
  registerPaneTools(server, sessions, ptyManager);
  registerPreviewTools(server, sessions, ptyManager);
}
