# MCP Integration

Gnar Term's MCP module is governed by the specification at Spacebase doc
`jzvBxDRrkevx` (Gnar Term MCP Specification). That Spacebase doc is the
authoritative source of truth for the contract, architecture, and tool
surface.

For user-facing documentation — settings, architecture overview, tool
list, integration test harness — see the "MCP integration" section in
[`README.md`](../README.md).

For the TypeScript implementation of the 19 tools and the JSON-RPC
dispatcher, see [`src/lib/services/mcp-server.ts`](../src/lib/services/mcp-server.ts).

For the Rust UDS bridge and `--mcp-stdio` byte pipe, see
[`src-tauri/src/mcp_bridge.rs`](../src-tauri/src/mcp_bridge.rs).
