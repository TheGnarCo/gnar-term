import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SessionStore } from "./session-store.js";
import { PtyManager } from "./pty-manager.js";
import { registerAllTools } from "./tools/index.js";

const sessions = new SessionStore();
const ptyManager = new PtyManager();

const server = new McpServer(
  { name: "gnar-term-agent-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

registerAllTools(server, sessions, ptyManager);

// Clean up PTYs on exit
function cleanup() {
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
