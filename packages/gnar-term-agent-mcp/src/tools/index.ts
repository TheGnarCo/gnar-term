import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeServer } from "../bridge-server.js";
import { registerSessionTools } from "./session.js";
import { registerInteractionTools } from "./interaction.js";
import { registerOrchestrationTools } from "./orchestration.js";

export function registerAllTools(server: McpServer, bridge: BridgeServer): void {
  registerSessionTools(server, bridge);
  registerInteractionTools(server, bridge);
  registerOrchestrationTools(server, bridge);
}
