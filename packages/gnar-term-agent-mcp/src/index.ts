import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BridgeServer } from "./bridge-server.js";
import { registerAllTools } from "./tools/index.js";

const bridge = new BridgeServer();

const server = new McpServer(
  { name: "gnar-term-agent-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

registerAllTools(server, bridge);

// Start the WS bridge server. The Gnar Term webview will connect to it on
// startup. The sidecar is ready to accept MCP stdio traffic regardless, but
// tool calls will return an error until a webview connects.
try {
  const port = await bridge.start();
  console.error(`[gnar-term-mcp] Bridge server listening on ws://127.0.0.1:${port}`);
} catch (err) {
  console.error("[gnar-term-mcp] Failed to start bridge server:", err);
}

function cleanup() {
  bridge.stop();
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
