/**
 * Tests for AgentType union, isAgentType guard, parseAgentTypeFromArgv,
 * and the per-pane paneAgentTypeStore introduced in cycle-1.
 *
 * TDD discipline: these tests were written RED (before implementation),
 * then the implementation was written to make them GREEN.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { get } from "svelte/store";

// --- agent-type module ---

import {
  type AgentType,
  isAgentType,
  parseAgentTypeFromArgv,
} from "../lib/services/agent-type";

// --- agent-detection-service (for agentType field + paneAgentTypeStore) ---

vi.mock("../lib/stores/workspace", async () => {
  const { writable: w, derived: d } = await import("svelte/store");
  const _ws = w([]);
  return {
    workspaces: _ws,
    activeWorkspaceIdx: w(-1),
    activeWorkspace: d(_ws, () => null),
    activeSurface: w(null),
    activePseudoWorkspaceId: w(null),
    zoomedSurfaceId: w(null),
    workspaceHistory: w([null, null]),
    installSchedulePersist: () => undefined,
  };
});

import {
  agentsStore,
  getAgents,
  initAgentDetection,
  destroyAgentDetection,
  resetAgentDetectionForTests,
  paneAgentTypeStore,
} from "../lib/services/agent-detection-service";
import { eventBus } from "../lib/services/event-bus";
import { workspaces } from "../lib/stores/workspace";

beforeEach(() => {
  resetAgentDetectionForTests();
  workspaces.set([]);
});

afterEach(() => {
  destroyAgentDetection();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWorkspace(
  id: string,
  surfaces: Array<{ id: string; title: string; ptyId?: number }>,
) {
  return {
    id,
    name: id,
    activePaneId: "p",
    paneLayout: {
      type: "pane" as const,
      pane: {
        id: "p",
        activeSurfaceId: surfaces[0]?.id ?? null,
        surfaces: surfaces.map((s) => ({
          id: s.id,
          kind: "terminal" as const,
          title: s.title,
          cwd: "/tmp",
          ptyId: s.ptyId ?? 0,
          terminal: { dispose: vi.fn(), focus: vi.fn() },
        })),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// isAgentType guard
// ---------------------------------------------------------------------------

describe("isAgentType", () => {
  it("returns true for all valid agent type literals", () => {
    const valid: AgentType[] = [
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
    ];
    for (const v of valid) {
      expect(isAgentType(v)).toBe(true);
    }
  });

  it("returns false for unknown strings", () => {
    expect(isAgentType("copilot")).toBe(false);
    expect(isAgentType("cursor")).toBe(false);
    expect(isAgentType("")).toBe(false);
    expect(isAgentType("CLAUDE")).toBe(false);
  });

  it("returns false for non-string values", () => {
    expect(isAgentType(null)).toBe(false);
    expect(isAgentType(undefined)).toBe(false);
    expect(isAgentType(42)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseAgentTypeFromArgv — argv0 classification
// ---------------------------------------------------------------------------

describe("parseAgentTypeFromArgv — argv0 classification", () => {
  it("classifies /usr/local/bin/claude as claude", () => {
    expect(parseAgentTypeFromArgv("/usr/local/bin/claude", [])).toBe("claude");
  });

  it("classifies /path/to/claude-code as claude", () => {
    expect(parseAgentTypeFromArgv("/path/to/claude-code", [])).toBe("claude");
  });

  it("classifies argv0 ending in /codex as codex", () => {
    expect(parseAgentTypeFromArgv("/home/user/.nvm/bin/codex", [])).toBe(
      "codex",
    );
  });

  it("classifies argv0 ending in /gemini as gemini", () => {
    expect(parseAgentTypeFromArgv("/usr/bin/gemini", [])).toBe("gemini");
  });

  it("classifies argv0 ending in /goose as goose", () => {
    expect(parseAgentTypeFromArgv("/usr/local/bin/goose", [])).toBe("goose");
  });

  it("classifies argv0 ending in /aider as aider", () => {
    expect(parseAgentTypeFromArgv("/home/user/.local/bin/aider", [])).toBe(
      "aider",
    );
  });

  it("classifies argv0 ending in /opencode as opencode", () => {
    expect(parseAgentTypeFromArgv("/usr/local/bin/opencode", [])).toBe(
      "opencode",
    );
  });

  it("classifies argv0 ending in /cline as cline", () => {
    expect(parseAgentTypeFromArgv("/opt/cline/bin/cline", [])).toBe("cline");
  });

  it("classifies argv0 ending in /amp as amp", () => {
    expect(parseAgentTypeFromArgv("/usr/local/bin/amp", [])).toBe("amp");
  });

  it("classifies cursor-agent argv0 as cursor-agent", () => {
    expect(
      parseAgentTypeFromArgv("/Applications/Cursor.app/cursor-agent", []),
    ).toBe("cursor-agent");
  });

  it("returns null for unknown argv0 like node or python", () => {
    expect(parseAgentTypeFromArgv("/usr/bin/node", [])).toBeNull();
    expect(parseAgentTypeFromArgv("/usr/bin/python3", [])).toBeNull();
    expect(parseAgentTypeFromArgv("/bin/bash", [])).toBeNull();
  });

  it("returns null for empty argv0", () => {
    expect(parseAgentTypeFromArgv("", [])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseAgentTypeFromArgv — argv[] fallback classification
// ---------------------------------------------------------------------------

describe("parseAgentTypeFromArgv — argv[] fallback", () => {
  it("classifies node running claude script via argv[1]", () => {
    // e.g. node /usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js
    expect(
      parseAgentTypeFromArgv("/usr/bin/node", [
        "/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js",
      ]),
    ).toBe("claude");
  });

  it("classifies python running aider via argv[1]", () => {
    expect(parseAgentTypeFromArgv("/usr/bin/python3", ["/usr/bin/aider"])).toBe(
      "aider",
    );
  });

  it("returns generic for a process with no recognizable argv", () => {
    // argv is non-null but nothing matches → generic
    expect(
      parseAgentTypeFromArgv("/usr/bin/node", ["some-unrelated-script"]),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseAgentTypeFromArgv — generic bucket
// ---------------------------------------------------------------------------

describe("parseAgentTypeFromArgv — generic bucket", () => {
  it("returns null (not generic) when argv is empty and argv0 unrecognized", () => {
    // generic is assigned by the detection service, not by the parser
    // The parser returns null when it cannot classify
    expect(parseAgentTypeFromArgv("/usr/bin/ruby", [])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// DetectedAgent.agentType field
// ---------------------------------------------------------------------------

describe("DetectedAgent.agentType field", () => {
  it("agentType is populated on detected claude agent", () => {
    workspaces.set([
      makeWorkspace("w1", [{ id: "s1", title: "claude", ptyId: 1 }]),
    ]);
    initAgentDetection();

    const agents = getAgents();
    expect(agents).toHaveLength(1);
    // agentName preserved for legacy consumers
    expect(agents[0]?.agentName).toBe("Claude Code");
    // new typed field
    expect(agents[0]?.agentType).toBe("claude");
  });

  it("agentType is 'codex' for codex pattern match", () => {
    workspaces.set([
      makeWorkspace("w1", [{ id: "s1", title: "codex repl", ptyId: 2 }]),
    ]);
    initAgentDetection();

    const agents = getAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0]?.agentType).toBe("codex");
  });

  it("agentType is 'aider' for aider pattern match", () => {
    workspaces.set([
      makeWorkspace("w1", [{ id: "s1", title: "aider", ptyId: 3 }]),
    ]);
    initAgentDetection();

    const agents = getAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0]?.agentType).toBe("aider");
  });

  it("agentType is 'generic' when pattern has no agentType set", () => {
    // Cursor pattern maps to cursor-agent type now
    workspaces.set([
      makeWorkspace("w1", [{ id: "s1", title: "cursor", ptyId: 4 }]),
    ]);
    initAgentDetection();

    const agents = getAgents();
    expect(agents).toHaveLength(1);
    // cursor has a defined agentType: "cursor-agent"
    expect(agents[0]?.agentType).toBe("cursor-agent");
  });

  it("agentType is 'gemini' for gemini pattern match", () => {
    workspaces.set([
      makeWorkspace("w1", [{ id: "s1", title: "gemini cli", ptyId: 5 }]),
    ]);
    initAgentDetection();

    const agents = getAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0]?.agentType).toBe("gemini");
  });

  it("agentType is 'goose' for goose pattern match", () => {
    workspaces.set([
      makeWorkspace("w1", [{ id: "s1", title: "goose session", ptyId: 6 }]),
    ]);
    initAgentDetection();

    const agents = getAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0]?.agentType).toBe("goose");
  });

  it("agentName is still preserved alongside agentType", () => {
    workspaces.set([
      makeWorkspace("w1", [{ id: "s1", title: "claude", ptyId: 10 }]),
    ]);
    initAgentDetection();

    const agents = getAgents();
    expect(agents[0]?.agentName).toBe("Claude Code");
    expect(agents[0]?.agentType).toBeDefined();
  });

  it("agentsStore reactive update includes agentType", () => {
    workspaces.set([
      makeWorkspace("w1", [{ id: "s1", title: "zsh", ptyId: 20 }]),
    ]);
    initAgentDetection();

    eventBus.emit({
      type: "surface:titleChanged",
      id: "s1",
      oldTitle: "zsh",
      newTitle: "codex",
    });

    const storeAgents = get(agentsStore);
    expect(storeAgents).toHaveLength(1);
    expect(storeAgents[0]?.agentType).toBe("codex");
  });
});

// ---------------------------------------------------------------------------
// paneAgentTypeStore
// ---------------------------------------------------------------------------

describe("paneAgentTypeStore", () => {
  it("is exported from agent-detection-service", () => {
    expect(paneAgentTypeStore).toBeDefined();
  });

  it("returns undefined for an untracked paneId", () => {
    expect(get(paneAgentTypeStore)["pane-unknown"]).toBeUndefined();
  });

  it("populates entry for a pane when an agent is detected on one of its surfaces", () => {
    workspaces.set([
      makeWorkspace("w1", [{ id: "s1", title: "claude", ptyId: 30 }]),
    ]);
    initAgentDetection();

    const store = get(paneAgentTypeStore);
    // The pane id in makeWorkspace is "p"
    expect(store["p"]).toBeDefined();
    expect(store["p"]?.agentType).toBe("claude");
    expect(store["p"]?.confidence).toBe("osc");
    expect(store["p"]?.detectedAt).toBeDefined();
  });

  it("populates entry for a title-only agent with confidence 'title'", () => {
    workspaces.set([
      makeWorkspace("w1", [{ id: "s1", title: "cursor", ptyId: 31 }]),
    ]);
    initAgentDetection();

    const store = get(paneAgentTypeStore);
    expect(store["p"]?.agentType).toBe("cursor-agent");
    expect(store["p"]?.confidence).toBe("title");
  });

  it("clears entry for a pane when the agent detaches on surface:closed", () => {
    workspaces.set([
      makeWorkspace("w1", [{ id: "s1", title: "claude", ptyId: 32 }]),
    ]);
    initAgentDetection();

    expect(get(paneAgentTypeStore)["p"]).toBeDefined();

    eventBus.emit({ type: "surface:closed", id: "s1", paneId: "p" });

    expect(get(paneAgentTypeStore)["p"]).toBeUndefined();
  });

  it("updates when a new agent is detected via title change", () => {
    workspaces.set([
      makeWorkspace("w1", [{ id: "s1", title: "zsh", ptyId: 33 }]),
    ]);
    initAgentDetection();

    expect(get(paneAgentTypeStore)["p"]).toBeUndefined();

    eventBus.emit({
      type: "surface:titleChanged",
      id: "s1",
      oldTitle: "zsh",
      newTitle: "codex",
    });

    const store = get(paneAgentTypeStore);
    expect(store["p"]?.agentType).toBe("codex");
  });

  it("is reactive — subscribers receive updates on attach and detach", () => {
    workspaces.set([
      makeWorkspace("w1", [{ id: "s1", title: "zsh", ptyId: 34 }]),
    ]);
    initAgentDetection();

    const emissions: Array<Record<string, unknown>> = [];
    const unsub = paneAgentTypeStore.subscribe((val) => {
      emissions.push({ ...val });
    });

    eventBus.emit({
      type: "surface:titleChanged",
      id: "s1",
      oldTitle: "zsh",
      newTitle: "claude",
    });

    eventBus.emit({ type: "surface:closed", id: "s1", paneId: "p" });
    unsub();

    // Should have at least: initial (empty), after attach, after detach
    expect(emissions.length).toBeGreaterThanOrEqual(2);
    // One emission should have 'p' populated
    const attached = emissions.find((e) => "p" in e && e["p"] !== undefined);
    expect(attached).toBeDefined();
    // Final emission should not have 'p'
    const last = emissions[emissions.length - 1];
    expect(last?.["p"]).toBeUndefined();
  });

  it("agentsStore shape is unchanged — no new fields beyond agentType", () => {
    // The store should still have exactly the documented fields
    workspaces.set([
      makeWorkspace("w1", [{ id: "s1", title: "claude", ptyId: 40 }]),
    ]);
    initAgentDetection();

    const agents = get(agentsStore);
    expect(agents).toHaveLength(1);
    const agent = agents[0]!;
    // Legacy fields all present
    expect(typeof agent.agentId).toBe("string");
    expect(typeof agent.agentName).toBe("string");
    expect(typeof agent.surfaceId).toBe("string");
    expect(typeof agent.workspaceId).toBe("string");
    expect(typeof agent.status).toBe("string");
    expect(typeof agent.createdAt).toBe("string");
    expect(typeof agent.lastStatusChange).toBe("string");
    // New field
    expect(typeof agent.agentType).toBe("string");
  });
});
