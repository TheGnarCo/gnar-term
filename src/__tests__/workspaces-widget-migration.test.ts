/**
 * migrateGroupDashboardWidgets — rewrites project-dashboard.md files
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
import { migrateGroupDashboardWidgets } from "../lib/services/workspace-group-service";
import type { WorkspaceGroupEntry } from "../lib/config";

function makeGroup(): WorkspaceGroupEntry {
  return {
    id: "g1",
    name: "My Project",
    path: "/tmp/my-project",
    color: "purple",
    workspaceIds: [],
    isGit: false,
    createdAt: "2026-04-28T00:00:00.000Z",
  };
}

describe("migrateGroupDashboardWidgets", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("rewrites the file when it exists and lacks gnar:workspaces", async () => {
    (invoke as ReturnType<typeof vi.fn>).mockImplementation(
      async (cmd: string) => {
        if (cmd === "file_exists") return true;
        if (cmd === "read_file")
          return "# My Project\n\n```gnar:columns\nchildren:\n```\n";
        return undefined;
      },
    );

    await migrateGroupDashboardWidgets(
      makeGroup(),
      "/tmp/my-project/.gnar-term/project-dashboard.md",
    );

    const writeCalls = (invoke as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[0] === "write_file",
    );
    expect(writeCalls).toHaveLength(1);
    expect(writeCalls[0][1].content).toContain("gnar:workspaces");
    expect(writeCalls[0][1].content).toContain("gnar:columns");
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

    await migrateGroupDashboardWidgets(
      makeGroup(),
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

    await migrateGroupDashboardWidgets(
      makeGroup(),
      "/tmp/my-project/.gnar-term/project-dashboard.md",
    );

    const writeCalls = (invoke as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[0] === "write_file",
    );
    expect(writeCalls).toHaveLength(0);
  });
});
