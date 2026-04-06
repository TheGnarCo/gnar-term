#!/usr/bin/env node
/**
 * Integration test for gnar-term-agent-mcp.
 *
 * Spawns the MCP server as a child process, sends JSON-RPC messages over stdio,
 * and verifies the full lifecycle: spawn a bash session, send a command,
 * read output, then kill the session.
 *
 * Usage: node test-mcp.mjs
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, "dist", "index.js");

let requestId = 0;
let readBuffer = "";
const pending = new Map(); // id -> { resolve, reject }

// Spawn the MCP server
const server = spawn("node", [serverPath], {
  stdio: ["pipe", "pipe", "pipe"],
});

server.stderr.on("data", (chunk) => {
  process.stderr.write(`[server stderr] ${chunk}`);
});

server.stdout.on("data", (chunk) => {
  readBuffer += chunk.toString();
  // MCP uses newline-delimited JSON
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
      console.error("Failed to parse:", line);
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
        reject(new Error(`Timeout waiting for response to ${method}`));
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

async function run() {
  console.log("=== gnar-term-agent-mcp integration tests ===\n");

  // 1. Initialize
  console.log("1. Initialize MCP connection");
  const initResp = await send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test-harness", version: "0.1.0" },
  });
  assert(initResp.result?.serverInfo?.name === "gnar-term-agent-mcp", "Server identifies as gnar-term-agent-mcp");
  notify("notifications/initialized");

  // 2. List tools
  console.log("\n2. List tools");
  const toolsResp = await send("tools/list", {});
  const toolNames = toolsResp.result.tools.map((t) => t.name).sort();
  assert(toolNames.length === 8, `Found ${toolNames.length} tools`);
  const expected = ["dispatch_tasks", "get_session_info", "kill_session", "list_sessions", "read_output", "send_keys", "send_prompt", "spawn_agent"];
  assert(JSON.stringify(toolNames) === JSON.stringify(expected), `Tool names: ${toolNames.join(", ")}`);

  // 3. List sessions (should be empty)
  console.log("\n3. List sessions (empty)");
  const emptyList = await send("tools/call", { name: "list_sessions", arguments: {} });
  const sessions = JSON.parse(emptyList.result.content[0].text);
  assert(Array.isArray(sessions) && sessions.length === 0, "No sessions initially");

  // 4. Spawn a bash session
  console.log("\n4. Spawn bash session");
  const spawnResp = await send("tools/call", {
    name: "spawn_agent",
    arguments: { name: "test-bash", agent: "custom", command: "bash" },
  });
  assert(!spawnResp.result.isError, "Spawn succeeded");
  const spawnData = JSON.parse(spawnResp.result.content[0].text);
  const sessionId = spawnData.session_id;
  assert(typeof sessionId === "string" && sessionId.length > 0, `Got session_id: ${sessionId.slice(0, 8)}...`);
  assert(typeof spawnData.pid === "number", `Got pid: ${spawnData.pid}`);

  // 5. Send a command
  console.log("\n5. Send command: echo HELLO_MCP_TEST");
  await sleep(500); // let bash start
  const sendResp = await send("tools/call", {
    name: "send_prompt",
    arguments: { session_id: sessionId, text: "echo HELLO_MCP_TEST" },
  });
  assert(!sendResp.result.isError, "send_prompt succeeded");

  // 6. Read output
  console.log("\n6. Read output");
  await sleep(1000); // let command execute
  const readResp = await send("tools/call", {
    name: "read_output",
    arguments: { session_id: sessionId, lines: 20 },
  });
  const readData = JSON.parse(readResp.result.content[0].text);
  assert(readData.output.includes("HELLO_MCP_TEST"), "Output contains HELLO_MCP_TEST");
  assert(typeof readData.cursor === "number", `Cursor: ${readData.cursor}`);

  // 7. Cursor-based polling
  console.log("\n7. Cursor-based polling");
  const cursor1 = readData.cursor;
  await send("tools/call", {
    name: "send_prompt",
    arguments: { session_id: sessionId, text: "echo SECOND_OUTPUT" },
  });
  await sleep(500);
  const pollResp = await send("tools/call", {
    name: "read_output",
    arguments: { session_id: sessionId, cursor: cursor1 },
  });
  const pollData = JSON.parse(pollResp.result.content[0].text);
  assert(pollData.output.includes("SECOND_OUTPUT"), "Cursor poll caught SECOND_OUTPUT");
  assert(!pollData.output.includes("HELLO_MCP_TEST"), "Cursor poll excluded old output");

  // 8. Send keys (ctrl+c)
  console.log("\n8. Send keys");
  const keysResp = await send("tools/call", {
    name: "send_keys",
    arguments: { session_id: sessionId, keys: "ctrl+c" },
  });
  assert(!keysResp.result.isError, "send_keys ctrl+c succeeded");

  // 9. Get session info
  console.log("\n9. Get session info");
  const infoResp = await send("tools/call", {
    name: "get_session_info",
    arguments: { session_id: sessionId },
  });
  const info = JSON.parse(infoResp.result.content[0].text);
  assert(info.name === "test-bash", "Session name matches");
  assert(info.agentType === "custom", "Agent type is custom");

  // 10. Dispatch multiple tasks
  console.log("\n10. Dispatch tasks");
  const dispatchResp = await send("tools/call", {
    name: "dispatch_tasks",
    arguments: {
      tasks: [
        { name: "worker-1", agent: "custom", task: "echo W1", command: "bash" },
        { name: "worker-2", agent: "custom", task: "echo W2", command: "bash" },
      ],
    },
  });
  const dispatchData = JSON.parse(dispatchResp.result.content[0].text);
  assert(dispatchData.dispatched === 2, `Dispatched ${dispatchData.dispatched} sessions`);
  assert(dispatchData.failed === 0, "No failures");

  // 11. List sessions (should have 3 now)
  console.log("\n11. List sessions (3 active)");
  const listResp = await send("tools/call", { name: "list_sessions", arguments: {} });
  const allSessions = JSON.parse(listResp.result.content[0].text);
  assert(allSessions.length === 3, `${allSessions.length} sessions active`);

  // 12. Kill original session
  console.log("\n12. Kill session");
  const killResp = await send("tools/call", {
    name: "kill_session",
    arguments: { session_id: sessionId },
  });
  assert(!killResp.result.isError, "kill_session succeeded");

  // 13. Error handling: invalid session
  console.log("\n13. Error handling");
  const badResp = await send("tools/call", {
    name: "read_output",
    arguments: { session_id: "nonexistent" },
  });
  assert(badResp.result.isError === true, "read_output on bad session returns isError");

  // Cleanup: kill dispatched sessions
  for (const s of dispatchData.sessions) {
    if (s.session_id) {
      await send("tools/call", { name: "kill_session", arguments: { session_id: s.session_id } });
    }
  }

  // Summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);

  server.kill();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("Test error:", err);
  server.kill();
  process.exit(1);
});
