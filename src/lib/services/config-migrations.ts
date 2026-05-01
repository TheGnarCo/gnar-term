/**
 * Config schema migrations — versioned, forward-only transforms that
 * rewrite persisted `GnarTermConfig` shape as the project evolves.
 *
 * A migration runs exactly once per config: after it applies, the
 * config's `schemaVersion` records the highest migration it has seen.
 * Loaders call `runConfigMigrations` right after parsing; the scaffold
 * returns `{ changed }` so the loader can persist the migrated form.
 *
 * New migrations append to MIGRATIONS with a monotonic `version`. Never
 * rewrite or delete existing entries — every migration must remain a
 * faithful description of the v(n-1) → v(n) transform so old configs
 * still upgrade cleanly.
 */
import type { GnarTermConfig } from "../config";
import { migrateV2WorkspaceGroupsUnification } from "./migrations/v2-workspace-groups-unification";
import { migrateV3ArchiveShape } from "./migrations/v3-archive-shape";

/**
 * Structural shape for legacy fields that have been removed from the
 * public `GnarTermConfig` but can still appear on persisted configs
 * from older releases. Migrations reach for these through a cast; no
 * runtime code outside the migration pipeline should depend on them.
 */
interface LegacyConfigShape extends GnarTermConfig {
  agentOrchestrators?: Array<Record<string, unknown>>;
}

interface ConfigMigration {
  /** Target schemaVersion this migration produces. Strictly increasing. */
  version: number;
  /** Short human-readable description of what the migration changes. */
  description: string;
  /**
   * Apply the transform. Must not mutate `config` in place — return the
   * next shape. Must be idempotent in practice (applied once per bump).
   * May be async — v2+ migrations perform file I/O (moving markdown
   * files, writing to `~/.config/gnar-term/global-agents.md`) because
   * user data on disk has to land in the new layout for the migrated
   * config shape to mean anything.
   */
  up: (config: GnarTermConfig) => GnarTermConfig | Promise<GnarTermConfig>;
}

/**
 * Registered migrations, ordered by `version` ascending. Append new
 * entries; never reorder or rewrite existing ones.
 */
const MIGRATIONS: ConfigMigration[] = [
  {
    version: 1,
    description:
      "rename Projects → Workspace Groups (extension id + orchestrator parent field)",
    up: (config) => {
      const next: Record<string, unknown> = { ...config };

      // Extension id rename: project-scope → workspace-groups. Preserve
      // the extension's enabled/settings shape verbatim.
      const exts = config.extensions;
      if (exts && "project-scope" in exts) {
        const { "project-scope": legacy, ...rest } = exts;
        next.extensions = {
          ...rest,
          // If both keys coexist (shouldn't in practice), prefer the
          // already-migrated entry — user may have hand-edited the new
          // key before we first loaded the config.
          "workspace-groups": rest["workspace-groups"] ?? legacy,
        };
      }

      // Orchestrator field rename: parentProjectId → parentGroupId. The
      // field was already renamed in-code by this release; this covers
      // configs written by the previous release.
      const orchestrators = (config as LegacyConfigShape).agentOrchestrators;
      if (Array.isArray(orchestrators)) {
        next.agentOrchestrators = orchestrators.map((o) => {
          if (!("parentProjectId" in o)) return o;
          const { parentProjectId, ...rest } = o;
          // If a new field already exists, preserve it; otherwise adopt
          // the legacy one. Empty/undefined legacy is dropped.
          const preserved =
            rest.parentGroupId ??
            (parentProjectId === undefined ? undefined : parentProjectId);
          return {
            ...rest,
            ...(preserved !== undefined ? { parentGroupId: preserved } : {}),
          };
        });
      }

      return next as GnarTermConfig;
    },
  },
  {
    version: 2,
    description:
      "collapse agentOrchestrators into Agentic Dashboard contribution + Global Agentic Dashboard markdown",
    up: (config) => migrateV2WorkspaceGroupsUnification(config),
  },
  {
    version: 3,
    description:
      "flatten archive shape — drop kind discriminator on archivedOrder, rename archivedDefs.groups → archivedDefs.workspaces",
    up: (config) => migrateV3ArchiveShape(config),
  },
];

/**
 * Highest migration version known to this build. Configs that have run
 * through every migration land on this value. When MIGRATIONS is empty
 * this is 0 — fresh configs get stamped at 0 so future bumps can tell
 * "never migrated" from "migrated but on an older version."
 */
export const CURRENT_SCHEMA_VERSION: number = MIGRATIONS.reduce(
  (acc, m) => Math.max(acc, m.version),
  0,
);

export interface ConfigMigrationResult {
  /** Config after applying every pending migration. */
  migrated: GnarTermConfig;
  /** True when either a migration ran or schemaVersion was stamped. */
  changed: boolean;
  /** Versions applied in this run, in order. */
  applied: number[];
}

/**
 * Apply every migration whose `version` is greater than the config's
 * current `schemaVersion`. Stamps `schemaVersion = CURRENT_SCHEMA_VERSION`
 * on the result.
 *
 * Returns the new config and a `changed` flag that is true when the
 * caller should persist the migrated form. `changed` is true when either
 * a migration ran OR the config lacked `schemaVersion` entirely (a fresh
 * or pre-scaffold config) — those still get a stamp so subsequent loads
 * skip this branch.
 */
export async function runConfigMigrations(
  config: GnarTermConfig,
): Promise<ConfigMigrationResult> {
  const startVersion = config.schemaVersion ?? 0;
  const hadVersion = typeof config.schemaVersion === "number";

  let current: GnarTermConfig = config;
  const applied: number[] = [];

  for (const migration of MIGRATIONS) {
    if (migration.version > startVersion) {
      current = await migration.up(current);
      current = { ...current, schemaVersion: migration.version };
      applied.push(migration.version);
    }
  }

  if (applied.length === 0 && !hadVersion) {
    current = { ...current, schemaVersion: CURRENT_SCHEMA_VERSION };
  }

  const changed = applied.length > 0 || !hadVersion;
  return { migrated: current, changed, applied };
}

/**
 * Test-only hooks. Exposed to let migration tests register fixtures
 * against the real machinery without tying tests to a specific release
 * version. Production code paths must never use these.
 */
export const __testing__ = {
  migrations: MIGRATIONS,
  registerMigration(migration: ConfigMigration): void {
    MIGRATIONS.push(migration);
    MIGRATIONS.sort((a, b) => a.version - b.version);
  },
  reset(): void {
    MIGRATIONS.length = 0;
  },
};
