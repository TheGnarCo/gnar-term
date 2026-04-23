#!/usr/bin/env node
/**
 * Gnar Term MCP scenario suite.
 *
 * Runs the 15 mandatory scenarios from the MCP spec § Testing strategy
 * against a live gnar-term instance, over the UDS bridge, with multiple
 * concurrent connections.
 *
 * Usage:
 *   1. Start gnar-term with `mcp: "on"` (or `auto` with Claude Code installed).
 *   2. Run: node tests/mcp-scenarios.mjs
 *
 * Each scenario opens its own UDS connection, sends a synthetic
 * `$/gnar-term/hello` to bind the connection (since this harness is not run
 * inside a gnar-term pane and so doesn't naturally inherit the env vars), and
 * exercises the contract.
 *
 * NOTE: This harness is NOT part of `npm test` — it requires a running GUI and
 * cannot run headlessly without xvfb + a built Tauri binary.
 */
import net from "node:net";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

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

class Conn {
  constructor(label = "anon") {
    this.label = label;
    this.sock = null;
    this.buf = "";
    this.id = 0;
    this.pending = new Map();
    this.notifications = [];
  }

  async open() {
    const sock = path.normalize(udsPath());
    this.sock = await new Promise((resolve, reject) => {
      const s = net.createConnection(sock);
      s.once("connect", () => resolve(s));
      s.once("error", reject);
    });
    this.sock.setEncoding("utf8");
    this.sock.on("data", (c) => this._onData(c));
    this.sock.on("close", () => {
      for (const { reject } of this.pending.values())
        reject(new Error("conn closed"));
    });
  }

  _onData(chunk) {
    this.buf += chunk;
    let i;
    while ((i = this.buf.indexOf("\n")) !== -1) {
      const line = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 1);
      if (!line.trim()) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id === undefined || msg.id === null) {
        this.notifications.push(msg);
        continue;
      }
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        msg.error
          ? p.reject(new Error(msg.error.message))
          : p.resolve(msg.result);
      }
    }
  }

  send(method, params) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout ${method} on ${this.label}`));
      }, 8000);
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
      this.sock.write(
        JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
      );
    });
  }

  /** Send a JSON-RPC notification (no id, no response expected). */
  notify(method, params) {
    this.sock.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  /** Bind this connection to the given pane / workspace via the hello handshake. */
  hello({
    pane_id = null,
    workspace_id = null,
    client_pid = process.pid,
  } = {}) {
    this.notify("$/gnar-term/hello", { pane_id, workspace_id, client_pid });
  }

  async tool(name, args = {}) {
    const r = await this.send("tools/call", { name, arguments: args });
    return r.structuredContent;
  }

  async toolError(name, args = {}) {
    try {
      await this.tool(name, args);
      return null;
    } catch (e) {
      return e;
    }
  }

  close() {
    if (this.sock) this.sock.destroy();
  }
}

async function newConn(label) {
  const c = new Conn(label);
  await c.open();
  await c.send("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: `scenario:${label}`, version: "0" },
  });
  return c;
}

let pass = 0;
let fail = 0;
const failures = [];
function ok(cond, name) {
  if (cond) {
    pass++;
    console.log(`  PASS ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  FAIL ${name}`);
  }
}
async function scenario(num, title, fn) {
  console.log(`\nScenario ${num}: ${title}`);
  try {
    await fn();
  } catch (e) {
    fail++;
    failures.push(`#${num} ${title}: ${e.message}`);
    console.log(`  FAIL scenario crashed: ${e.message}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Watchdog: periodically ping the server with a cheap tools/call. Two
// consecutive misses = the app is wedged; dump diagnostics and exit non-zero
// so CI / the developer does not have to observe the freeze manually.
// See project_mcp_testing_strategy.md.
function startWatchdog(probeConn, intervalMs = 2000, pingTimeoutMs = 3000) {
  let misses = 0;
  let stopped = false;
  const pingOnce = async () => {
    try {
      const id = ++probeConn.id;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          probeConn.pending.delete(id);
          reject(new Error("watchdog ping timeout"));
        }, pingTimeoutMs);
        probeConn.pending.set(id, {
          resolve: (v) => {
            clearTimeout(timer);
            resolve(v);
          },
          reject: (e) => {
            clearTimeout(timer);
            reject(e);
          },
        });
        probeConn.sock.write(
          JSON.stringify({ jsonrpc: "2.0", id, method: "ping", params: {} }) +
            "\n",
        );
      });
      misses = 0;
    } catch {
      misses++;
      if (misses >= 2) {
        console.error(
          `\n!!! WATCHDOG: app appears frozen (${misses} consecutive ping misses).`,
        );
        console.error(
          `!!! This is the freeze pattern described in project_mcp_freeze_investigation.md.`,
        );
        console.error(`!!! Killing test with non-zero exit so CI fails loud.`);
        process.exit(3);
      }
    }
  };
  const loop = async () => {
    while (!stopped) {
      await sleep(intervalMs);
      if (stopped) break;
      await pingOnce();
    }
  };
  loop();
  return () => {
    stopped = true;
  };
}

// ------------------------------------------------------------------
// Helpers shared across scenarios
// ------------------------------------------------------------------

async function getActiveWorkspaceId(c) {
  const ws = await c.tool("get_active_workspace", {});
  return ws?.id ?? null;
}

async function listWorkspaceIds(c) {
  const list = await c.tool("list_workspaces", {});
  return (list?.workspaces ?? []).map((w) => w.id);
}

async function paneCountInWorkspace(c, wsId) {
  const panes = await c.tool("list_panes", { workspace_id: wsId });
  return Array.isArray(panes?.panes) ? panes.panes.length : 0;
}

async function spawnProbe(c, name, extra = {}) {
  return await c.tool("spawn_agent", {
    name,
    agent: "custom",
    command: "bash --noprofile --norc -i",
    ...extra,
  });
}

async function killAll(c, sessionIds) {
  for (const sid of sessionIds) {
    try {
      await c.tool("kill_session", { session_id: sid, signal: "TERM" });
    } catch {
      /* ignore */
    }
  }
}

// ------------------------------------------------------------------
// Main
// ------------------------------------------------------------------

const sock = udsPath();
if (!fs.existsSync(sock)) {
  console.error(`gnar-term MCP socket not found at ${sock}.`);
  console.error(`Start gnar-term with mcp: "on" in gnar-term.json and re-run.`);
  process.exit(2);
}

console.log(`MCP scenarios -> ${sock}`);

// Probe connection used to read state across the suite.
const probe = await newConn("probe");

// Watchdog fires against the probe connection. If it misses twice, the suite
// aborts so a hung app is a hard test failure rather than a user-observed
// freeze.
const stopWatchdog = startWatchdog(probe);

// Pre-flight: capture baseline workspaces.
const wsIds = await listWorkspaceIds(probe);
if (wsIds.length === 0) {
  console.error(
    "No workspaces in gnar-term. Open at least one workspace and re-run.",
  );
  process.exit(2);
}
const W1 = wsIds[0];
const W2 = wsIds[1] ?? wsIds[0]; // fall back to W1 if only one exists
console.log(`Using workspaces W1=${W1} W2=${W2}`);

// ------------------------------------------------------------------
// Scenario 1: Connection bound to W1; mid-call we don't *actually* switch
// GUI focus from this harness, but we assert the call lands on W1
// regardless of which workspace is currently active.
// ------------------------------------------------------------------
const spawnedSessions = [];
await scenario(
  1,
  "Connection bound to W1; spawn lands in W1 regardless of GUI focus",
  async () => {
    const c = await newConn("c1");
    c.hello({ workspace_id: W1 });
    await sleep(50); // let hello be processed
    const before = await paneCountInWorkspace(probe, W1);
    const spawn = await spawnProbe(c, "scn1");
    spawnedSessions.push(spawn.session_id);
    ok(
      spawn.workspace_id === W1,
      `spawn.workspace_id == W1 (got ${spawn.workspace_id})`,
    );
    const after = await paneCountInWorkspace(probe, W1);
    ok(after === before + 1, `W1 pane count +1 (${before} -> ${after})`);
    c.close();
  },
);

// ------------------------------------------------------------------
// Scenario 2: Two connections bound to W1 and W2; interleaved spawns.
// Each must land in its own workspace.
// ------------------------------------------------------------------
await scenario(
  2,
  "Two connections bound to different workspaces, interleaved spawns",
  async () => {
    if (W1 === W2) {
      console.log("  SKIP — only one workspace available");
      return;
    }
    const cA = await newConn("cA");
    const cB = await newConn("cB");
    cA.hello({ workspace_id: W1 });
    cB.hello({ workspace_id: W2 });
    await sleep(50);

    const sA1 = await spawnProbe(cA, "scn2-a1");
    const sB1 = await spawnProbe(cB, "scn2-b1");
    const sA2 = await spawnProbe(cA, "scn2-a2");
    const sB2 = await spawnProbe(cB, "scn2-b2");
    spawnedSessions.push(
      sA1.session_id,
      sB1.session_id,
      sA2.session_id,
      sB2.session_id,
    );

    ok(
      sA1.workspace_id === W1 && sA2.workspace_id === W1,
      "cA spawns landed in W1",
    );
    ok(
      sB1.workspace_id === W2 && sB2.workspace_id === W2,
      "cB spawns landed in W2",
    );
    cA.close();
    cB.close();
  },
);

// ------------------------------------------------------------------
// Scenario 3: Five concurrent connections, three spawns each, fully parallel.
// ------------------------------------------------------------------
await scenario(
  3,
  "Five concurrent connections, fan-out spawns, no cross-talk",
  async () => {
    const N_CONNS = 5;
    const N_SPAWNS = 3;
    const conns = await Promise.all(
      Array.from({ length: N_CONNS }, (_, i) => newConn(`scn3-${i}`)),
    );
    // Round-robin bind to W1/W2 so we exercise both workspaces.
    for (let i = 0; i < conns.length; i++) {
      conns[i].hello({ workspace_id: i % 2 === 0 ? W1 : W2 });
    }
    await sleep(50);

    const all = await Promise.all(
      conns.flatMap((c, i) =>
        Array.from({ length: N_SPAWNS }, (_, j) =>
          spawnProbe(c, `scn3-${i}-${j}`).then((r) => ({ conn: i, ...r })),
        ),
      ),
    );
    for (const r of all) spawnedSessions.push(r.session_id);

    let bad = 0;
    for (const r of all) {
      const expected = r.conn % 2 === 0 ? W1 : W2;
      if (r.workspace_id !== expected) bad++;
    }
    ok(
      bad === 0,
      `all ${N_CONNS * N_SPAWNS} spawns landed in expected workspace (bad=${bad})`,
    );
    for (const c of conns) c.close();
  },
);

// ------------------------------------------------------------------
// Scenario 4: Connection bound to a closed pane → spawn errors clearly.
// ------------------------------------------------------------------
await scenario(4, "Bound pane is closed; spawn errors clearly", async () => {
  const c = await newConn("scn4");
  c.hello({ pane_id: "ghost-pane-id-that-does-not-exist", workspace_id: W1 });
  await sleep(50);
  // Even though pane_id is invalid, workspace_id is, so resolution rule 4
  // applies and we land in W1. To test the strict rule-1-failure-then-error
  // path we send a connection bound to a ghost pane and NO workspace_id.
  c.hello({ pane_id: "ghost-pane", workspace_id: null });
  await sleep(50);
  const err = await c.toolError("spawn_agent", {
    name: "scn4",
    agent: "custom",
    command: "bash --noprofile --norc -i",
  });
  ok(err !== null, "spawn_agent threw");
  ok(
    err && /no pane\/workspace context/.test(err.message),
    `error mentions missing context (got: ${err?.message})`,
  );
  c.close();
});

// ------------------------------------------------------------------
// Scenario 5: pane_id is stable across workspace moves (workspace re-derived).
// We can't move panes from this harness, but we exercise the resolution by
// passing a known existing pane_id and observing that it lands in that pane's
// workspace regardless of the connection's stale workspace_id binding.
// ------------------------------------------------------------------
await scenario(
  5,
  "pane_id wins over a stale workspace_id binding",
  async () => {
    if (W1 === W2) {
      console.log("  SKIP — only one workspace available");
      return;
    }
    // Find a pane in W2.
    const w2Panes = await probe.tool("list_panes", { workspace_id: W2 });
    const w2PaneList = w2Panes?.panes;
    if (!Array.isArray(w2PaneList) || w2PaneList.length === 0) {
      console.log("  SKIP — W2 has no panes");
      return;
    }
    const targetPane = w2PaneList[0].id;

    const c = await newConn("scn5");
    // Bind to a stale workspace (W1) but pass an explicit pane_id in W2.
    c.hello({ workspace_id: W1 });
    await sleep(50);
    const spawn = await spawnProbe(c, "scn5", { pane_id: targetPane });
    spawnedSessions.push(spawn.session_id);
    ok(
      spawn.workspace_id === W2,
      `spawn followed pane_id into W2 (got ${spawn.workspace_id})`,
    );
    c.close();
  },
);

// ------------------------------------------------------------------
// Scenario 6: Unbound + no workspace_id arg → error.
// ------------------------------------------------------------------
await scenario(
  6,
  "Unbound connection; spawn without workspace_id errors",
  async () => {
    const c = await newConn("scn6");
    // Send hello with both null so binding is "explicitly unbound."
    c.hello({ pane_id: null, workspace_id: null });
    await sleep(50);
    const err = await c.toolError("spawn_agent", {
      name: "scn6",
      agent: "custom",
      command: "bash --noprofile --norc -i",
    });
    ok(err !== null, "spawn_agent threw");
    ok(
      err && /no pane\/workspace context/.test(err.message),
      `error mentions missing context (got: ${err?.message})`,
    );
    c.close();
  },
);

// ------------------------------------------------------------------
// Scenario 7: Unbound + explicit workspace_id → succeeds.
// ------------------------------------------------------------------
await scenario(
  7,
  "Unbound connection; spawn with explicit workspace_id succeeds",
  async () => {
    const c = await newConn("scn7");
    c.hello({ pane_id: null, workspace_id: null });
    await sleep(50);
    const spawn = await spawnProbe(c, "scn7", { workspace_id: W1 });
    spawnedSessions.push(spawn.session_id);
    ok(spawn.workspace_id === W1, `landed in W1 (got ${spawn.workspace_id})`);
    c.close();
  },
);

// ------------------------------------------------------------------
// Scenario 8: Bound to W1, override with workspace_id=W2 → override wins.
// ------------------------------------------------------------------
await scenario(8, "Override args win over connection binding", async () => {
  if (W1 === W2) {
    console.log("  SKIP — only one workspace available");
    return;
  }
  const c = await newConn("scn8");
  c.hello({ workspace_id: W1 });
  await sleep(50);
  const spawn = await spawnProbe(c, "scn8", { workspace_id: W2 });
  spawnedSessions.push(spawn.session_id);
  ok(
    spawn.workspace_id === W2,
    `override took precedence (got ${spawn.workspace_id})`,
  );
  c.close();
});

// ------------------------------------------------------------------
// Scenario 9: dispatch_tasks with mixed bindings.
// ------------------------------------------------------------------
await scenario(
  9,
  "dispatch_tasks resolves each task independently",
  async () => {
    const c = await newConn("scn9");
    c.hello({ workspace_id: W1 });
    await sleep(50);
    const result = await c.tool("dispatch_tasks", {
      tasks: [
        {
          name: "scn9-default",
          agent: "custom",
          task: "echo SCN9_A",
          command: "bash --noprofile --norc -i",
        },
        {
          name: "scn9-explicit",
          agent: "custom",
          task: "echo SCN9_B",
          command: "bash --noprofile --norc -i",
          workspace_id: W2,
        },
      ],
    });
    ok(result.dispatched === 2 && result.failed === 0, "both tasks dispatched");
    for (const s of result.sessions ?? [])
      if (s.session_id) spawnedSessions.push(s.session_id);
    const wsForTask = (i) => result.sessions?.[i]?.workspace_id;
    ok(
      wsForTask(0) === W1,
      `task 0 used binding default (W1) (got ${wsForTask(0)})`,
    );
    if (W1 !== W2) {
      ok(
        wsForTask(1) === W2,
        `task 1 used override (W2) (got ${wsForTask(1)})`,
      );
    }
    c.close();
  },
);

// ------------------------------------------------------------------
// Scenario 10: Output buffer caps (smoke; actual cap test is in unit suite).
// ------------------------------------------------------------------
await scenario(
  10,
  "read_output returns text and a cursor for an alive session",
  async () => {
    const c = await newConn("scn10");
    c.hello({ workspace_id: W1 });
    await sleep(50);
    const spawn = await spawnProbe(c, "scn10");
    spawnedSessions.push(spawn.session_id);
    await c.tool("send_prompt", {
      session_id: spawn.session_id,
      text: "echo SCN10_MARKER",
    });
    await sleep(700);
    const out = await c.tool("read_output", {
      session_id: spawn.session_id,
      lines: 200,
      strip_ansi: true,
    });
    ok(typeof out?.output === "string", "read_output returns string");
    ok(out.output.includes("SCN10_MARKER"), "marker echoed");
    ok(typeof out?.cursor === "number", "cursor is numeric");
    c.close();
  },
);

// ------------------------------------------------------------------
// Scenario 11: GUI restart simulation — closing this harness's connection
// must drop server-side state for that connection without affecting other
// open connections.
// ------------------------------------------------------------------
await scenario(
  11,
  "Connection close frees per-connection state, others unaffected",
  async () => {
    const cA = await newConn("scn11-a");
    const cB = await newConn("scn11-b");
    cA.hello({ workspace_id: W1 });
    cB.hello({ workspace_id: W1 });
    await sleep(50);
    const sA = await spawnProbe(cA, "scn11-a");
    spawnedSessions.push(sA.session_id);
    // Drop A.
    cA.close();
    await sleep(150);
    // B must continue working.
    const sB = await spawnProbe(cB, "scn11-b");
    spawnedSessions.push(sB.session_id);
    ok(
      sB.workspace_id === W1,
      "second connection still works after first closed",
    );
    cB.close();
  },
);

// ------------------------------------------------------------------
// Scenario 12: Force-error mid-flight — server returns clean error to caller.
// ------------------------------------------------------------------
await scenario(
  12,
  "Tool call against a dead session returns a clean error, no leak",
  async () => {
    const c = await newConn("scn12");
    c.hello({ workspace_id: W1 });
    await sleep(50);
    const err = await c.toolError("send_prompt", {
      session_id: "nope-not-real",
      text: "x",
    });
    ok(
      err !== null && /not found/.test(err.message),
      `clean 'not found' error (got: ${err?.message})`,
    );
    c.close();
  },
);

// ------------------------------------------------------------------
// Scenario 13: tools/list snapshot — every documented tool is present.
// The count grows whenever a contribution registry is mirrored into MCP;
// assert on required names, not on an exact count.
// ------------------------------------------------------------------
await scenario(13, "tools/list contains every documented tool", async () => {
  const r = await probe.send("tools/list", {});
  const tools = r.tools ?? [];
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
    "get_agent_context",
    "get_active_workspace",
    "list_workspaces",
    "get_active_pane",
    "list_panes",
    "poll_events",
    "list_dir",
    "read_file",
    "file_exists",
    // extension-contribution mirrors
    "list_surface_types",
    "open_surface",
    "list_commands",
    "invoke_command",
    "list_sidebar_tabs",
    "activate_sidebar_tab",
    "list_workspace_actions",
    "invoke_workspace_action",
    "list_sidebar_sections",
    "list_overlays",
    "list_workspace_subtitles",
    "list_dashboard_tabs",
    "get_status_for_workspace",
  ];
  const names = new Set(tools.map((t) => t.name));
  const missing = required.filter((r) => !names.has(r));
  ok(
    missing.length === 0,
    `every documented tool is present (missing=[${missing.join(",")}])`,
  );
});

// ------------------------------------------------------------------
// Scenario 14: get_agent_context returns binding when bound, null when not.
// ------------------------------------------------------------------
await scenario(14, "get_agent_context returns binding or null", async () => {
  const cBound = await newConn("scn14-bound");
  cBound.hello({ pane_id: "fake-pane", workspace_id: W1, client_pid: 9999 });
  await sleep(50);
  const ctxBound = await cBound.tool("get_agent_context", {});
  ok(ctxBound?.workspace_id === W1, "bound: workspace_id matches hello");
  ok(ctxBound?.pane_id === "fake-pane", "bound: pane_id matches hello");
  ok(ctxBound?.client_pid === 9999, "bound: client_pid matches hello");
  cBound.close();

  const cUnbound = await newConn("scn14-unbound");
  cUnbound.hello({ pane_id: null, workspace_id: null });
  await sleep(50);
  const ctxUnbound = await cUnbound.tool("get_agent_context", {});
  ok(
    ctxUnbound?.workspace_id === null && ctxUnbound?.pane_id === null,
    "unbound: both nulls",
  );
  cUnbound.close();
});

// ------------------------------------------------------------------
// Scenario 15: render_sidebar in W1 is invisible from W2.
// ------------------------------------------------------------------
await scenario(
  15,
  "render_sidebar is workspace-scoped (per-workspace visibility)",
  async () => {
    if (W1 === W2) {
      console.log("  SKIP — only one workspace available");
      return;
    }
    const cA = await newConn("scn15-a");
    const cB = await newConn("scn15-b");
    cA.hello({ workspace_id: W1 });
    cB.hello({ workspace_id: W2 });
    await sleep(50);
    // Render the same section_id from each connection, but they target
    // different workspaces. Both should succeed without conflict.
    const a = await cA.tool("render_sidebar", {
      side: "secondary",
      section_id: "scn15-shared",
      title: "in W1",
      items: [{ id: "x", label: "X" }],
    });
    const b = await cB.tool("render_sidebar", {
      side: "secondary",
      section_id: "scn15-shared",
      title: "in W2",
      items: [{ id: "y", label: "Y" }],
    });
    ok(a.workspace_id === W1, "first render landed in W1");
    ok(b.workspace_id === W2, "second render landed in W2");
    // Cleanup.
    await cA.tool("remove_sidebar_section", {
      side: "secondary",
      section_id: "scn15-shared",
    });
    await cB.tool("remove_sidebar_section", {
      side: "secondary",
      section_id: "scn15-shared",
    });
    cA.close();
    cB.close();
  },
);

// ------------------------------------------------------------------
// Cleanup: kill all spawned sessions so we don't leave residue in the user's
// workspaces.
// ------------------------------------------------------------------
console.log(`\nCleanup: killing ${spawnedSessions.length} spawned sessions`);
await killAll(probe, spawnedSessions);
stopWatchdog();
probe.close();

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length > 0) {
  console.log("Failures:");
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(fail === 0 ? 0 : 1);
