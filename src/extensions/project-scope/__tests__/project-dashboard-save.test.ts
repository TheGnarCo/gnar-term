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
  updateProject,
  deleteProject,
  setProjectOrder,
} from "../project-service";
import type { ProjectEntry } from "../index";

function makeProject(id: string, name = "P"): ProjectEntry {
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

function makeApiStub(initial: ProjectEntry[] = []): {
  api: ExtensionAPI;
  emit: ReturnType<typeof vi.fn>;
  readProjects: () => ProjectEntry[];
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
    // addProject / deleteProject mirror into the root-row list; stub
    // the mutators so the test doesn't crash and doesn't care about
    // the order. Core root-row-order is tested separately.
    appendRootRow: vi.fn(),
    removeRootRow: vi.fn(),
  } as unknown as ExtensionAPI;
  return {
    api,
    emit,
    readProjects: () => store.get("projects") as ProjectEntry[],
  };
}

describe("project-service mutations", () => {
  it("updateProject writes projects and emits state-changed with the id", () => {
    const { api, emit, readProjects } = makeApiStub([makeProject("p1", "old")]);
    updateProject(api, "p1", { name: "new" });
    expect(readProjects()[0].name).toBe("new");
    expect(emit).toHaveBeenCalledWith("extension:project:state-changed", {
      projectId: "p1",
    });
  });

  it("deleteProject drops the project and emits state-changed", () => {
    const { api, emit, readProjects } = makeApiStub([
      makeProject("p1"),
      makeProject("p2"),
    ]);
    deleteProject(api, "p1");
    expect(readProjects().map((p) => p.id)).toEqual(["p2"]);
    expect(emit).toHaveBeenCalledWith("extension:project:state-changed", {
      projectId: "p1",
    });
  });

  it("setProjectOrder persists the order and emits state-changed", () => {
    const { api, emit } = makeApiStub();
    setProjectOrder(api, ["b", "a"]);
    expect(api.state.get<string[]>("projectOrder")).toEqual(["b", "a"]);
    expect(emit).toHaveBeenCalledWith("extension:project:state-changed", {});
  });
});
