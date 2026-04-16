#!/usr/bin/env node
/**
 * Gnar Term MCP integration harness.
 *
 * Speaks JSON-RPC 2.0 over the Unix domain socket exposed by a running
 * gnar-term instance with MCP enabled. Replaces the old
 * packages/gnar-term-agent-mcp/test-mcp.mjs, which is deleted along with the
 * sidecar package.
 *
 * Usage:
 *   1. Start gnar-term with `mcp: "on"` (or `auto` with Claude Code installed)
 *   2. Run: node tests/mcp-integration.mjs
 *
 * If the socket is not present, the harness exits with a clear error. This
 * is intentional: the harness is a smoke test against a live GUI instance.
 * It is NOT part of `npm test` because it cannot run headlessly without a
 * Tauri build.
 */
import net from "node:net";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { once } from "node:events";

function udsPath() {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Library/Application Support/gnar-term/mcp.sock");
  }
  if (process.platform === "linux") {
    const runtime = process.env.XDG_RUNTIME_DIR;
    if (runtime) return path.join(runtime, "gnar-term/mcp.sock");
    return path.join(home, ".config/gnar-term/mcp.sock");
  }
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA;
    if (!local) throw new Error("LOCALAPPDATA not set");
    return path.join(local, "gnar-term", "mcp.sock");
  }
  throw new Error(`unsupported platform: ${process.platform}`);
}

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

class RpcClient {
  constructor(socket) {
    this.socket = socket;
    this.buffer = "";
    this.nextId = 1;
    this.pending = new Map();
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => this._onData(chunk));
    socket.on("error", (err) => {
      for (const { reject } of this.pending.values()) reject(err);
    });
  }

  _onData(chunk) {
    this.buffer += chunk;
    let idx;
    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (!line.trim()) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch (e) {
        console.error("malformed response:", line);
        continue;
      }
      const id = msg.id;
      const p = this.pending.get(id);
      if (p) {
        this.pending.delete(id);
        if (msg.error) p.reject(new Error(msg.error.message || "rpc error"));
        else p.resolve(msg.result);
      }
    }
  }

  call(method, params = undefined, { timeoutMs = 10000 } = {}) {
    const id = this.nextId++;
    const payload = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.socket.write(JSON.stringify(payload) + "\n");
    });
  }
}

async function main() {
  const sock = udsPath();
  if (!fs.existsSync(sock)) {
    console.error(
      `gnar-term MCP socket not found at ${sock}.\n` +
        `Start gnar-term with mcp: "on" in gnar-term.json and re-run.`,
    );
    process.exit(2);
  }

  const client = await new Promise((resolve, reject) => {
    const socket = net.createConnection(sock);
    socket.once("connect", () => resolve(new RpcClient(socket)));
    socket.once("error", reject);
  });

  let pass = 0;
  let fail = 0;
  const assert = (cond, name) => {
    if (cond) {
      pass++;
      console.log(`  PASS ${name}`);
    } else {
      fail++;
      console.log(`  FAIL ${name}`);
    }
  };

  console.log("MCP integration harness ->", sock);

  // initialize
  const init = await client.call("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "gnar-term-harness", version: "0.0.0" },
  });
  assert(typeof init === "object" && init !== null, "initialize returns object");
  assert(init.protocolVersion === "2025-11-25", "protocol version matches");
  assert(init.serverInfo?.name === "gnar-term", "server name is gnar-term");

  // tools/list
  const list = await client.call("tools/list", {});
  assert(Array.isArray(list.tools), "tools/list returns array");
  assert(list.tools.length === 19, `expected 19 tools, got ${list.tools.length}`);
  const names = new Set(list.tools.map((t) => t.name));
  const required = [
    "spawn_agent",
    "list_sessions",
    "get_session_info",
    "kill_session",
    "send_prompt",
    "send_keys",
    "read_output",
    "dispatch_tasks",
    "render_sidebar",
    "remove_sidebar_section",
    "create_preview",
    "get_active_workspace",
    "list_workspaces",
    "get_active_pane",
    "list_panes",
    "poll_events",
    "list_dir",
    "read_file",
    "file_exists",
  ];
  for (const name of required) {
    assert(names.has(name), `tool ${name} is present`);
  }

  // list_workspaces (read-only; safe on a running instance)
  const workspaces = await client.call("tools/call", {
    name: "list_workspaces",
    arguments: {},
  });
  assert(workspaces?.structuredContent !== undefined, "tools/call returns structuredContent");
  assert(
    Array.isArray(workspaces.structuredContent),
    "list_workspaces result is an array",
  );

  // poll_events — should return a cursor regardless of state
  const poll = await client.call("tools/call", {
    name: "poll_events",
    arguments: {},
  });
  assert(
    typeof poll?.structuredContent?.cursor === "number",
    "poll_events returns numeric cursor",
  );

  // render_sidebar + remove_sidebar_section — write path smoke test
  const render = await client.call("tools/call", {
    name: "render_sidebar",
    arguments: {
      side: "secondary",
      section_id: "harness-smoke",
      title: "Harness",
      items: [{ id: "ok", label: "OK" }],
    },
  });
  assert(
    render?.structuredContent?.ok === true,
    "render_sidebar returns ok:true",
  );
  const removed = await client.call("tools/call", {
    name: "remove_sidebar_section",
    arguments: { side: "secondary", section_id: "harness-smoke" },
  });
  assert(
    removed?.structuredContent?.ok === true,
    "remove_sidebar_section returns ok:true",
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  client.socket.destroy();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("harness crashed:", err);
  process.exit(1);
});
