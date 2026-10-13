/**
 * Default workspace naming — "Workspace N" must never collide with an
 * existing workspace after a rename or close in the middle of the list.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { get } from "svelte/store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/terminal-service", () => ({
  createTerminalSurface: vi.fn(async (pane: any, cwd?: string) => {
    const surface = {
      kind: "terminal",
      id: `s-${Math.random()}`,
      ptyId: -1,
      cwd,
      title: "",
      terminal: { dispose: vi.fn(), focus: vi.fn() },
      hasUnread: false,
    };
    pane.surfaces.push(surface);
    pane.activeSurfaceId = surface.id;
    return surface;
  }),
}));
vi.mock("../preview/index", () => ({ openPreview: vi.fn() }));

import { workspaces, activeWorkspaceIdx } from "../lib/stores/workspace";
import {
  createWorkspaceFromDef,
  closeWorkspace,
  renameWorkspace,
  nextWorkspaceName,
} from "../lib/services/workspace-service";

const names = () => get(workspaces).map((w) => w.name);

describe("nextWorkspaceName", () => {
  it("starts at Workspace 1 when there are no workspaces", () => {
    expect(nextWorkspaceName([])).toBe("Workspace 1");
  });

  it("uses one past the highest default-pattern number, not the list length", () => {
    expect(
      nextWorkspaceName([{ name: "Workspace 1" }, { name: "Workspace 3" }]),
    ).toBe("Workspace 4");
    expect(nextWorkspaceName([{ name: "Workspace 7" }])).toBe("Workspace 8");
  });

  it("ignores names that don't follow the default pattern", () => {
    expect(
      nextWorkspaceName([{ name: "gnar-term-dev" }, { name: "Workspace 2" }]),
    ).toBe("Workspace 3");
    expect(
      nextWorkspaceName([
        { name: "gnar-term-dev" },
        { name: "Workspace 2b" },
        { name: "My Workspace 9" },
      ]),
    ).toBe("Workspace 1");
  });

  it("does not re-use a number whose workspace was closed", () => {
    expect(
      nextWorkspaceName([{ name: "Workspace 1" }, { name: "Workspace 2" }]),
    ).toBe("Workspace 3");
    expect(nextWorkspaceName([{ name: "Workspace 2" }])).toBe("Workspace 3");
  });
});

describe("createWorkspaceFromDef default name (#124)", () => {
  beforeEach(() => {
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
  });

  it("does not duplicate a name after closing a workspace in the middle", async () => {
    await createWorkspaceFromDef({});
    await createWorkspaceFromDef({});
    await createWorkspaceFromDef({});
    expect(names()).toEqual(["Workspace 1", "Workspace 2", "Workspace 3"]);

    closeWorkspace(1);
    await createWorkspaceFromDef({});

    expect(names()).toEqual(["Workspace 1", "Workspace 3", "Workspace 4"]);
    expect(new Set(names()).size).toBe(names().length);
  });

  it("does not duplicate a name after renaming and closing", async () => {
    await createWorkspaceFromDef({});
    await createWorkspaceFromDef({});
    await createWorkspaceFromDef({});
    renameWorkspace(0, "gnar-term-dev");
    closeWorkspace(1);
    await createWorkspaceFromDef({});
    await createWorkspaceFromDef({});

    expect(names()).toEqual([
      "gnar-term-dev",
      "Workspace 3",
      "Workspace 4",
      "Workspace 5",
    ]);
    expect(new Set(names()).size).toBe(names().length);
  });

  it("keeps an explicit name from the definition", async () => {
    await createWorkspaceFromDef({});
    await createWorkspaceFromDef({ name: "api-server" });
    await createWorkspaceFromDef({});
    expect(names()).toEqual(["Workspace 1", "api-server", "Workspace 2"]);
  });
});

describe("App.svelte new-workspace entry points (#124)", () => {
  it("name new workspaces with nextWorkspaceName, not the list length", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/App.svelte", "utf-8");
    expect(source).not.toContain("$workspaces.length + 1");
    // palette action, macOS Cmd+N, Cmd/Ctrl+Shift+N, sidebar new-workspace button
    expect(
      source.match(/createWorkspace\(nextWorkspaceName\(\$workspaces\)\)/g),
    ).toHaveLength(4);
  });
});
