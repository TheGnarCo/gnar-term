/**
 * Tests for rootRailBotStatus — pure aggregator that decides which
 * rail hat (none / thinking / attention) a Root workspace's rail
 * should paint. The hat renders at every sidebar width.
 */
import { describe, it, expect } from "vitest";
import { rootRailBotStatus } from "../lib/services/rail-attention";
import type { DetectedAgent } from "../lib/services/agent-detection-service";
import type { RootWorkspace } from "../lib/config";

function makeAgent(overrides: Partial<DetectedAgent> = {}): DetectedAgent {
  const now = new Date().toISOString();
  return {
    agentId: "agent-1",
    agentName: "Claude Code",
    surfaceId: "surface-1",
    workspaceId: "ws-1",
    status: "running",
    createdAt: now,
    lastStatusChange: now,
    ...overrides,
  };
}

function makeRoot(
  id: string,
  branchedWorkspaceIds: string[] = [],
): RootWorkspace {
  return {
    id,
    name: id,
    color: "#aaa",
    path: "/tmp",
    branchedWorkspaceIds,
    isGit: false,
    createdAt: new Date().toISOString(),
  };
}

describe("rootRailBotStatus", () => {
  it("returns 'none' when there are no agents", () => {
    expect(rootRailBotStatus(makeRoot("root-1"), [])).toBe("none");
  });

  it("returns 'none' when no agent is in this Root or its branches", () => {
    const root = makeRoot("root-1", ["br-1"]);
    const agents = [makeAgent({ workspaceId: "other", status: "waiting" })];
    expect(rootRailBotStatus(root, agents)).toBe("none");
  });

  it("returns 'attention' when the Root itself has a waiting agent", () => {
    const root = makeRoot("root-1");
    const agents = [makeAgent({ workspaceId: "root-1", status: "waiting" })];
    expect(rootRailBotStatus(root, agents)).toBe("attention");
  });

  it("returns 'attention' when a branch has a waiting agent", () => {
    const root = makeRoot("root-1", ["br-1", "br-2"]);
    const agents = [makeAgent({ workspaceId: "br-2", status: "waiting" })];
    expect(rootRailBotStatus(root, agents)).toBe("attention");
  });

  it("returns 'thinking' when an agent is running but none is waiting", () => {
    const root = makeRoot("root-1", ["br-1"]);
    const agents = [makeAgent({ workspaceId: "root-1", status: "running" })];
    expect(rootRailBotStatus(root, agents)).toBe("thinking");
  });

  it("returns 'thinking' when an agent is active but none is waiting", () => {
    const root = makeRoot("root-1");
    const agents = [makeAgent({ workspaceId: "root-1", status: "active" })];
    expect(rootRailBotStatus(root, agents)).toBe("thinking");
  });

  it("returns 'attention' when at least one waits, even alongside running", () => {
    const root = makeRoot("root-1", ["br-1"]);
    const agents = [
      makeAgent({ workspaceId: "root-1", status: "running" }),
      makeAgent({ workspaceId: "br-1", status: "waiting" }),
    ];
    expect(rootRailBotStatus(root, agents)).toBe("attention");
  });

  it("returns 'idle' when every present agent is idle/done", () => {
    const root = makeRoot("root-1", ["br-1"]);
    const agents = [
      makeAgent({ workspaceId: "root-1", status: "idle" }),
      makeAgent({ workspaceId: "br-1", status: "done" }),
    ];
    expect(rootRailBotStatus(root, agents)).toBe("idle");
  });

  it("ignores 'closed' agents (the process is gone, no hat)", () => {
    const root = makeRoot("root-1", ["br-1"]);
    const agents = [
      makeAgent({ workspaceId: "root-1", status: "closed" }),
      makeAgent({ workspaceId: "br-1", status: "closed" }),
    ];
    expect(rootRailBotStatus(root, agents)).toBe("none");
  });

  it("returns 'idle' over 'none' when at least one agent is still attached", () => {
    const root = makeRoot("root-1", ["br-1"]);
    const agents = [
      makeAgent({ workspaceId: "root-1", status: "idle" }),
      makeAgent({ workspaceId: "br-1", status: "closed" }),
    ];
    expect(rootRailBotStatus(root, agents)).toBe("idle");
  });

  it("'thinking' wins over 'idle' co-presence", () => {
    const root = makeRoot("root-1", ["br-1"]);
    const agents = [
      makeAgent({ workspaceId: "root-1", status: "idle" }),
      makeAgent({ workspaceId: "br-1", status: "running" }),
    ];
    expect(rootRailBotStatus(root, agents)).toBe("thinking");
  });
});
