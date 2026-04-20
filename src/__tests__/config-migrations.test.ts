/**
 * Tests for the config migration scaffold. Covers the empty-table
 * baseline and exercises the forward-upgrade path via the test-only
 * migration registry.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GnarTermConfig } from "../lib/config";
import {
  CURRENT_SCHEMA_VERSION,
  runConfigMigrations,
  __testing__,
} from "../lib/services/config-migrations";

describe("runConfigMigrations — production migration table", () => {
  it("stamps schemaVersion on configs that lack one and applies pending migrations", () => {
    const { migrated, changed, applied } = runConfigMigrations({});
    expect(changed).toBe(true);
    // v1 rewrites agentOrchestrators + extensions map; applying to an
    // empty config still records that the migration ran.
    expect(applied).toEqual([1]);
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("leaves already-stamped configs unchanged", () => {
    const input: GnarTermConfig = { schemaVersion: CURRENT_SCHEMA_VERSION };
    const { migrated, changed, applied } = runConfigMigrations(input);
    expect(changed).toBe(false);
    expect(applied).toEqual([]);
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("preserves unrelated config fields when stamping", () => {
    const input: GnarTermConfig = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      theme: "dark",
      fontSize: 14,
      extensions: { "agentic-orchestrator": { enabled: true } },
    };
    const { migrated } = runConfigMigrations(input);
    expect(migrated.theme).toBe("dark");
    expect(migrated.fontSize).toBe(14);
    expect(migrated.extensions).toEqual({
      "agentic-orchestrator": { enabled: true },
    });
  });

  it("does not mutate the input config", () => {
    const input: GnarTermConfig = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      theme: "light",
    };
    const snapshot = JSON.stringify(input);
    runConfigMigrations(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe("runConfigMigrations — v1 Projects → Workspace Groups", () => {
  it("renames the project-scope extension entry to workspace-groups", () => {
    const { migrated } = runConfigMigrations({
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

  it("prefers an existing workspace-groups entry when both are present", () => {
    const { migrated } = runConfigMigrations({
      extensions: {
        "project-scope": { enabled: true },
        "workspace-groups": { enabled: false, settings: { x: 1 } },
      },
    });
    expect(migrated.extensions).toEqual({
      "workspace-groups": { enabled: false, settings: { x: 1 } },
    });
  });

  it("renames parentProjectId → parentGroupId on every orchestrator", () => {
    const { migrated } = runConfigMigrations({
      agentOrchestrators: [
        {
          id: "o1",
          name: "One",
          baseDir: "/tmp",
          color: "blue",
          path: "/tmp/one.md",
          createdAt: "2026-01-01",
          // Legacy field name — will be renamed.
          parentProjectId: "proj-a",
        } as unknown as NonNullable<
          GnarTermConfig["agentOrchestrators"]
        >[number],
        {
          id: "o2",
          name: "Two",
          baseDir: "/tmp",
          color: "green",
          path: "/tmp/two.md",
          createdAt: "2026-01-02",
        },
      ],
    });
    const [o1, o2] = migrated.agentOrchestrators ?? [];
    expect(o1?.parentGroupId).toBe("proj-a");
    expect("parentProjectId" in (o1 as object)).toBe(false);
    expect(o2?.parentGroupId).toBeUndefined();
  });

  it("does not re-apply v1 to an already-migrated config", () => {
    const input: GnarTermConfig = {
      schemaVersion: 1,
      extensions: { "workspace-groups": { enabled: true } },
      agentOrchestrators: [
        {
          id: "o1",
          name: "One",
          baseDir: "/tmp",
          color: "blue",
          path: "/tmp/one.md",
          createdAt: "2026-01-01",
          parentGroupId: "grp-a",
        },
      ],
    };
    const { migrated, applied, changed } = runConfigMigrations(input);
    expect(applied).toEqual([]);
    expect(changed).toBe(false);
    expect(migrated.extensions).toEqual({
      "workspace-groups": { enabled: true },
    });
    expect(migrated.agentOrchestrators?.[0]?.parentGroupId).toBe("grp-a");
  });
});

describe("runConfigMigrations — with registered migrations", () => {
  beforeEach(() => {
    __testing__.reset();
  });

  afterEach(() => {
    __testing__.reset();
  });

  it("applies a pending migration to a config with no schemaVersion", () => {
    __testing__.registerMigration({
      version: 1,
      description: "add fontFamily default",
      up: (c) => ({ ...c, fontFamily: "Menlo" }),
    });

    const { migrated, changed, applied } = runConfigMigrations({ theme: "x" });
    expect(applied).toEqual([1]);
    expect(changed).toBe(true);
    expect(migrated.fontFamily).toBe("Menlo");
    expect(migrated.schemaVersion).toBe(1);
  });

  it("skips migrations already applied on a stamped config", () => {
    __testing__.registerMigration({
      version: 1,
      description: "no-op test migration",
      up: (c) => ({ ...c, theme: "overwritten" }),
    });

    const { migrated, changed, applied } = runConfigMigrations({
      schemaVersion: 1,
      theme: "preserved",
    });
    expect(applied).toEqual([]);
    expect(changed).toBe(false);
    expect(migrated.theme).toBe("preserved");
  });

  it("applies migrations in version order when multiple are pending", () => {
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

    const { migrated, applied } = runConfigMigrations({});
    expect(applied).toEqual([1, 2]);
    expect(migrated.fontSize).toBe(15);
    expect(migrated.schemaVersion).toBe(2);
  });

  it("only runs migrations above the config's schemaVersion", () => {
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

    const { migrated, applied } = runConfigMigrations({
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
