/**
 * Tests for Pane.intendedAgent — round-trip persistence and detection
 * service fallback behavior.
 *
 * TDD: written before implementation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { get } from "svelte/store";
import type { Pane } from "../lib/types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

vi.mock("../lib/stores/workspace", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/stores/workspace")>();
  const { writable: w, derived: d } = await import("svelte/store");
  const _ws = w([]);
  return {
    ...actual,
    workspaces: _ws,
    activeWorkspaceIdx: w(-1),
    activeWorkspace: d(_ws, () => null),
    activeSurface: w(null),
    activePseudoWorkspaceId: w(null),
    zoomedSurfaceId: w(null),
    workspaceHistory: w([null, null]),
    installSchedulePersist: () => undefined,
    getWorkspace: vi.fn(),
    setWorkspaces: vi.fn(),
    addWorkspace: vi.fn(),
    resetWorkspacesForTest: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Pane type — intendedAgent field
// ---------------------------------------------------------------------------

describe("Pane.intendedAgent type", () => {
  it("Pane can be constructed with intendedAgent undefined", () => {
    const pane: Pane = {
      id: "p-1",
      surfaces: [],
      activeSurfaceId: null,
    };
    expect(pane.intendedAgent).toBeUndefined();
  });

  it("Pane can be constructed with intendedAgent set", () => {
    const pane: Pane = {
      id: "p-2",
      surfaces: [],
      activeSurfaceId: null,
      intendedAgent: "claude",
    };
    expect(pane.intendedAgent).toBe("claude");
  });

  it("intendedAgent accepts all AgentType values", () => {
    const agentTypes = [
      "claude",
      "codex",
      "gemini",
      "goose",
      "aider",
      "opencode",
      "cline",
      "amp",
      "cursor-agent",
      "generic",
    ] as const;

    for (const agentType of agentTypes) {
      const pane: Pane = {
        id: `p-${agentType}`,
        surfaces: [],
        activeSurfaceId: null,
        intendedAgent: agentType,
      };
      expect(pane.intendedAgent).toBe(agentType);
    }
  });
});

// ---------------------------------------------------------------------------
// Serialize → hydrate round-trip for intendedAgent
// ---------------------------------------------------------------------------

describe("intendedAgent serialize → hydrate round-trip", () => {
  it("intendedAgent survives serialize → hydrate when set to 'claude'", async () => {
    const { serializeLayout } = await import("../lib/stores/workspace");
    const { uid } = await import("../lib/types");

    // Construct a pane with intendedAgent = 'claude'
    const pane: Pane = {
      id: uid(),
      surfaces: [],
      activeSurfaceId: null,
      intendedAgent: "claude",
    };

    const splitNode = { type: "pane" as const, pane };
    const serialized = serializeLayout(splitNode);

    // The serialized pane should carry intendedAgent
    expect("pane" in serialized).toBe(true);
    const paneDef = (
      serialized as { pane: { surfaces: unknown[]; intendedAgent?: string } }
    ).pane;
    expect(paneDef.intendedAgent).toBe("claude");
  });

  it("intendedAgent is omitted from serialized form when undefined", async () => {
    const { serializeLayout } = await import("../lib/stores/workspace");
    const { uid } = await import("../lib/types");

    const pane: Pane = {
      id: uid(),
      surfaces: [],
      activeSurfaceId: null,
    };

    const splitNode = { type: "pane" as const, pane };
    const serialized = serializeLayout(splitNode);

    expect("pane" in serialized).toBe(true);
    const paneDef = (
      serialized as { pane: { surfaces: unknown[]; intendedAgent?: string } }
    ).pane;
    expect(paneDef.intendedAgent).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Detection service — intendedAgent fallback
// ---------------------------------------------------------------------------

describe("agent-detection-service — intendedAgent fallback", () => {
  beforeEach(async () => {
    const { resetAgentDetectionForTests } =
      await import("../lib/services/agent-detection-service");
    const { resetOscNotificationStoreForTests } =
      await import("../lib/services/osc-notification-service");
    resetAgentDetectionForTests();
    resetOscNotificationStoreForTests();
    const { workspaces } = await import("../lib/stores/workspace");
    workspaces.set([]);
  });

  afterEach(async () => {
    const { destroyAgentDetection } =
      await import("../lib/services/agent-detection-service");
    destroyAgentDetection();
  });

  it("paneAgentTypeStore reflects intendedAgent when no detection has occurred", async () => {
    const { initAgentDetection, paneAgentTypeStore } =
      await import("../lib/services/agent-detection-service");
    const { workspaces } = await import("../lib/stores/workspace");

    // A pane with intendedAgent = 'codex', no surface title matching
    const ws = {
      id: "ws-intended",
      name: "ws-intended",
      activePaneId: "pane-intended",
      paneLayout: {
        type: "pane" as const,
        pane: {
          id: "pane-intended",
          activeSurfaceId: "surf-intended",
          intendedAgent: "codex" as const,
          surfaces: [
            {
              id: "surf-intended",
              kind: "terminal" as const,
              title: "bash", // no agent pattern match
              cwd: "/tmp",
              ptyId: 99,
              terminal: { dispose: vi.fn(), focus: vi.fn() },
            },
          ],
        },
      },
    };

    workspaces.set([ws]);
    initAgentDetection();

    const storeMap = get(paneAgentTypeStore);
    const entry = storeMap["pane-intended"];

    // Without a detection, the store should reflect intendedAgent
    expect(entry).toBeDefined();
    expect(entry?.agentType).toBe("codex");
  });

  it("argv classification beats intendedAgent heuristic", async () => {
    const { initAgentDetection, paneAgentTypeStore } =
      await import("../lib/services/agent-detection-service");
    const { workspaces } = await import("../lib/stores/workspace");

    // intendedAgent hints 'codex' but startupCommand is 'claude' — argv wins.
    const ws = {
      id: "ws-argv-vs-hint",
      name: "ws-argv-vs-hint",
      activePaneId: "pane-argv-vs-hint",
      paneLayout: {
        type: "pane" as const,
        pane: {
          id: "pane-argv-vs-hint",
          activeSurfaceId: "surf-argv-vs-hint",
          intendedAgent: "codex" as const,
          surfaces: [
            {
              id: "surf-argv-vs-hint",
              kind: "terminal" as const,
              title: "bash",
              cwd: "/tmp",
              ptyId: 201,
              startupCommand: "claude",
              terminal: { dispose: vi.fn(), focus: vi.fn() },
            },
          ],
        },
      },
    };

    workspaces.set([ws]);
    initAgentDetection();

    const entry = get(paneAgentTypeStore)["pane-argv-vs-hint"];
    expect(entry).toBeDefined();
    expect(entry?.agentType).toBe("claude");
    expect(entry?.confidence).toBe("argv");
  });

  it("argv classification recognizes node-wrapped claude-code cli", async () => {
    const { initAgentDetection, paneAgentTypeStore } =
      await import("../lib/services/agent-detection-service");
    const { workspaces } = await import("../lib/stores/workspace");

    const ws = {
      id: "ws-argv-node",
      name: "ws-argv-node",
      activePaneId: "pane-argv-node",
      paneLayout: {
        type: "pane" as const,
        pane: {
          id: "pane-argv-node",
          activeSurfaceId: "surf-argv-node",
          surfaces: [
            {
              id: "surf-argv-node",
              kind: "terminal" as const,
              title: "bash",
              cwd: "/tmp",
              ptyId: 202,
              startupCommand:
                "node node_modules/@anthropic-ai/claude-code/cli.js",
              terminal: { dispose: vi.fn(), focus: vi.fn() },
            },
          ],
        },
      },
    };

    workspaces.set([ws]);
    initAgentDetection();

    const entry = get(paneAgentTypeStore)["pane-argv-node"];
    expect(entry).toBeDefined();
    expect(entry?.agentType).toBe("claude");
    expect(entry?.confidence).toBe("argv");
  });

  it("non-agent startupCommand falls through to intendedAgent heuristic", async () => {
    const { initAgentDetection, paneAgentTypeStore } =
      await import("../lib/services/agent-detection-service");
    const { workspaces } = await import("../lib/stores/workspace");

    const ws = {
      id: "ws-argv-fallthrough",
      name: "ws-argv-fallthrough",
      activePaneId: "pane-argv-fallthrough",
      paneLayout: {
        type: "pane" as const,
        pane: {
          id: "pane-argv-fallthrough",
          activeSurfaceId: "surf-argv-fallthrough",
          intendedAgent: "codex" as const,
          surfaces: [
            {
              id: "surf-argv-fallthrough",
              kind: "terminal" as const,
              title: "bash",
              cwd: "/tmp",
              ptyId: 203,
              startupCommand: "ls -la",
              terminal: { dispose: vi.fn(), focus: vi.fn() },
            },
          ],
        },
      },
    };

    workspaces.set([ws]);
    initAgentDetection();

    const entry = get(paneAgentTypeStore)["pane-argv-fallthrough"];
    expect(entry).toBeDefined();
    expect(entry?.agentType).toBe("codex");
    expect(entry?.confidence).toBe("heuristic");
  });

  it("definedCommand is used when startupCommand is absent", async () => {
    const { initAgentDetection, paneAgentTypeStore } =
      await import("../lib/services/agent-detection-service");
    const { workspaces } = await import("../lib/stores/workspace");

    const ws = {
      id: "ws-argv-defined",
      name: "ws-argv-defined",
      activePaneId: "pane-argv-defined",
      paneLayout: {
        type: "pane" as const,
        pane: {
          id: "pane-argv-defined",
          activeSurfaceId: "surf-argv-defined",
          surfaces: [
            {
              id: "surf-argv-defined",
              kind: "terminal" as const,
              title: "bash",
              cwd: "/tmp",
              ptyId: 204,
              definedCommand: "aider",
              terminal: { dispose: vi.fn(), focus: vi.fn() },
            },
          ],
        },
      },
    };

    workspaces.set([ws]);
    initAgentDetection();

    const entry = get(paneAgentTypeStore)["pane-argv-defined"];
    expect(entry).toBeDefined();
    expect(entry?.agentType).toBe("aider");
    expect(entry?.confidence).toBe("argv");
  });

  it("confirmed detection takes priority over intendedAgent", async () => {
    const { initAgentDetection, paneAgentTypeStore } =
      await import("../lib/services/agent-detection-service");
    const { eventBus } = await import("../lib/services/event-bus");
    const { workspaces } = await import("../lib/stores/workspace");

    // A pane with intendedAgent = 'codex', but surface title is 'claude'
    const ws = {
      id: "ws-priority",
      name: "ws-priority",
      activePaneId: "pane-priority",
      paneLayout: {
        type: "pane" as const,
        pane: {
          id: "pane-priority",
          activeSurfaceId: "surf-priority",
          intendedAgent: "codex" as const,
          surfaces: [
            {
              id: "surf-priority",
              kind: "terminal" as const,
              title: "claude", // matches detection pattern for 'claude'
              cwd: "/tmp",
              ptyId: 100,
              terminal: { dispose: vi.fn(), focus: vi.fn() },
            },
          ],
        },
      },
    };

    workspaces.set([ws]);
    initAgentDetection();

    // Trigger detection via title change
    eventBus.emit({
      type: "surface:titleChanged",
      id: "surf-priority",
      oldTitle: "bash",
      newTitle: "claude",
    });

    const storeMap = get(paneAgentTypeStore);
    const entry = storeMap["pane-priority"];

    // Confirmed detection (title match for 'claude') should win
    expect(entry).toBeDefined();
    expect(entry?.agentType).toBe("claude");
  });
});
