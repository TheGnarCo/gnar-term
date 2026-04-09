/**
 * Tests for agent dashboard utilities:
 * - getAggregatedHarnessStatus (types.ts)
 * - agentStatusColor, agentStatusLabel (agent-utils.ts)
 * - getAgentsFromWorkspace, getAgentsFromWorkspaces (agent-utils.ts)
 */
import { describe, it, expect } from "vitest";
import {
  getAggregatedHarnessStatus,
  type AggregatedHarnessStatus,
  type Workspace,
  type Pane,
  type HarnessSurface,
  type TerminalSurface,
  type AgentStatus,
} from "../lib/types";
import {
  agentStatusColor,
  agentStatusLabel,
  getAgentsFromWorkspace,
  getAgentsFromWorkspaces,
  findNextWaitingAgent,
  resolvePresetName,
  type AgentInfo,
} from "../lib/agent-utils";
import type { ThemeDef } from "../lib/theme-data";

// --- Helpers ---

function makeMockHarnessSurface(
  id: string,
  status: AgentStatus = "idle",
  presetId = "claude",
): HarnessSurface {
  return {
    kind: "harness",
    id,
    presetId,
    terminal: {} as any,
    fitAddon: { fit: () => {} } as any,
    searchAddon: {} as any,
    termElement: document.createElement("div"),
    ptyId: 1,
    status,
    title: `Claude ${id}`,
    hasUnread: false,
    opened: true,
  };
}

function makeMockTerminalSurface(
  id: string,
  agentStatus?: AgentStatus,
): TerminalSurface {
  return {
    kind: "terminal",
    id,
    terminal: {} as any,
    fitAddon: { fit: () => {} } as any,
    searchAddon: {} as any,
    termElement: document.createElement("div"),
    ptyId: 2,
    title: `Terminal ${id}`,
    hasUnread: false,
    opened: true,
    agentStatus,
  };
}

function makeWorkspace(
  id: string,
  surfaces: (HarnessSurface | TerminalSurface)[],
  opts: { projectId?: string; branch?: string; name?: string } = {},
): Workspace {
  const pane: Pane = {
    id: `pane-${id}`,
    surfaces,
    activeSurfaceId: surfaces[0]?.id ?? null,
  };
  return {
    id,
    name: opts.name ?? `Workspace ${id}`,
    splitRoot: { type: "pane", pane },
    activePaneId: pane.id,
    record: {
      id,
      type: "managed",
      name: opts.name ?? `Workspace ${id}`,
      status: "active",
      projectId: opts.projectId,
      branch: opts.branch,
    },
  };
}

// Minimal theme for testing color functions
const mockTheme: ThemeDef = {
  name: "Test",
  bg: "#000",
  bgSurface: "#111",
  bgFloat: "#222",
  bgHighlight: "#333",
  bgActive: "#222",
  border: "#444",
  borderActive: "#55f",
  borderNotify: "#55f",
  fg: "#eee",
  fgMuted: "#aaa",
  fgDim: "#666",
  accent: "#55f",
  accentHover: "#77f",
  notify: "#55f",
  notifyGlow: "rgba(0,0,0,0.2)",
  danger: "#f55",
  success: "#5f5",
  warning: "#ff5",
  termBg: "#000",
  termFg: "#eee",
  termCursor: "#eee",
  termSelection: "#333",
  sidebarBg: "#111",
  sidebarBorder: "#222",
  tabBarBg: "#111",
  tabBarBorder: "#222",
  ansi: {
    black: "#000",
    red: "#f00",
    green: "#0f0",
    yellow: "#ff0",
    blue: "#00f",
    magenta: "#f0f",
    cyan: "#0ff",
    white: "#fff",
    brightBlack: "#888",
    brightRed: "#f88",
    brightGreen: "#8f8",
    brightYellow: "#ff8",
    brightBlue: "#88f",
    brightMagenta: "#f8f",
    brightCyan: "#8ff",
    brightWhite: "#fff",
  },
};

// --- getAggregatedHarnessStatus ---

describe("getAggregatedHarnessStatus", () => {
  it("returns null for a workspace with no harnesses", () => {
    const ws = makeWorkspace("ws1", [makeMockTerminalSurface("t1")]);
    expect(getAggregatedHarnessStatus(ws)).toBeNull();
  });

  it("returns null for empty workspace", () => {
    const ws = makeWorkspace("ws1", []);
    expect(getAggregatedHarnessStatus(ws)).toBeNull();
  });

  it("returns correct status for a single harness", () => {
    const ws = makeWorkspace("ws1", [makeMockHarnessSurface("h1", "running")]);
    const result = getAggregatedHarnessStatus(ws);
    expect(result).not.toBeNull();
    expect(result!.primary).toBe("running");
    expect(result!.running).toBe(1);
    expect(result!.total).toBe(1);
    expect(result!.waiting).toBe(0);
    expect(result!.idle).toBe(0);
    expect(result!.error).toBe(0);
  });

  it("aggregates multiple harnesses correctly", () => {
    const ws = makeWorkspace("ws1", [
      makeMockHarnessSurface("h1", "running"),
      makeMockHarnessSurface("h2", "idle"),
      makeMockHarnessSurface("h3", "waiting"),
    ]);
    const result = getAggregatedHarnessStatus(ws)!;
    expect(result.total).toBe(3);
    expect(result.running).toBe(1);
    expect(result.idle).toBe(1);
    expect(result.waiting).toBe(1);
    expect(result.error).toBe(0);
  });

  it("includes terminal agent status in aggregation", () => {
    const ws = makeWorkspace("ws1", [
      makeMockHarnessSurface("h1", "idle"),
      makeMockTerminalSurface("t1", "running"),
    ]);
    const result = getAggregatedHarnessStatus(ws)!;
    expect(result.total).toBe(2);
    expect(result.running).toBe(1);
    expect(result.idle).toBe(1);
  });

  it("ignores terminals without agentStatus", () => {
    const ws = makeWorkspace("ws1", [
      makeMockHarnessSurface("h1", "idle"),
      makeMockTerminalSurface("t1"),
    ]);
    const result = getAggregatedHarnessStatus(ws)!;
    expect(result.total).toBe(1);
  });

  describe("priority ordering", () => {
    it("error takes priority over running", () => {
      const ws = makeWorkspace("ws1", [
        makeMockHarnessSurface("h1", "running"),
        makeMockHarnessSurface("h2", "error"),
      ]);
      expect(getAggregatedHarnessStatus(ws)!.primary).toBe("error");
    });

    it("running takes priority over waiting", () => {
      const ws = makeWorkspace("ws1", [
        makeMockHarnessSurface("h1", "waiting"),
        makeMockHarnessSurface("h2", "running"),
      ]);
      expect(getAggregatedHarnessStatus(ws)!.primary).toBe("running");
    });

    it("waiting takes priority over idle", () => {
      const ws = makeWorkspace("ws1", [
        makeMockHarnessSurface("h1", "idle"),
        makeMockHarnessSurface("h2", "waiting"),
      ]);
      expect(getAggregatedHarnessStatus(ws)!.primary).toBe("waiting");
    });

    it("idle takes priority over exited", () => {
      const ws = makeWorkspace("ws1", [
        makeMockHarnessSurface("h1", "exited"),
        makeMockHarnessSurface("h2", "idle"),
      ]);
      expect(getAggregatedHarnessStatus(ws)!.primary).toBe("idle");
    });

    it("exited is lowest priority", () => {
      const ws = makeWorkspace("ws1", [
        makeMockHarnessSurface("h1", "exited"),
        makeMockHarnessSurface("h2", "exited"),
      ]);
      expect(getAggregatedHarnessStatus(ws)!.primary).toBe("exited");
    });

    it("error > running > waiting > idle > exited across all statuses", () => {
      const ws = makeWorkspace("ws1", [
        makeMockHarnessSurface("h1", "exited"),
        makeMockHarnessSurface("h2", "idle"),
        makeMockHarnessSurface("h3", "waiting"),
        makeMockHarnessSurface("h4", "running"),
        makeMockHarnessSurface("h5", "error"),
      ]);
      const result = getAggregatedHarnessStatus(ws)!;
      expect(result.primary).toBe("error");
      expect(result.total).toBe(5);
      expect(result.error).toBe(1);
      expect(result.running).toBe(1);
      expect(result.waiting).toBe(1);
      expect(result.idle).toBe(1);
    });
  });
});

// --- agentStatusColor ---

describe("agentStatusColor", () => {
  it("returns accent for running", () => {
    expect(agentStatusColor("running", mockTheme)).toBe(mockTheme.accent);
  });

  it("returns warning for waiting", () => {
    expect(agentStatusColor("waiting", mockTheme)).toBe(mockTheme.warning);
  });

  it("returns danger for error", () => {
    expect(agentStatusColor("error", mockTheme)).toBe(mockTheme.danger);
  });

  it("returns fgDim for idle (neutral grey)", () => {
    expect(agentStatusColor("idle", mockTheme)).toBe(mockTheme.fgDim);
  });

  it("returns success for exited (clean exit)", () => {
    expect(agentStatusColor("exited", mockTheme)).toBe(mockTheme.success);
  });
});

// --- agentStatusLabel ---

describe("agentStatusLabel", () => {
  const cases: [AgentStatus, string][] = [
    ["running", "Running"],
    ["waiting", "Waiting"],
    ["error", "Error"],
    ["idle", "Idle"],
    ["exited", "Exited"],
  ];

  it.each(cases)("returns '%s' -> '%s'", (status, label) => {
    expect(agentStatusLabel(status)).toBe(label);
  });
});

// --- getAgentsFromWorkspace ---

describe("getAgentsFromWorkspace", () => {
  it("returns empty array for workspace with no agents", () => {
    const ws = makeWorkspace("ws1", [makeMockTerminalSurface("t1")]);
    expect(getAgentsFromWorkspace(ws)).toEqual([]);
  });

  it("extracts harness surface info", () => {
    const ws = makeWorkspace(
      "ws1",
      [makeMockHarnessSurface("h1", "running", "claude")],
      { projectId: "proj1", branch: "feat/x", name: "Feature X" },
    );
    const agents = getAgentsFromWorkspace(ws);
    expect(agents).toHaveLength(1);
    expect(agents[0]).toEqual({
      surfaceId: "h1",
      presetId: "claude",
      title: "Claude h1",
      status: "running",
      workspaceId: "ws1",
      workspaceName: "Feature X",
      projectId: "proj1",
      branch: "feat/x",
    });
  });

  it("extracts terminal agent info", () => {
    const ws = makeWorkspace("ws1", [makeMockTerminalSurface("t1", "waiting")]);
    const agents = getAgentsFromWorkspace(ws);
    expect(agents).toHaveLength(1);
    expect(agents[0].presetId).toBe("terminal-agent");
    expect(agents[0].status).toBe("waiting");
  });

  it("extracts multiple agents from one workspace", () => {
    const ws = makeWorkspace("ws1", [
      makeMockHarnessSurface("h1", "running"),
      makeMockHarnessSurface("h2", "idle"),
      makeMockTerminalSurface("t1", "error"),
    ]);
    expect(getAgentsFromWorkspace(ws)).toHaveLength(3);
  });

  it("skips terminals without agentStatus", () => {
    const ws = makeWorkspace("ws1", [
      makeMockHarnessSurface("h1", "idle"),
      makeMockTerminalSurface("t1"),
      makeMockTerminalSurface("t2"),
    ]);
    expect(getAgentsFromWorkspace(ws)).toHaveLength(1);
  });
});

// --- getAgentsFromWorkspaces ---

describe("getAgentsFromWorkspaces", () => {
  it("returns empty for empty input", () => {
    expect(getAgentsFromWorkspaces([])).toEqual([]);
  });

  it("aggregates agents across multiple workspaces", () => {
    const ws1 = makeWorkspace(
      "ws1",
      [makeMockHarnessSurface("h1", "running")],
      { projectId: "p1" },
    );
    const ws2 = makeWorkspace(
      "ws2",
      [
        makeMockHarnessSurface("h2", "idle"),
        makeMockHarnessSurface("h3", "waiting"),
      ],
      { projectId: "p2" },
    );
    const ws3 = makeWorkspace("ws3", [makeMockTerminalSurface("t1")]);

    const agents = getAgentsFromWorkspaces([ws1, ws2, ws3]);
    expect(agents).toHaveLength(3);
    expect(agents.map((a) => a.surfaceId)).toEqual(["h1", "h2", "h3"]);
  });

  it("preserves workspace metadata for each agent", () => {
    const ws1 = makeWorkspace(
      "ws1",
      [makeMockHarnessSurface("h1", "running")],
      { projectId: "proj-a", branch: "main", name: "Main" },
    );
    const ws2 = makeWorkspace("ws2", [makeMockHarnessSurface("h2", "idle")], {
      projectId: "proj-b",
      branch: "feat/y",
      name: "Feature Y",
    });

    const agents = getAgentsFromWorkspaces([ws1, ws2]);
    expect(agents[0].projectId).toBe("proj-a");
    expect(agents[0].workspaceName).toBe("Main");
    expect(agents[1].projectId).toBe("proj-b");
    expect(agents[1].branch).toBe("feat/y");
  });
});

// --- agentStatusColor comprehensive ---

describe("agentStatusColor (comprehensive)", () => {
  it("returns correct theme color for each status", () => {
    expect(agentStatusColor("running", mockTheme)).toBe(mockTheme.accent);
    expect(agentStatusColor("waiting", mockTheme)).toBe(mockTheme.warning);
    expect(agentStatusColor("error", mockTheme)).toBe(mockTheme.danger);
    expect(agentStatusColor("idle", mockTheme)).toBe(mockTheme.fgDim);
    expect(agentStatusColor("exited", mockTheme)).toBe(mockTheme.success);
  });

  it("idle returns neutral grey (fgDim), not success green", () => {
    expect(agentStatusColor("idle", mockTheme)).not.toBe(mockTheme.success);
    expect(agentStatusColor("idle", mockTheme)).toBe(mockTheme.fgDim);
  });

  it("exited returns success green (clean exit), not fgDim grey", () => {
    expect(agentStatusColor("exited", mockTheme)).not.toBe(mockTheme.fgDim);
    expect(agentStatusColor("exited", mockTheme)).toBe(mockTheme.success);
  });
});

// --- findNextWaitingAgent ---

describe("findNextWaitingAgent", () => {
  it("returns null when no workspaces exist", () => {
    expect(findNextWaitingAgent([])).toBeNull();
  });

  it("returns null when no agents are waiting", () => {
    const ws1 = makeWorkspace("ws1", [makeMockHarnessSurface("h1", "running")]);
    const ws2 = makeWorkspace("ws2", [makeMockHarnessSurface("h2", "idle")]);
    expect(findNextWaitingAgent([ws1, ws2])).toBeNull();
  });

  it("returns null for workspaces with only plain terminals", () => {
    const ws = makeWorkspace("ws1", [makeMockTerminalSurface("t1")]);
    expect(findNextWaitingAgent([ws])).toBeNull();
  });

  it("finds a waiting harness surface", () => {
    const ws = makeWorkspace("ws1", [
      makeMockHarnessSurface("h1", "running"),
      makeMockHarnessSurface("h2", "waiting"),
    ]);
    const result = findNextWaitingAgent([ws]);
    expect(result).toEqual({ workspaceId: "ws1", surfaceId: "h2" });
  });

  it("finds a waiting terminal agent", () => {
    const ws = makeWorkspace("ws1", [makeMockTerminalSurface("t1", "waiting")]);
    const result = findNextWaitingAgent([ws]);
    expect(result).toEqual({ workspaceId: "ws1", surfaceId: "t1" });
  });

  it("returns the first waiting agent across multiple workspaces", () => {
    const ws1 = makeWorkspace("ws1", [makeMockHarnessSurface("h1", "running")]);
    const ws2 = makeWorkspace("ws2", [makeMockHarnessSurface("h2", "waiting")]);
    const ws3 = makeWorkspace("ws3", [makeMockHarnessSurface("h3", "waiting")]);
    const result = findNextWaitingAgent([ws1, ws2, ws3]);
    expect(result).toEqual({ workspaceId: "ws2", surfaceId: "h2" });
  });

  it("scans surfaces in order within a workspace", () => {
    const ws = makeWorkspace("ws1", [
      makeMockHarnessSurface("h1", "idle"),
      makeMockTerminalSurface("t1", "waiting"),
      makeMockHarnessSurface("h2", "waiting"),
    ]);
    const result = findNextWaitingAgent([ws]);
    // terminal-with-agent comes before the second harness
    expect(result).toEqual({ workspaceId: "ws1", surfaceId: "t1" });
  });
});

// --- resolvePresetName ---

describe("resolvePresetName", () => {
  const harnesses = [
    { id: "claude", name: "Claude Code" },
    { id: "aider", name: "Aider" },
  ];

  it("resolves a known preset by id", () => {
    expect(resolvePresetName("claude", harnesses)).toBe("Claude Code");
  });

  it("resolves a different preset", () => {
    expect(resolvePresetName("aider", harnesses)).toBe("Aider");
  });

  it("falls back to 'Agent' for unknown presetId", () => {
    expect(resolvePresetName("unknown-preset", harnesses)).toBe("Agent");
  });

  it("falls back to 'Agent' when harnesses list is empty", () => {
    expect(resolvePresetName("claude", [])).toBe("Agent");
  });
});

// --- Idle timeout consistency ---

describe("idle timeout default", () => {
  it("DEFAULT_SETTINGS.statusDetection.idleThresholdMs is 10000", async () => {
    const { DEFAULT_SETTINGS } = await import("../lib/settings");
    expect(DEFAULT_SETTINGS.statusDetection.idleThresholdMs).toBe(10000);
  });
});
