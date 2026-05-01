/**
 * Migration registry — single source of truth for the ordered list of
 * config migrations. Lives in its own module so tests can `vi.mock` this
 * file to swap the array per test without exposing a runtime mutation
 * surface in production code.
 */
import type { GnarTermConfig } from "../../config";
import { migrateV2WorkspaceGroupsUnification } from "./v2-workspace-groups-unification";
import { migrateV3ArchiveShape } from "./v3-archive-shape";

/**
 * Structural shape for legacy fields that have been removed from the
 * public `GnarTermConfig` but can still appear on persisted configs
 * from older releases. Migrations reach for these through a cast; no
 * runtime code outside the migration pipeline should depend on them.
 */
interface LegacyConfigShape extends GnarTermConfig {
  agentOrchestrators?: Array<Record<string, unknown>>;
}

export interface ConfigMigration {
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
export const MIGRATIONS: ConfigMigration[] = [
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
