/**
 * Tests for rootNeedsRailAttention — pure aggregator that decides
 * whether a Root workspace's collapsed-mode rail should paint the
 * "needs attention" hat.
 */
import { describe, it, expect } from "vitest";
import { rootNeedsRailAttention } from "../lib/services/rail-attention";
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

describe("rootNeedsRailAttention", () => {
  it("returns false when there are no agents", () => {
    const root = makeRoot("root-1");
    expect(rootNeedsRailAttention(root, [])).toBe(false);
  });

  it("returns false when no agent is in this Root or its branches", () => {
    const root = makeRoot("root-1", ["br-1"]);
    const agents = [makeAgent({ workspaceId: "other", status: "waiting" })];
    expect(rootNeedsRailAttention(root, agents)).toBe(false);
  });

  it("returns true when the Root itself has a waiting agent", () => {
    const root = makeRoot("root-1");
    const agents = [makeAgent({ workspaceId: "root-1", status: "waiting" })];
    expect(rootNeedsRailAttention(root, agents)).toBe(true);
  });

  it("returns true when a branch has a waiting agent", () => {
    const root = makeRoot("root-1", ["br-1", "br-2"]);
    const agents = [makeAgent({ workspaceId: "br-2", status: "waiting" })];
    expect(rootNeedsRailAttention(root, agents)).toBe(true);
  });

  it("returns false when agents are running/idle/active but none waiting", () => {
    const root = makeRoot("root-1", ["br-1"]);
    const agents = [
      makeAgent({ workspaceId: "root-1", status: "running" }),
      makeAgent({ workspaceId: "br-1", status: "idle" }),
      makeAgent({ workspaceId: "br-1", status: "active" }),
    ];
    expect(rootNeedsRailAttention(root, agents)).toBe(false);
  });

  it("returns true when at least one agent waits, even if others are running", () => {
    const root = makeRoot("root-1", ["br-1"]);
    const agents = [
      makeAgent({ workspaceId: "root-1", status: "running" }),
      makeAgent({ workspaceId: "br-1", status: "waiting" }),
    ];
    expect(rootNeedsRailAttention(root, agents)).toBe(true);
  });

  it("ignores closed agents (consistency with buildAgentRows)", () => {
    const root = makeRoot("root-1");
    const agents = [makeAgent({ workspaceId: "root-1", status: "closed" })];
    expect(rootNeedsRailAttention(root, agents)).toBe(false);
  });
});
