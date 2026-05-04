/**
 * Tests for buildAgentRows — the pure data transformation that maps
 * raw agent + workspace store values into displayable sidebar rows.
 */
import { describe, it, expect } from "vitest";
import { buildAgentRows } from "../lib/services/agents-sidebar";
import type { DetectedAgent } from "../lib/services/agent-detection-service";
import type { NestedWorkspace } from "../lib/types";
import type { Workspace } from "../lib/config";

// --- Helpers ---

function makeAgent(overrides: Partial<DetectedAgent> = {}): DetectedAgent {
  const now = new Date().toISOString();
  return {
    agentId: "agent-1",
    agentName: "Claude Code",
    surfaceId: "surface-1",
    workspaceId: "nws-1",
    status: "running",
    createdAt: now,
    lastStatusChange: now,
    ...overrides,
  };
}

function makeNestedWorkspace(
  id: string,
  name: string,
  parentWorkspaceId?: string,
): NestedWorkspace {
  return {
    id,
    name,
    splitRoot: {
      type: "pane",
      pane: { id: "pane-1", surfaces: [], activeSurfaceId: null },
    },
    activePaneId: "pane-1",
    metadata: parentWorkspaceId ? { parentWorkspaceId } : undefined,
  };
}

function makeWorkspace(id: string, name: string): Workspace {
  return {
    id,
    name,
    color: "#aaa",
    path: "/tmp",
    nestedWorkspaceIds: [],
  };
}

// --- Tests ---

describe("buildAgentRows", () => {
  it("filters out agents with status 'closed'", () => {
    const agents = [
      makeAgent({ agentId: "a1", status: "running" }),
      makeAgent({ agentId: "a2", status: "closed" }),
      makeAgent({ agentId: "a3", status: "waiting" }),
    ];
    const rows = buildAgentRows(agents, [], []);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.agentId)).toEqual(["a1", "a3"]);
  });

  it("correctly joins agent data with nested workspace name", () => {
    const nws = makeNestedWorkspace("nws-1", "my-feature");
    const agent = makeAgent({ workspaceId: "nws-1" });
    const rows = buildAgentRows([agent], [nws], []);
    expect(rows).toHaveLength(1);
    expect(rows[0].ctxName).toBe("my-feature");
  });

  it("correctly joins with parent workspace / project name", () => {
    const nws = makeNestedWorkspace("nws-1", "feature-branch", "ws-parent");
    const parent = makeWorkspace("ws-parent", "MyProject");
    const agent = makeAgent({ workspaceId: "nws-1" });
    const rows = buildAgentRows([agent], [nws], [parent]);
    expect(rows[0].projectName).toBe("MyProject");
  });

  it("returns wsIdx = -1 when the workspace is not found", () => {
    const agent = makeAgent({ workspaceId: "nws-missing" });
    const rows = buildAgentRows([agent], [], []);
    expect(rows).toHaveLength(1);
    expect(rows[0].wsIdx).toBe(-1);
    expect(rows[0].ctxName).toBe("Unknown Branch");
    expect(rows[0].projectName).toBe("Unknown Project");
  });
});
