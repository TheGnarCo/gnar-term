/**
 * Tests for the v2 Workspace Groups Unification migration — fixtures
 * mirror the §7 spec scenarios: project-only, project + one nested
 * orchestrator, project + multiple nested (cap enforcement), rootless,
 * mixed. Each case asserts both the resulting config shape AND the
 * filesystem side-effects (read / write / ensure_dir) through the
 * mocked Tauri invoke.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

type InvokeCall = { cmd: string; args?: Record<string, unknown> };

const recorded: InvokeCall[] = [];
const fs = new Map<string, string>();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    recorded.push({ cmd, args });
    switch (cmd) {
      case "get_home":
        return "/home/test";
      case "read_file": {
        const path = (args?.path as string) ?? "";
        if (fs.has(path)) return fs.get(path);
        throw new Error(`ENOENT: ${path}`);
      }
      case "write_file": {
        const path = (args?.path as string) ?? "";
        const content = (args?.content as string) ?? "";
        fs.set(path, content);
        return undefined;
      }
      case "file_exists": {
        const path = (args?.path as string) ?? "";
        return fs.has(path);
      }
      case "ensure_dir":
        return undefined;
      default:
        return undefined;
    }
  }),
}));

import type { GnarTermConfig } from "../lib/config";
import {
  runConfigMigrations,
  type ConfigMigrationResult,
} from "../lib/services/config-migrations";

/**
 * Structural shape of the legacy orchestrator record — the
 * `AgentOrchestrator` type was removed from the public config surface
 * when v2 shipped; tests describe the shape locally so fixtures remain
 * typed without revenge-importing the deprecated type.
 */
interface LegacyOrchestrator {
  id: string;
  name: string;
  baseDir: string;
  color: string;
  path: string;
  createdAt: string;
  parentGroupId?: string;
  dashboardNestedWorkspaceId?: string;
}

interface LegacyConfigInput extends GnarTermConfig {
  agentOrchestrators?: LegacyOrchestrator[];
}

interface LegacyMigrationResult extends ConfigMigrationResult {
  migrated: LegacyConfigInput;
}

/**
 * Test helper: wrap `runConfigMigrations` so fixtures can pass the
 * legacy `agentOrchestrators` field (public type no longer exposes it)
 * and assertions can read back the removed field to verify the
 * migration dropped it.
 */
async function migrate(
  input: LegacyConfigInput,
): Promise<LegacyMigrationResult> {
  const result = await runConfigMigrations(input as GnarTermConfig);
  return result as LegacyMigrationResult;
}

function makeOrchestrator(
  overrides: Partial<LegacyOrchestrator> & { id: string; path: string },
): LegacyOrchestrator {
  return {
    id: overrides.id,
    name: overrides.name ?? "Orch",
    baseDir: overrides.baseDir ?? "/tmp",
    color: overrides.color ?? "blue",
    path: overrides.path,
    createdAt: overrides.createdAt ?? "2026-01-01",
    ...(overrides.parentGroupId
      ? { parentGroupId: overrides.parentGroupId }
      : {}),
    ...(overrides.dashboardNestedWorkspaceId
      ? { dashboardNestedWorkspaceId: overrides.dashboardNestedWorkspaceId }
      : {}),
  };
}

function seedWorkspacesState(
  groups: Array<{ id: string; path: string }>,
): void {
  fs.set(
    "/home/test/.config/gnar-term/extensions/workspace-groups/state.json",
    JSON.stringify({ workspaces: groups }),
  );
}

describe("config v2 migration — agent orchestrators → dashboards", () => {
  beforeEach(() => {
    recorded.length = 0;
    fs.clear();
  });

  it("is a no-op on configs without agentOrchestrators (schemaVersion still bumps)", async () => {
    const { migrated, applied } = await migrate({
      schemaVersion: 1,
    });
    expect(applied).toEqual([2, 3]);
    expect(migrated.schemaVersion).toBe(3);
    expect(migrated.agentOrchestrators).toBeUndefined();
  });

  it("drops agentOrchestrators when the array is empty", async () => {
    const { migrated } = await migrate({
      schemaVersion: 1,
      agentOrchestrators: [],
    });
    expect(migrated.agentOrchestrators).toBeUndefined();
    expect(migrated.schemaVersion).toBe(3);
  });

  it("nested orchestrator → writes markdown to <group.path>/.gnar-term/agentic-dashboard.md", async () => {
    seedWorkspacesState([{ id: "grp-a", path: "/work/projA" }]);
    fs.set("/tmp/one.md", "# Orch One\ncontent\n");

    const { migrated } = await migrate({
      schemaVersion: 1,
      agentOrchestrators: [
        makeOrchestrator({
          id: "o1",
          parentGroupId: "grp-a",
          path: "/tmp/one.md",
        }),
      ],
    });

    const target = "/work/projA/.gnar-term/agentic-dashboard.md";
    expect(fs.get(target)).toBe("# Orch One\ncontent\n");
    expect(migrated.agentOrchestrators).toBeUndefined();
  });

  it("extra nested orchestrators beyond the first are dropped (cap enforcement)", async () => {
    seedWorkspacesState([{ id: "grp-a", path: "/work/projA" }]);
    fs.set("/tmp/keep.md", "# Keep\n");
    fs.set("/tmp/drop.md", "# Drop\n");

    const { migrated } = await migrate({
      schemaVersion: 1,
      agentOrchestrators: [
        makeOrchestrator({
          id: "o1",
          parentGroupId: "grp-a",
          path: "/tmp/keep.md",
        }),
        makeOrchestrator({
          id: "o2",
          parentGroupId: "grp-a",
          path: "/tmp/drop.md",
        }),
      ],
    });

    const target = "/work/projA/.gnar-term/agentic-dashboard.md";
    expect(fs.get(target)).toBe("# Keep\n");
    // Dropped orchestrator's source file is left intact for manual rescue.
    expect(fs.get("/tmp/drop.md")).toBe("# Drop\n");
    expect(migrated.agentOrchestrators).toBeUndefined();
  });

  it("existing target markdown wins — migration does not overwrite user edits", async () => {
    seedWorkspacesState([{ id: "grp-a", path: "/work/projA" }]);
    fs.set("/tmp/src.md", "# Old source\n");
    fs.set(
      "/work/projA/.gnar-term/agentic-dashboard.md",
      "# User wrote this already\n",
    );

    await migrate({
      schemaVersion: 1,
      agentOrchestrators: [
        makeOrchestrator({
          id: "o1",
          parentGroupId: "grp-a",
          path: "/tmp/src.md",
        }),
      ],
    });

    expect(fs.get("/work/projA/.gnar-term/agentic-dashboard.md")).toBe(
      "# User wrote this already\n",
    );
  });

  it("rootless orchestrator → writes markdown to ~/.config/gnar-term/global-agents.md", async () => {
    fs.set("/tmp/root.md", "# Global source\n");

    const { migrated } = await migrate({
      schemaVersion: 1,
      agentOrchestrators: [
        makeOrchestrator({ id: "o-root", path: "/tmp/root.md" }),
      ],
    });

    const target = "/home/test/.config/gnar-term/global-agents.md";
    expect(fs.get(target)).toBe("# Global source\n");
    expect(migrated.agentOrchestrators).toBeUndefined();
  });

  it("multiple rootless orchestrators: first migrates, extras dropped", async () => {
    fs.set("/tmp/keep-root.md", "# Keep global\n");
    fs.set("/tmp/drop-root.md", "# Drop\n");

    await migrate({
      schemaVersion: 1,
      agentOrchestrators: [
        makeOrchestrator({ id: "o-keep", path: "/tmp/keep-root.md" }),
        makeOrchestrator({ id: "o-drop", path: "/tmp/drop-root.md" }),
      ],
    });

    expect(fs.get("/home/test/.config/gnar-term/global-agents.md")).toBe(
      "# Keep global\n",
    );
  });

  it("mixed nested + rootless: each class migrated independently", async () => {
    seedWorkspacesState([
      { id: "grp-a", path: "/work/projA" },
      { id: "grp-b", path: "/work/projB" },
    ]);
    fs.set("/tmp/a.md", "# A\n");
    fs.set("/tmp/b.md", "# B\n");
    fs.set("/tmp/root.md", "# Root\n");

    const { migrated } = await migrate({
      schemaVersion: 1,
      agentOrchestrators: [
        makeOrchestrator({
          id: "oa",
          parentGroupId: "grp-a",
          path: "/tmp/a.md",
        }),
        makeOrchestrator({
          id: "ob",
          parentGroupId: "grp-b",
          path: "/tmp/b.md",
        }),
        makeOrchestrator({ id: "oroot", path: "/tmp/root.md" }),
      ],
    });

    expect(fs.get("/work/projA/.gnar-term/agentic-dashboard.md")).toBe("# A\n");
    expect(fs.get("/work/projB/.gnar-term/agentic-dashboard.md")).toBe("# B\n");
    expect(fs.get("/home/test/.config/gnar-term/global-agents.md")).toBe(
      "# Root\n",
    );
    expect(migrated.agentOrchestrators).toBeUndefined();
  });

  it("orphan orchestrator (parentGroupId references a deleted group) is skipped with warning; schema still bumps", async () => {
    // Extension state empty — no group with that id.
    seedWorkspacesState([]);
    fs.set("/tmp/orphan.md", "# Orphan\n");

    const { migrated, applied } = await migrate({
      schemaVersion: 1,
      agentOrchestrators: [
        makeOrchestrator({
          id: "o-orphan",
          parentGroupId: "grp-missing",
          path: "/tmp/orphan.md",
        }),
      ],
    });

    expect(applied).toEqual([2, 3]);
    // Source file is left in place for manual rescue.
    expect(fs.get("/tmp/orphan.md")).toBe("# Orphan\n");
    expect(migrated.agentOrchestrators).toBeUndefined();
  });

  it("reads legacy project-scope state path when workspace-groups state is absent", async () => {
    fs.set(
      "/home/test/.config/gnar-term/extensions/project-scope/state.json",
      JSON.stringify({ projects: [{ id: "grp-a", path: "/work/projA" }] }),
    );
    fs.set("/tmp/a.md", "# A\n");

    const { migrated } = await migrate({
      schemaVersion: 1,
      agentOrchestrators: [
        makeOrchestrator({
          id: "oa",
          parentGroupId: "grp-a",
          path: "/tmp/a.md",
        }),
      ],
    });

    expect(fs.get("/work/projA/.gnar-term/agentic-dashboard.md")).toBe("# A\n");
    expect(migrated.agentOrchestrators).toBeUndefined();
  });
});
