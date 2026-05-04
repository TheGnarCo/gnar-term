/**
 * migrateWorkspaceDashboardWidgets — rewrites project-dashboard.md files
 * that predate the gnar:workspaces widget.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (p: string) => p,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import { invoke } from "@tauri-apps/api/core";
import { migrateWorkspaceDashboardWidgets } from "../lib/services/workspace-service";
import type { Workspace } from "../lib/config";

function makeWorkspace(): Workspace {
  return {
    id: "g1",
    name: "My Project",
    path: "/tmp/my-project",
    color: "purple",
    nestedWorkspaceIds: [],
    isGit: false,
    createdAt: "2026-04-28T00:00:00.000Z",
  };
}

describe("migrateWorkspaceDashboardWidgets", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("inserts gnar:workspaces before gnar:columns, preserving existing content", async () => {
    const original =
      "# My Project\n\nCustom intro.\n\n```gnar:columns\nchildren:\n  - name: custom\n```\n";
    (invoke as ReturnType<typeof vi.fn>).mockImplementation(
      async (cmd: string) => {
        if (cmd === "file_exists") return true;
        if (cmd === "read_file") return original;
        return undefined;
      },
    );

    await migrateWorkspaceDashboardWidgets(
      makeWorkspace(),
      "/tmp/my-project/.gnar-term/project-dashboard.md",
    );

    const writeCalls = (invoke as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[0] === "write_file",
    );
    expect(writeCalls).toHaveLength(1);
    const written: string = writeCalls[0][1].content;
    expect(written).toContain("gnar:workspaces");
    // gnar:workspaces appears before gnar:columns
    expect(written.indexOf("gnar:workspaces")).toBeLessThan(
      written.indexOf("gnar:columns"),
    );
    // custom user content survives
    expect(written).toContain("Custom intro.");
    expect(written).toContain("- name: custom");
    // path is correct
    expect(writeCalls[0][1].path).toBe(
      "/tmp/my-project/.gnar-term/project-dashboard.md",
    );
  });

  it("skips the rewrite when the file already contains gnar:workspaces", async () => {
    (invoke as ReturnType<typeof vi.fn>).mockImplementation(
      async (cmd: string) => {
        if (cmd === "file_exists") return true;
        if (cmd === "read_file")
          return "# My Project\n\n```gnar:workspaces\n```\n\n```gnar:columns\n```\n";
        return undefined;
      },
    );

    await migrateWorkspaceDashboardWidgets(
      makeWorkspace(),
      "/tmp/my-project/.gnar-term/project-dashboard.md",
    );

    const writeCalls = (invoke as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[0] === "write_file",
    );
    expect(writeCalls).toHaveLength(0);
  });

  it("skips the rewrite when the file does not exist", async () => {
    (invoke as ReturnType<typeof vi.fn>).mockImplementation(
      async (cmd: string) => {
        if (cmd === "file_exists") return false;
        return undefined;
      },
    );

    await migrateWorkspaceDashboardWidgets(
      makeWorkspace(),
      "/tmp/my-project/.gnar-term/project-dashboard.md",
    );

    const writeCalls = (invoke as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[0] === "write_file",
    );
    expect(writeCalls).toHaveLength(0);
  });
});
