/**
 * Tests for rootRailBotStatus — pure aggregator that decides which
 * rail hat (none / thinking / attention / idle) a Root workspace's
 * rail should paint. The hat renders at every sidebar width.
 */
import { describe, it, expect } from "vitest";
import { rootRailBotStatus } from "../lib/services/rail-attention";
import type { DetectedAgent } from "../lib/services/agent-detection-service";
import type { AttentionEvent } from "../lib/services/attention-api";
import type { RootWorkspace } from "../lib/config";

const NO_EVENTS: AttentionEvent[] = [];
const NO_PANES = new Map<string, string[]>();

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
    expect(rootRailBotStatus(makeRoot("root-1"), [], NO_EVENTS, NO_PANES)).toBe(
      "none",
    );
  });

  it("returns 'none' when no agent is in this Root or its branches", () => {
    const root = makeRoot("root-1", ["br-1"]);
    const agents = [makeAgent({ workspaceId: "other", status: "waiting" })];
    expect(rootRailBotStatus(root, agents, NO_EVENTS, NO_PANES)).toBe("none");
  });

  it("returns 'attention' when the Root itself has a waiting agent", () => {
    const root = makeRoot("root-1");
    const agents = [makeAgent({ workspaceId: "root-1", status: "waiting" })];
    expect(rootRailBotStatus(root, agents, NO_EVENTS, NO_PANES)).toBe(
      "attention",
    );
  });

  it("returns 'attention' when a branch has a waiting agent", () => {
    const root = makeRoot("root-1", ["br-1", "br-2"]);
    const agents = [makeAgent({ workspaceId: "br-2", status: "waiting" })];
    expect(rootRailBotStatus(root, agents, NO_EVENTS, NO_PANES)).toBe(
      "attention",
    );
  });

  it("returns 'thinking' when an agent is running but none is waiting", () => {
    const root = makeRoot("root-1", ["br-1"]);
    const agents = [makeAgent({ workspaceId: "root-1", status: "running" })];
    expect(rootRailBotStatus(root, agents, NO_EVENTS, NO_PANES)).toBe(
      "thinking",
    );
  });

  it("returns 'thinking' when an agent is active but none is waiting", () => {
    const root = makeRoot("root-1");
    const agents = [makeAgent({ workspaceId: "root-1", status: "active" })];
    expect(rootRailBotStatus(root, agents, NO_EVENTS, NO_PANES)).toBe(
      "thinking",
    );
  });

  it("returns 'attention' when at least one waits, even alongside running", () => {
    const root = makeRoot("root-1", ["br-1"]);
    const agents = [
      makeAgent({ workspaceId: "root-1", status: "running" }),
      makeAgent({ workspaceId: "br-1", status: "waiting" }),
    ];
    expect(rootRailBotStatus(root, agents, NO_EVENTS, NO_PANES)).toBe(
      "attention",
    );
  });

  it("returns 'idle' when every present agent is idle/done", () => {
    const root = makeRoot("root-1", ["br-1"]);
    const agents = [
      makeAgent({ workspaceId: "root-1", status: "idle" }),
      makeAgent({ workspaceId: "br-1", status: "done" }),
    ];
    expect(rootRailBotStatus(root, agents, NO_EVENTS, NO_PANES)).toBe("idle");
  });

  it("ignores 'closed' agents (the process is gone, no hat)", () => {
    const root = makeRoot("root-1", ["br-1"]);
    const agents = [
      makeAgent({ workspaceId: "root-1", status: "closed" }),
      makeAgent({ workspaceId: "br-1", status: "closed" }),
    ];
    expect(rootRailBotStatus(root, agents, NO_EVENTS, NO_PANES)).toBe("none");
  });

  it("returns 'idle' over 'none' when at least one agent is still attached", () => {
    const root = makeRoot("root-1", ["br-1"]);
    const agents = [
      makeAgent({ workspaceId: "root-1", status: "idle" }),
      makeAgent({ workspaceId: "br-1", status: "closed" }),
    ];
    expect(rootRailBotStatus(root, agents, NO_EVENTS, NO_PANES)).toBe("idle");
  });

  it("'thinking' wins over 'idle' co-presence", () => {
    const root = makeRoot("root-1", ["br-1"]);
    const agents = [
      makeAgent({ workspaceId: "root-1", status: "idle" }),
      makeAgent({ workspaceId: "br-1", status: "running" }),
    ];
    expect(rootRailBotStatus(root, agents, NO_EVENTS, NO_PANES)).toBe(
      "thinking",
    );
  });
});

function makeAttention(
  overrides: Partial<AttentionEvent> = {},
): AttentionEvent {
  return {
    paneId: "p-1",
    kind: "awaiting_input",
    source: "osc",
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("rootRailBotStatus (attention events)", () => {
  it("returns 'attention' when an in-scope pane has an awaiting_input event", () => {
    const root = makeRoot("root-1", ["br-1"]);
    const paneIdsByWorkspaceId = new Map<string, string[]>([
      ["root-1", ["p-root"]],
      ["br-1", ["p-branch"]],
    ]);
    const events: AttentionEvent[] = [
      makeAttention({ paneId: "p-branch", kind: "awaiting_input" }),
    ];

    expect(rootRailBotStatus(root, [], events, paneIdsByWorkspaceId)).toBe(
      "attention",
    );
  });

  it("returns 'attention' for errored and notify in-scope events", () => {
    const root = makeRoot("root-1", []);
    const paneIdsByWorkspaceId = new Map<string, string[]>([
      ["root-1", ["p-root"]],
    ]);
    expect(
      rootRailBotStatus(
        root,
        [],
        [makeAttention({ paneId: "p-root", kind: "errored" })],
        paneIdsByWorkspaceId,
      ),
    ).toBe("attention");
    expect(
      rootRailBotStatus(
        root,
        [],
        [makeAttention({ paneId: "p-root", kind: "notify" })],
        paneIdsByWorkspaceId,
      ),
    ).toBe("attention");
  });

  it("ignores out-of-scope attention events", () => {
    const root = makeRoot("root-1", ["br-1"]);
    const paneIdsByWorkspaceId = new Map<string, string[]>([
      ["root-1", ["p-root"]],
      ["br-1", ["p-branch"]],
    ]);
    const events: AttentionEvent[] = [
      makeAttention({ paneId: "p-elsewhere", kind: "awaiting_input" }),
    ];

    expect(rootRailBotStatus(root, [], events, paneIdsByWorkspaceId)).toBe(
      "none",
    );
  });

  it("falls back to agent status when no attention event is in scope", () => {
    const root = makeRoot("root-1", []);
    const paneIdsByWorkspaceId = new Map<string, string[]>([
      ["root-1", ["p-root"]],
    ]);
    const agents = [makeAgent({ workspaceId: "root-1", status: "running" })];

    expect(rootRailBotStatus(root, agents, [], paneIdsByWorkspaceId)).toBe(
      "thinking",
    );
  });

  it("attention beats thinking when both are present", () => {
    const root = makeRoot("root-1", []);
    const paneIdsByWorkspaceId = new Map<string, string[]>([
      ["root-1", ["p-root"]],
    ]);
    const agents = [makeAgent({ workspaceId: "root-1", status: "running" })];
    const events: AttentionEvent[] = [
      makeAttention({ paneId: "p-root", kind: "awaiting_input" }),
    ];

    expect(rootRailBotStatus(root, agents, events, paneIdsByWorkspaceId)).toBe(
      "attention",
    );
  });

  it("'completed' and 'progress' events do not trigger attention", () => {
    const root = makeRoot("root-1", []);
    const paneIdsByWorkspaceId = new Map<string, string[]>([
      ["root-1", ["p-root"]],
    ]);
    const agents = [makeAgent({ workspaceId: "root-1", status: "idle" })];

    expect(
      rootRailBotStatus(
        root,
        agents,
        [makeAttention({ paneId: "p-root", kind: "completed" })],
        paneIdsByWorkspaceId,
      ),
    ).toBe("idle");
    expect(
      rootRailBotStatus(
        root,
        agents,
        [makeAttention({ paneId: "p-root", kind: "progress" })],
        paneIdsByWorkspaceId,
      ),
    ).toBe("idle");
  });
});
