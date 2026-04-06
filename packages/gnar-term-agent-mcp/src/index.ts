import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SessionStore } from "./session-store.js";
import { PtyManager } from "./pty-manager.js";
import { BridgeServer } from "./bridge-server.js";
import { registerAllTools } from "./tools/index.js";

const sessions = new SessionStore();
const ptyManager = new PtyManager();
const bridge = new BridgeServer(sessions, ptyManager);

const server = new McpServer(
  { name: "gnar-term-agent-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

registerAllTools(server, sessions, ptyManager);

// Start WebSocket bridge for Gnar Term UI integration
try {
  const port = await bridge.start();
  // Log to stderr so it doesn't interfere with stdio MCP transport
  console.error(`[gnar-term-mcp] Bridge server listening on ws://127.0.0.1:${port}`);
} catch (err) {
  console.error("[gnar-term-mcp] Failed to start bridge server:", err);
}

// Clean up PTYs and bridge on exit
function cleanup() {
  bridge.stop();
  ptyManager.killAll();
}
process.on("exit", cleanup);
process.on("SIGTERM", () => {
  cleanup();
  process.exit(0);
});
process.on("SIGINT", () => {
  cleanup();
  process.exit(0);
});

const transport = new StdioServerTransport();
await server.connect(transport);
