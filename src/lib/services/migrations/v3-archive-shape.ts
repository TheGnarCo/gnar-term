/**
 * v3 — collapse the archive store's `kind`-discriminated rows into a
 * flat list of workspace ids, and rename the inner `groups` field on
 * `archivedDefs` to `workspaces` (with renamed sub-fields).
 *
 * Before: `archivedOrder: { kind: "workspace" | "workspace-group"; id }[]`
 *         `archivedDefs: { nestedWorkspaces: {...}; groups: {...} }`
 * After:  `archivedOrder: string[]`
 *         `archivedDefs: { workspaces: {...} }`
 *
 * Nested-workspace archive entries (`kind: "workspace"`) are dropped on
 * purpose — nested workspaces can no longer be archived independently
 * of their parent.
 */
import type {
  GnarTermConfig,
  NestedWorkspaceDef,
  Workspace,
} from "../../config";

interface LegacyRow {
  kind: string;
  id: string;
}

interface LegacyGroupEntry {
  group: Workspace;
  workspaceDefs: (NestedWorkspaceDef & { name: string })[];
}

interface LegacyArchivedDefs {
  nestedWorkspaces?: Record<string, unknown>;
  groups?: Record<string, LegacyGroupEntry>;
}

interface LegacyConfig extends GnarTermConfig {
  archivedOrder?: unknown;
  archivedDefs?: unknown;
}

function isLegacyRow(v: unknown): v is LegacyRow {
  return (
    typeof v === "object" &&
    v !== null &&
    "kind" in v &&
    "id" in v &&
    typeof (v as LegacyRow).id === "string"
  );
}

export function migrateV3ArchiveShape(config: GnarTermConfig): GnarTermConfig {
  const next: Record<string, unknown> = { ...config };
  const legacy = config as LegacyConfig;

  // archivedOrder: keep only workspace-group entries, flatten to ids.
  // Already-migrated entries (plain strings) pass through.
  const order = legacy.archivedOrder;
  if (Array.isArray(order)) {
    const flat: string[] = [];
    for (const item of order) {
      if (typeof item === "string") {
        flat.push(item);
      } else if (isLegacyRow(item) && item.kind === "workspace-group") {
        flat.push(item.id);
      }
    }
    next.archivedOrder = flat;
  }

  // archivedDefs: drop nestedWorkspaces, rename groups → workspaces with
  // renamed sub-fields { group → workspace, workspaceDefs → nestedWorkspaceDefs }.
  const defs = legacy.archivedDefs;
  if (defs && typeof defs === "object") {
    const legacyDefs = defs as LegacyArchivedDefs & {
      workspaces?: Record<string, unknown>;
    };
    const workspaces: Record<
      string,
      {
        workspace: Workspace;
        nestedWorkspaceDefs: (NestedWorkspaceDef & { name: string })[];
      }
    > = {};

    // If the migrated key already exists (e.g. partial earlier write),
    // preserve it verbatim.
    if (legacyDefs.workspaces && typeof legacyDefs.workspaces === "object") {
      Object.assign(workspaces, legacyDefs.workspaces);
    }

    if (legacyDefs.groups && typeof legacyDefs.groups === "object") {
      for (const [id, entry] of Object.entries(legacyDefs.groups)) {
        if (workspaces[id]) continue; // prefer already-migrated value
        workspaces[id] = {
          workspace: entry.group,
          nestedWorkspaceDefs: entry.workspaceDefs,
        };
      }
    }

    next.archivedDefs = { workspaces };
  }

  return next as GnarTermConfig;
}
