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

describe("runConfigMigrations — empty migration table", () => {
  it("stamps schemaVersion on configs that lack one", () => {
    const { migrated, changed, applied } = runConfigMigrations({});
    expect(changed).toBe(true);
    expect(applied).toEqual([]);
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
    const input: GnarTermConfig = { theme: "light" };
    const snapshot = JSON.stringify(input);
    runConfigMigrations(input);
    expect(JSON.stringify(input)).toBe(snapshot);
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
