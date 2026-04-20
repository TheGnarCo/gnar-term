/**
 * Tests for `openOrchestratorDashboard` — the thin activation call that
 * switches to an orchestrator's Dashboard workspace. Under the new
 * model, the Dashboard workspace is created eagerly by
 * `createOrchestrator`; opening is just a switch.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === "get_home") return "/home/test";
    return undefined;
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

vi.mock("../../../lib/stores/workspace", async () => {
  const { writable } = await import("svelte/store");
  return {
    workspaces: writable<Array<Record<string, unknown>>>([]),
    activePane: writable<{ id: string } | null>({ id: "pane-active" }),
    activeWorkspaceIdx: writable<number>(-1),
  };
});

vi.mock("../../../lib/services/workspace-service", () => ({
  createWorkspaceFromDef: vi.fn().mockResolvedValue("ws-new"),
  closeWorkspace: vi.fn(),
}));

import type { AgentOrchestrator } from "../../../lib/config";
import {
  openOrchestratorDashboard,
  findOrchestratorDashboardWorkspace,
  ORCHESTRATOR_WORKSPACE_META_KEY,
} from "../orchestrator-service";
import { workspaces, activeWorkspaceIdx } from "../../../lib/stores/workspace";

const fixture: AgentOrchestrator = {
  id: "o-1",
  name: "Sample",
  baseDir: "/work/proj",
  color: "purple",
  path: "/home/test/.config/gnar-term/orchestrators/o-1.md",
  createdAt: "2026-04-19T00:00:00.000Z",
  dashboardWorkspaceId: "ws-dash",
};

function setWorkspaces(list: Array<Record<string, unknown>>) {
  (workspaces as unknown as { set: (v: unknown) => void }).set(list);
}

describe("openOrchestratorDashboard", () => {
  beforeEach(() => {
    setWorkspaces([]);
    (activeWorkspaceIdx as unknown as { set: (v: number) => void }).set(-1);
  });

  it("switches to the Dashboard workspace when it exists", () => {
    setWorkspaces([
      { id: "ws-other", metadata: {} },
      {
        id: "ws-dash",
        metadata: { [ORCHESTRATOR_WORKSPACE_META_KEY]: fixture.id },
      },
    ]);

    const ok = openOrchestratorDashboard(fixture);

    expect(ok).toBe(true);
    expect(get(activeWorkspaceIdx)).toBe(1);
  });

  it("returns false when no Dashboard workspace exists for the orchestrator", () => {
    setWorkspaces([{ id: "ws-unrelated", metadata: {} }]);

    const ok = openOrchestratorDashboard(fixture);

    expect(ok).toBe(false);
  });
});

describe("findOrchestratorDashboardWorkspace", () => {
  beforeEach(() => {
    setWorkspaces([]);
  });

  it("resolves the workspace tagged with ORCHESTRATOR_WORKSPACE_META_KEY", () => {
    setWorkspaces([
      {
        id: "ws-dash",
        metadata: { [ORCHESTRATOR_WORKSPACE_META_KEY]: "o-1" },
      },
    ]);
    expect(findOrchestratorDashboardWorkspace("o-1")?.id).toBe("ws-dash");
    expect(findOrchestratorDashboardWorkspace("o-missing")).toBeUndefined();
  });
});
