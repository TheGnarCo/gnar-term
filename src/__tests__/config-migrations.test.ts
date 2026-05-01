/**
 * Tests for the config migration scaffold. Covers the empty-table
 * baseline and exercises the forward-upgrade path via the test-only
 * migration registry.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// v2 migration calls Tauri invoke for get_home + file I/O. Stub it so
// the test doesn't have to boot the Tauri harness; we only care about
// config-shape transforms here, not the on-disk side-effects.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === "get_home") return "/home/test";
    if (cmd === "file_exists") return false;
    // `read_file` for missing paths throws; `ensure_dir` / `write_file`
    // no-op. Left as-is so v2 logs the "source missing" path.
    if (cmd === "read_file") throw new Error("ENOENT");
    return undefined;
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));
import type { GnarTermConfig } from "../lib/config";
import {
  CURRENT_SCHEMA_VERSION,
  runConfigMigrations,
  __testing__,
} from "../lib/services/config-migrations";

describe("runConfigMigrations — production migration table", () => {
  it("stamps schemaVersion on configs that lack one and applies pending migrations", async () => {
    const { migrated, changed, applied } = await runConfigMigrations({});
    expect(changed).toBe(true);
    // v1 rewrites the extensions map + orchestrator parent field; v2
    // collapses agentOrchestrators into dashboards; v3 flattens the
    // archive shape. All run on an unstamped config.
    expect(applied).toEqual([1, 2, 3]);
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("leaves already-stamped configs unchanged", async () => {
    const input: GnarTermConfig = { schemaVersion: CURRENT_SCHEMA_VERSION };
    const { migrated, changed, applied } = await runConfigMigrations(input);
    expect(changed).toBe(false);
    expect(applied).toEqual([]);
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("preserves unrelated config fields when stamping", async () => {
    const input: GnarTermConfig = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      theme: "dark",
      fontSize: 14,
      extensions: { "agentic-orchestrator": { enabled: true } },
    };
    const { migrated } = await runConfigMigrations(input);
    expect(migrated.theme).toBe("dark");
    expect(migrated.fontSize).toBe(14);
    expect(migrated.extensions).toEqual({
      "agentic-orchestrator": { enabled: true },
    });
  });

  it("does not mutate the input config", async () => {
    const input: GnarTermConfig = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      theme: "light",
    };
    const snapshot = JSON.stringify(input);
    await runConfigMigrations(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe("runConfigMigrations — v1 Projects → Workspace Groups", () => {
  it("renames the project-scope extension entry to workspace-groups", async () => {
    const { migrated } = await runConfigMigrations({
      extensions: {
        "project-scope": { enabled: true, settings: { anchor: "top" } },
        "agentic-orchestrator": { enabled: false },
      },
    });
    expect(migrated.extensions).toEqual({
      "workspace-groups": { enabled: true, settings: { anchor: "top" } },
      "agentic-orchestrator": { enabled: false },
    });
  });

  it("prefers an existing workspace-groups entry when both are present", async () => {
    const { migrated } = await runConfigMigrations({
      extensions: {
        "project-scope": { enabled: true },
        "workspace-groups": { enabled: false, settings: { x: 1 } },
      },
    });
    expect(migrated.extensions).toEqual({
      "workspace-groups": { enabled: false, settings: { x: 1 } },
    });
  });

  // v1's parentProjectId → parentGroupId rewrite on agentOrchestrators
  // is no longer observable post-v2 because v2 removes the field
  // entirely. Coverage for v1's extensions-map rename lives above; the
  // orchestrator-field rename lives in the v1 migration's source +
  // exercised transitively by the v2 scenarios in
  // config-migrations-v2.test.ts.

  it("re-running after every migration has landed is a no-op", async () => {
    const input: GnarTermConfig = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      extensions: { "workspace-groups": { enabled: true } },
    };
    const { migrated, applied, changed } = await runConfigMigrations(input);
    expect(applied).toEqual([]);
    expect(changed).toBe(false);
    expect(migrated.extensions).toEqual({
      "workspace-groups": { enabled: true },
    });
  });
});

describe("runConfigMigrations — with registered migrations", () => {
  beforeEach(() => {
    __testing__.reset();
  });

  afterEach(() => {
    __testing__.reset();
  });

  it("applies a pending migration to a config with no schemaVersion", async () => {
    __testing__.registerMigration({
      version: 1,
      description: "add fontFamily default",
      up: (c) => ({ ...c, fontFamily: "Menlo" }),
    });

    const { migrated, changed, applied } = await runConfigMigrations({
      theme: "x",
    });
    expect(applied).toEqual([1]);
    expect(changed).toBe(true);
    expect(migrated.fontFamily).toBe("Menlo");
    expect(migrated.schemaVersion).toBe(1);
  });

  it("skips migrations already applied on a stamped config", async () => {
    __testing__.registerMigration({
      version: 1,
      description: "no-op test migration",
      up: (c) => ({ ...c, theme: "overwritten" }),
    });

    const { migrated, changed, applied } = await runConfigMigrations({
      schemaVersion: 1,
      theme: "preserved",
    });
    expect(applied).toEqual([]);
    expect(changed).toBe(false);
    expect(migrated.theme).toBe("preserved");
  });

  it("applies migrations in version order when multiple are pending", async () => {
    __testing__.registerMigration({
      version: 2,
      description: "second",
      up: (c) => ({ ...c, fontSize: (c.fontSize ?? 0) + 10 }),
    });
    __testing__.registerMigration({
      version: 1,
      description: "first",
      up: (c) => ({ ...c, fontSize: 5 }),
    });

    const { migrated, applied } = await runConfigMigrations({});
    expect(applied).toEqual([1, 2]);
    expect(migrated.fontSize).toBe(15);
    expect(migrated.schemaVersion).toBe(2);
  });

  it("only runs migrations above the config's schemaVersion", async () => {
    __testing__.registerMigration({
      version: 1,
      description: "already applied",
      up: (c) => ({ ...c, fontSize: 999 }),
    });
    __testing__.registerMigration({
      version: 2,
      description: "pending",
      up: (c) => ({ ...c, theme: "upgraded" }),
    });

    const { migrated, applied } = await runConfigMigrations({
      schemaVersion: 1,
      fontSize: 14,
      theme: "orig",
    });
    expect(applied).toEqual([2]);
    expect(migrated.fontSize).toBe(14);
    expect(migrated.theme).toBe("upgraded");
    expect(migrated.schemaVersion).toBe(2);
  });
});
