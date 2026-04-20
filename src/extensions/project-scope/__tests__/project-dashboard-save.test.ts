/**
 * Regression test: saving or deleting a project must go through
 * project-service.ts so the read → mutate → emit sequence stays
 * consistent. Originally enforced an invariant on the dashboard
 * overlay's wiring; the overlay was removed in P9 (project dashboards
 * are now markdown PreviewSurfaces), so only the service-layer
 * contract remains.
 */
import { describe, it, expect, vi } from "vitest";
import type { ExtensionAPI } from "../../api";
import {
  updateWorkspaceGroup,
  deleteWorkspaceGroup,
  setWorkspaceGroupOrder,
} from "../project-service";
import type { WorkspaceGroupEntry } from "../index";

function makeProject(id: string, name = "P"): WorkspaceGroupEntry {
  return {
    id,
    name,
    path: `/tmp/${id}`,
    color: "red",
    workspaceIds: [],
    isGit: false,
    createdAt: "2025-01-01T00:00:00Z",
  };
}

function makeApiStub(initial: WorkspaceGroupEntry[] = []): {
  api: ExtensionAPI;
  emit: ReturnType<typeof vi.fn>;
  readProjects: () => WorkspaceGroupEntry[];
} {
  const store = new Map<string, unknown>();
  store.set("projects", initial);
  const emit = vi.fn();
  const api = {
    state: {
      get: <T>(key: string): T | undefined => store.get(key) as T | undefined,
      set: (key: string, value: unknown) => store.set(key, value),
    },
    emit,
    // addWorkspaceGroup / deleteWorkspaceGroup mirror into the root-row list; stub
    // the mutators so the test doesn't crash and doesn't care about
    // the order. Core root-row-order is tested separately.
    appendRootRow: vi.fn(),
    removeRootRow: vi.fn(),
  } as unknown as ExtensionAPI;
  return {
    api,
    emit,
    readProjects: () => store.get("projects") as WorkspaceGroupEntry[],
  };
}

describe("project-service mutations", () => {
  it("updateWorkspaceGroup writes the group and emits state-changed with the id", () => {
    const { api, emit, readProjects } = makeApiStub([makeProject("p1", "old")]);
    updateWorkspaceGroup(api, "p1", { name: "new" });
    expect(readProjects()[0].name).toBe("new");
    expect(emit).toHaveBeenCalledWith("extension:project:state-changed", {
      projectId: "p1",
    });
  });

  it("deleteWorkspaceGroup drops the group and emits state-changed", () => {
    const { api, emit, readProjects } = makeApiStub([
      makeProject("p1"),
      makeProject("p2"),
    ]);
    deleteWorkspaceGroup(api, "p1");
    expect(readProjects().map((p) => p.id)).toEqual(["p2"]);
    expect(emit).toHaveBeenCalledWith("extension:project:state-changed", {
      projectId: "p1",
    });
  });

  it("setWorkspaceGroupOrder persists the order and emits state-changed", () => {
    const { api, emit } = makeApiStub();
    setWorkspaceGroupOrder(api, ["b", "a"]);
    expect(api.state.get<string[]>("projectOrder")).toEqual(["b", "a"]);
    expect(emit).toHaveBeenCalledWith("extension:project:state-changed", {});
  });
});
