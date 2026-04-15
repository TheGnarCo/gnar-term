#!/usr/bin/env node
/**
 * Integration test for gnar-term-agent-mcp.
 *
 * The sidecar is now a stateless MCP server that forwards every tool call
 * to the Gnar Term webview over a localhost WebSocket bridge. This test
 * stands up a mock webview client that:
 *
 *   1. Reads the port from ~/.config/gnar-term/mcp-bridge.port (written by
 *      the sidecar on startup)
 *   2. Connects to the sidecar's bridge as a client
 *   3. Answers every bridge op request with canned data
 *
 * Then it drives the sidecar over stdio MCP and asserts that each tool
 * round-trips through the bridge correctly.
 *
 * Usage: node test-mcp.mjs
 */

import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { WebSocket } from "ws";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, "dist", "index.js");
const portFilePath = join(homedir(), ".config", "gnar-term", "mcp-bridge.port");

// ---- stdio MCP client ----

let requestId = 0;
let readBuffer = "";
const pending = new Map();

const server = spawn("node", [serverPath], { stdio: ["pipe", "pipe", "pipe"] });

let sidecarErrBuf = "";
server.stderr.on("data", (chunk) => {
  sidecarErrBuf += chunk.toString();
  process.stderr.write(`[server] ${chunk}`);
});

server.stdout.on("data", (chunk) => {
  readBuffer += chunk.toString();
  let newlineIdx;
  while ((newlineIdx = readBuffer.indexOf("\n")) !== -1) {
    const line = readBuffer.slice(0, newlineIdx).trim();
    readBuffer = readBuffer.slice(newlineIdx + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pending.has(msg.id)) {
        const { resolve } = pending.get(msg.id);
        pending.delete(msg.id);
        resolve(msg);
      }
    } catch (e) {
      console.error("Failed to parse stdio line:", line);
    }
  }
});

function send(method, params = {}) {
  const id = ++requestId;
  const msg = { jsonrpc: "2.0", id, method, params };
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    server.stdin.write(JSON.stringify(msg) + "\n");
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }
    }, 10000);
  });
}

function notify(method, params = {}) {
  const msg = { jsonrpc: "2.0", method, params };
  server.stdin.write(JSON.stringify(msg) + "\n");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---- mock webview client ----

class MockWebview {
  constructor() {
    this.ws = null;
    this.sessions = new Map();
    this.nextSessionId = 1;
    this.log = [];
  }

  async connect() {
    // Wait for the port file to appear
    for (let i = 0; i < 50; i++) {
      if (existsSync(portFilePath)) break;
      await sleep(100);
    }
    if (!existsSync(portFilePath)) {
      throw new Error(`Port file not found at ${portFilePath} after 5s`);
    }
    const port = parseInt(readFileSync(portFilePath, "utf-8").trim(), 10);
    if (!Number.isFinite(port)) throw new Error(`Invalid port: ${port}`);

    this.ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((resolve, reject) => {
      this.ws.on("open", resolve);
      this.ws.on("error", reject);
    });

    this.ws.on("message", (raw) => this.handleMessage(raw.toString()));
  }

  handleMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type !== "request") return;
    this.log.push({ op: msg.op, params: msg.params });
    let result, error;
    try {
      result = this.dispatch(msg.op, msg.params);
    } catch (e) {
      error = e.message;
    }
    const resp = { type: "response", id: msg.id };
    if (error) resp.error = error;
    else resp.result = result;
    this.ws.send(JSON.stringify(resp));
  }

  dispatch(op, params) {
    switch (op) {
      case "spawn_pane": {
        const id = `mock-${this.nextSessionId++}`;
        const session = {
          session_id: id,
          name: params.name,
          agent: params.agent,
          pid: 1000 + this.nextSessionId,
          status: "starting",
          cwd: params.cwd || "/tmp",
          createdAt: new Date().toISOString(),
        };
        this.sessions.set(id, session);
        return session;
      }
      case "list_sessions":
        return Array.from(this.sessions.values());
      case "get_session_info": {
        const s = this.sessions.get(params.session_id);
        if (!s) throw new Error(`session ${params.session_id} not found`);
        return { ...s, bufferStats: { cursor: 42, lastLine: "$ " } };
      }
      case "kill_session": {
        if (!this.sessions.has(params.session_id)) {
          throw new Error(`session ${params.session_id} not found`);
        }
        this.sessions.delete(params.session_id);
        return { ok: true };
      }
      case "send_prompt": {
        if (!this.sessions.has(params.session_id)) {
          throw new Error(`session ${params.session_id} not found`);
        }
        return { ok: true };
      }
      case "send_keys": {
        if (!this.sessions.has(params.session_id)) {
          throw new Error(`session ${params.session_id} not found`);
        }
        return { ok: true };
      }
      case "read_output": {
        const s = this.sessions.get(params.session_id);
        if (!s) throw new Error(`session ${params.session_id} not found`);
        return {
          output: "HELLO_MCP_TEST\n$ ",
          cursor: 2,
          total_lines: 2,
          session_status: s.status,
        };
      }
      case "dispatch_tasks": {
        const results = params.tasks.map((t) => {
          const id = `mock-${this.nextSessionId++}`;
          const session = {
            session_id: id,
            name: t.name,
            agent: t.agent,
            pid: 2000 + this.nextSessionId,
            status: "starting",
            cwd: t.cwd || "/tmp",
            createdAt: new Date().toISOString(),
          };
          this.sessions.set(id, session);
          return {
            session_id: id,
            name: t.name,
            agent: t.agent,
            pid: session.pid,
          };
        });
        return {
          dispatched: results.length,
          failed: 0,
          sessions: results,
        };
      }
      default:
        throw new Error(`unknown op: ${op}`);
    }
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

// ---- assertions ----

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL: ${msg}`);
  }
}

// ---- test run ----

async function run() {
  console.log("=== gnar-term-agent-mcp integration tests (bridge) ===\n");

  const mock = new MockWebview();

  // 0. Connect mock webview to sidecar bridge
  console.log("0. Mock webview connects to sidecar bridge");
  await mock.connect();
  assert(mock.ws && mock.ws.readyState === 1, "Mock webview connected");

  // 1. Initialize MCP
  console.log("\n1. Initialize MCP connection");
  const initResp = await send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test-harness", version: "0.1.0" },
  });
  assert(
    initResp.result?.serverInfo?.name === "gnar-term-agent-mcp",
    "Server identifies as gnar-term-agent-mcp",
  );
  notify("notifications/initialized");

  // 2. List tools
  console.log("\n2. List tools");
  const toolsResp = await send("tools/list", {});
  const toolNames = toolsResp.result.tools.map((t) => t.name).sort();
  const expected = [
    "dispatch_tasks",
    "get_session_info",
    "kill_session",
    "list_sessions",
    "read_output",
    "send_keys",
    "send_prompt",
    "spawn_agent",
  ];
  assert(toolNames.length === 8, `Found ${toolNames.length} tools`);
  assert(
    JSON.stringify(toolNames) === JSON.stringify(expected),
    `Tool names: ${toolNames.join(", ")}`,
  );

  // 3. Empty list_sessions
  console.log("\n3. List sessions (empty)");
  const emptyList = await send("tools/call", {
    name: "list_sessions",
    arguments: {},
  });
  const empty = JSON.parse(emptyList.result.content[0].text);
  assert(Array.isArray(empty) && empty.length === 0, "No sessions initially");

  // 4. Spawn agent → forwards to spawn_pane
  console.log("\n4. Spawn agent");
  const spawnResp = await send("tools/call", {
    name: "spawn_agent",
    arguments: { name: "test-bash", agent: "custom", command: "bash" },
  });
  assert(!spawnResp.result.isError, "spawn_agent succeeded");
  const spawnData = JSON.parse(spawnResp.result.content[0].text);
  assert(
    typeof spawnData.session_id === "string",
    `Got session_id: ${spawnData.session_id}`,
  );
  assert(typeof spawnData.pid === "number", `Got pid: ${spawnData.pid}`);
  assert(
    mock.log.some((e) => e.op === "spawn_pane"),
    "Bridge op was spawn_pane",
  );

  const sessionId = spawnData.session_id;

  // 5. send_prompt
  console.log("\n5. send_prompt");
  const promptResp = await send("tools/call", {
    name: "send_prompt",
    arguments: { session_id: sessionId, text: "echo HELLO_MCP_TEST" },
  });
  assert(!promptResp.result.isError, "send_prompt succeeded");
  const sentPrompt = mock.log.find((e) => e.op === "send_prompt");
  assert(sentPrompt?.params.text === "echo HELLO_MCP_TEST", "Text forwarded");

  // 6. read_output
  console.log("\n6. read_output");
  const readResp = await send("tools/call", {
    name: "read_output",
    arguments: { session_id: sessionId, lines: 20 },
  });
  const readData = JSON.parse(readResp.result.content[0].text);
  assert(readData.output.includes("HELLO_MCP_TEST"), "Output contains HELLO_MCP_TEST");
  assert(typeof readData.cursor === "number", `Cursor: ${readData.cursor}`);

  // 7. send_keys
  console.log("\n7. send_keys ctrl+c");
  const keysResp = await send("tools/call", {
    name: "send_keys",
    arguments: { session_id: sessionId, keys: "ctrl+c" },
  });
  assert(!keysResp.result.isError, "send_keys succeeded");
  const sentKeys = mock.log.find((e) => e.op === "send_keys");
  assert(sentKeys?.params.keys === "ctrl+c", "Keys forwarded");

  // 8. get_session_info
  console.log("\n8. get_session_info");
  const infoResp = await send("tools/call", {
    name: "get_session_info",
    arguments: { session_id: sessionId },
  });
  const info = JSON.parse(infoResp.result.content[0].text);
  assert(info.name === "test-bash", "Session name matches");
  assert(info.bufferStats?.cursor === 42, "Buffer stats forwarded");

  // 9. dispatch_tasks
  console.log("\n9. dispatch_tasks");
  const dispatchResp = await send("tools/call", {
    name: "dispatch_tasks",
    arguments: {
      tasks: [
        { name: "w1", agent: "custom", task: "echo W1", command: "bash" },
        { name: "w2", agent: "custom", task: "echo W2", command: "bash" },
      ],
    },
  });
  const dispatchData = JSON.parse(dispatchResp.result.content[0].text);
  assert(dispatchData.dispatched === 2, `Dispatched ${dispatchData.dispatched}`);
  assert(dispatchData.failed === 0, "No failures");

  // 10. list_sessions (now has 3)
  console.log("\n10. list_sessions (3 active)");
  const listResp = await send("tools/call", {
    name: "list_sessions",
    arguments: {},
  });
  const all = JSON.parse(listResp.result.content[0].text);
  assert(all.length === 3, `${all.length} sessions active`);

  // 11. kill_session
  console.log("\n11. kill_session");
  const killResp = await send("tools/call", {
    name: "kill_session",
    arguments: { session_id: sessionId },
  });
  assert(!killResp.result.isError, "kill_session succeeded");

  // 12. list_sessions (2 left)
  console.log("\n12. list_sessions (2 left after kill)");
  const listResp2 = await send("tools/call", {
    name: "list_sessions",
    arguments: {},
  });
  const remaining = JSON.parse(listResp2.result.content[0].text);
  assert(remaining.length === 2, `${remaining.length} sessions remaining`);

  // 13. Error path: bad session
  console.log("\n13. Error handling");
  const badResp = await send("tools/call", {
    name: "read_output",
    arguments: { session_id: "nonexistent" },
  });
  assert(
    badResp.result.isError === true,
    "read_output on bad session returns isError",
  );

  // 14. Custom agent without command rejected client-side
  console.log("\n14. Custom agent without command");
  const badCustom = await send("tools/call", {
    name: "spawn_agent",
    arguments: { name: "bad", agent: "custom" },
  });
  assert(badCustom.result.isError === true, "spawn_agent without command errors");

  // 15. Unknown key rejected
  console.log("\n15. Unknown key");
  const badKey = await send("tools/call", {
    name: "send_keys",
    arguments: { session_id: "mock-2", keys: "super+gobbledygook" },
  });
  assert(badKey.result.isError === true, "Unknown key rejected");

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);

  mock.close();
  server.kill();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("Test error:", err);
  server.kill();
  process.exit(1);
});
