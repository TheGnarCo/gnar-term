/**
 * Unified Workspace store — single source of truth for all workspaces
 * (primary, branched, dashboards).
 *
 * All workspaces share the `Workspace` type from `types.ts`. Primary
 * workspaces carry `path`, `color`, `isGit`. Branched workspaces carry
 * `parentWorkspaceId` + worktree fields. Dashboard workspaces carry
 * `parentWorkspaceId` + `isDashboard: true`.
 *
 * This file owns the writable `workspaces` store and all derived/UI stores.
 * This is the single workspace store — no legacy shim files exist.
 */
import { get, writable, derived } from "svelte/store";
import type { Writable, Readable } from "svelte/store";
import type { Workspace, BranchedWorkspace } from "../types";
import { getAllPanes } from "../types";
import type { WorkspaceDef, LayoutNode, WorkspaceRecord } from "../config";

// ---------------------------------------------------------------------------
// Core writables
// ---------------------------------------------------------------------------

/** The live list of all workspaces (primary, branched, dashboards). */
const _workspaces = writable<Workspace[]>([]);

/** Index of the currently active workspace in the `_workspaces` list. */
export const activeWorkspaceIdx: Writable<number> = writable(-1);

/** [previousId, currentId] — updated on each switchWorkspace call. */
export const workspaceHistory = writable<[string | null, string | null]>([
  null,
  null,
]);

/**
 * Id of the currently-active pseudo-workspace (e.g. the Global Agentic
 * Dashboard), or `null` when a real workspace is active. Pseudo-workspaces
 * are registered via `registerPseudoWorkspace` and do not live in the
 * `workspaces` array — they're rendered from the pseudo-workspace
 * registry. Activation is mutually exclusive with `activeWorkspaceIdx`:
 * setting this to a non-null id hides every real workspace view and
 * mounts the pseudo's body instead.
 */
export const activePseudoWorkspaceId = writable<string | null>(null);

/**
 * When non-null, holds the surface ID of the pane that is "zoomed" to fill
 * the full workspace area. All other panes are hidden (but kept mounted) so
 * terminal state is preserved. Cleared on workspace switch.
 */
export const zoomedSurfaceId = writable<string | null>(null);

// ---------------------------------------------------------------------------
// Normalize: lift Workspace metadata to top-level Workspace fields
// ---------------------------------------------------------------------------

/**
 * Lift metadata fields from a Workspace (which may carry a legacy `metadata`
 * blob written before the top-level field migration) to top-level properties.
 * Also merges project-level fields from legacy parent workspaces when
 * provided.
 */
export function normalizeWorkspace(
  nw: Workspace,
  legacyParents: WorkspaceRecord[] = [],
): Workspace {
  const meta = nw.metadata ?? {};
  const ws: Workspace = {
    id: nw.id,
    name: nw.name,
    splitRoot: nw.splitRoot,
    activePaneId: nw.activePaneId,
  };

  // Child link
  if (typeof meta.parentWorkspaceId === "string") {
    ws.parentWorkspaceId = meta.parentWorkspaceId;
  }

  // Dashboard flag
  if (meta.isDashboard === true) {
    ws.isDashboard = true;
  }
  if (typeof meta.dashboardContributionId === "string") {
    ws.dashboardContributionId = meta.dashboardContributionId;
  }

  // Worktree / branch fields — once worktreePath is set, ws structurally
  // becomes a BranchedWorkspace so we narrow once and write the rest.
  if (typeof meta.worktreePath === "string") {
    const bws = ws as BranchedWorkspace;
    bws.worktreePath = meta.worktreePath;
    if (typeof meta.branch === "string") bws.branch = meta.branch;
    if (typeof meta.baseBranch === "string") bws.baseBranch = meta.baseBranch;
    if (typeof meta.repoPath === "string") bws.repoPath = meta.repoPath;
  }

  // User locking (from metadata)
  if (meta.locked === true) {
    ws.locked = true;
  }

  // Extension data — forward the whole metadata blob as extensionData so
  // extension consumers that read ws.extensionData still see their keys.
  if (Object.keys(meta).length > 0) {
    ws.extensionData = meta as Record<string, unknown>;
  }

  // Merge project-level fields from the legacy parent workspace that
  // claims this as its primary workspace.
  if (!ws.parentWorkspaceId && legacyParents.length > 0) {
    const owner = legacyParents.find(
      (u) => u.primaryBranchedWorkspaceId === nw.id,
    );
    if (owner) {
      ws.path = owner.path;
      ws.color = owner.color;
      ws.isGit = owner.isGit;
      ws.createdAt = owner.createdAt;
      if (owner.locked) ws.locked = owner.locked;
      if (owner.autoRunRestoreCommands !== undefined)
        ws.autoRunRestoreCommands = owner.autoRunRestoreCommands;
      if (owner.lastActiveBranchedWorkspaceId)
        ws.lastActiveBranchedWorkspaceId = owner.lastActiveBranchedWorkspaceId;
      if (owner.dashboardWorkspaceId)
        ws.dashboardWorkspaceId = owner.dashboardWorkspaceId;
    }
  }

  // Metadata fallback for project-level fields (post-Stage-3a). When
  // persistence round-trips through unified WorkspaceDef format, project
  // fields are packed into metadata for legacy Workspace runtime
  // compatibility; the bridge lifts them back to top-level on read.
  if (ws.path === undefined && typeof meta.path === "string")
    ws.path = meta.path;
  if (ws.color === undefined && typeof meta.color === "string")
    ws.color = meta.color;
  if (ws.isGit === undefined && typeof meta.isGit === "boolean")
    ws.isGit = meta.isGit;
  if (ws.createdAt === undefined && typeof meta.createdAt === "string")
    ws.createdAt = meta.createdAt;
  if (
    ws.autoRunRestoreCommands === undefined &&
    typeof meta.autoRunRestoreCommands === "boolean"
  )
    ws.autoRunRestoreCommands = meta.autoRunRestoreCommands;
  if (
    ws.lastActiveBranchedWorkspaceId === undefined &&
    typeof meta.lastActiveBranchedWorkspaceId === "string"
  )
    ws.lastActiveBranchedWorkspaceId = meta.lastActiveBranchedWorkspaceId;
  if (
    ws.dashboardWorkspaceId === undefined &&
    typeof meta.dashboardWorkspaceId === "string"
  )
    ws.dashboardWorkspaceId = meta.dashboardWorkspaceId;

  return ws;
}

/**
 * Inverse of `normalizeWorkspace` for the persistence read path:
 * convert a unified `WorkspaceDef` (on-disk format) into a legacy
 * `WorkspaceTemplate` so the existing `createWorkspaceFromDef` runtime
 * path can hydrate PTY surfaces. All non-structural fields (project,
 * dashboard, worktree, locked, extension data) are packed into metadata;
 * the bridge then lifts them back to top-level when the unified store is
 * read.
 */
export function workspaceDefToTemplate(
  def: WorkspaceDef,
): import("../config").WorkspaceTemplate {
  const metadata: Record<string, unknown> = { ...(def.extensionData ?? {}) };
  // Structural / discriminant fields
  if (def.parentWorkspaceId !== undefined)
    metadata.parentWorkspaceId = def.parentWorkspaceId;
  if (def.isDashboard !== undefined) metadata.isDashboard = def.isDashboard;
  if (def.dashboardContributionId !== undefined)
    metadata.dashboardContributionId = def.dashboardContributionId;
  if (def.worktreePath !== undefined) metadata.worktreePath = def.worktreePath;
  if (def.branch !== undefined) metadata.branch = def.branch;
  if (def.baseBranch !== undefined) metadata.baseBranch = def.baseBranch;
  if (def.repoPath !== undefined) metadata.repoPath = def.repoPath;
  if (def.locked !== undefined) metadata.locked = def.locked;
  // Project-level fields — stashed in metadata so the bridge lifts them on read
  if (def.path !== undefined) metadata.path = def.path;
  if (def.color !== undefined) metadata.color = def.color;
  if (def.isGit !== undefined) metadata.isGit = def.isGit;
  if (def.createdAt !== undefined) metadata.createdAt = def.createdAt;
  if (def.autoRunRestoreCommands !== undefined)
    metadata.autoRunRestoreCommands = def.autoRunRestoreCommands;
  if (def.lastActiveBranchedWorkspaceId !== undefined)
    metadata.lastActiveBranchedWorkspaceId = def.lastActiveBranchedWorkspaceId;
  if (def.dashboardWorkspaceId !== undefined)
    metadata.dashboardWorkspaceId = def.dashboardWorkspaceId;

  const nwDef: import("../config").WorkspaceTemplate = {
    id: def.id,
    name: def.name,
    layout: def.layout,
  };
  if (def.color !== undefined) nwDef.color = def.color;
  if (Object.keys(metadata).length > 0) {
    nwDef.metadata = metadata as import("../types").WorkspaceMetadata;
  }
  return nwDef;
}

// ---------------------------------------------------------------------------
// Primary exported store: workspaces (writable)
// ---------------------------------------------------------------------------

/**
 * Live list of all workspaces. This is now a writable that owns the data.
 * It normalizes entries via `normalizeWorkspace` (lifting metadata to
 * top-level) when populated via `setWorkspaceList` / `seedWorkspaces`.
 *
 * For direct writes from workspace-runtime-service, the store is exposed
 * directly via the `workspaces` export below.
 */
export const workspaces: Writable<Workspace[]> & Readable<Workspace[]> =
  _workspaces;

/**
 * The id of the currently-active workspace.
 *
 * Reads: derived from `activeWorkspaceIdx` + `workspaces` so the value always
 * reflects the activation model. Returns `null` when no workspace is active
 * (idx === -1 or out of bounds).
 *
 * Writes: Setting an id looks up the matching index in the current `workspaces`
 * snapshot and writes the idx; setting `null` writes `-1`. Setting an id that
 * does not resolve to a workspace is a no-op.
 */
const _activeWorkspaceIdReadable: Readable<string | null> = derived(
  [_workspaces, activeWorkspaceIdx],
  ([$ws, $idx]) => {
    if ($idx < 0 || $idx >= $ws.length) return null;
    return $ws[$idx]?.id ?? null;
  },
);

export const activeWorkspaceId = {
  subscribe: _activeWorkspaceIdReadable.subscribe,
  set(id: string | null): void {
    if (id === null) {
      activeWorkspaceIdx.set(-1);
      return;
    }
    const idx = get(_workspaces).findIndex((w) => w.id === id);
    if (idx >= 0) {
      activeWorkspaceIdx.set(idx);
    }
  },
  update(fn: (id: string | null) => string | null): void {
    const current = get(_activeWorkspaceIdReadable);
    const next = fn(current);
    this.set(next);
  },
};

// ---------------------------------------------------------------------------
// Derived stores
// ---------------------------------------------------------------------------

export const activeWorkspace = derived(
  [_workspaces, activeWorkspaceId],
  ([$ws, $id]) => $ws.find((w) => w.id === $id) ?? null,
);

export const activePane = derived([activeWorkspace], ([$ws]) => {
  if (!$ws) return null;
  const panes = getAllPanes($ws.splitRoot);
  return panes.find((p) => p.id === $ws.activePaneId) ?? null;
});

export const activeSurface = derived([activePane], ([$pane]) => {
  if (!$pane) return null;
  return $pane.surfaces.find((s) => s.id === $pane.activeSurfaceId) ?? null;
});

// Persistence is owned by `workspace-runtime-service.persistWorkspaces`,
// which serializes this store and merges in legacy project records to
// produce the single canonical `state.workspaces[]` writer.

// ---------------------------------------------------------------------------
// Getters
// ---------------------------------------------------------------------------

export function getWorkspaceList(): Workspace[] {
  return get(_workspaces);
}

export function getWorkspaceById(id: string): Workspace | undefined {
  return getWorkspaceList().find((w) => w.id === id);
}

export function getActiveWorkspaceIdValue(): string | null {
  return get(activeWorkspaceId);
}

// ---------------------------------------------------------------------------
// Mutators
// ---------------------------------------------------------------------------

export function setWorkspaceList(next: Workspace[]): void {
  _workspaces.set(next);
}

export function updateWorkspaceInList(
  id: string,
  patch: Partial<Omit<Workspace, "id">>,
): void {
  _workspaces.update((list) =>
    list.map((ws) => (ws.id === id ? { ...ws, ...patch } : ws)),
  );
}

export function setActiveWorkspaceIdValue(id: string | null): void {
  activeWorkspaceId.set(id);
}

/**
 * Seed stores from deserialized workspace defs. Called from restore path
 * after `loadState()`.
 */
export function seedWorkspaces(
  wsList: Workspace[],
  activeId: string | null,
): void {
  _workspaces.set(wsList);
  if (activeId !== null) {
    activeWorkspaceId.set(activeId);
  }
}

/** Test hook — reset in-memory state so tests start clean. */
export function resetWorkspaceStoreForTest(): void {
  _workspaces.set([]);
  activeWorkspaceIdx.set(-1);
}

// ---------------------------------------------------------------------------
// Serialization helpers (layout round-trip)
// ---------------------------------------------------------------------------

import {
  isTerminalSurface,
  isPreviewSurface,
  isExtensionSurface,
  type SplitNode,
} from "../types";

export function serializeLayout(node: SplitNode): LayoutNode {
  if (node.type === "pane") {
    const surfaces = node.pane.surfaces.map((s) => {
      if (isTerminalSurface(s)) {
        const def: Record<string, unknown> = { type: "terminal" };
        if (s.cwd) def.cwd = s.cwd;
        if (s.definedCommand) def.command = s.definedCommand;
        if (s.id === node.pane.activeSurfaceId) def.focus = true;
        return def;
      }
      if (isPreviewSurface(s)) {
        const def: Record<string, unknown> = { type: "preview", path: s.path };
        if (s.title) def.name = s.title;
        if (s.id === node.pane.activeSurfaceId) def.focus = true;
        return def;
      }
      // Extension surface
      const def: Record<string, unknown> = { type: "extension" };
      if (s.title) def.name = s.title;
      if (s.id === node.pane.activeSurfaceId) def.focus = true;
      if (isExtensionSurface(s)) {
        def.extensionType = s.surfaceTypeId;
        if (s.props) {
          const {
            element: _element,
            watchId: _watchId,
            ...serializableProps
          } = s.props as Record<string, unknown>;
          if (Object.keys(serializableProps).length > 0) {
            def.extensionProps = serializableProps;
          }
        }
      }
      return def;
    });
    return { pane: { surfaces } };
  }
  return {
    direction: node.direction,
    split: node.ratio,
    children: [
      serializeLayout(node.children[0]),
      serializeLayout(node.children[1]),
    ],
  };
}

export function serializeWorkspace(ws: Workspace): WorkspaceDef {
  const def: WorkspaceDef = {
    id: ws.id,
    name: ws.name,
    layout: serializeLayout(ws.splitRoot),
  };
  if (ws.path !== undefined) def.path = ws.path;
  if (ws.color !== undefined) def.color = ws.color;
  if (ws.isGit !== undefined) def.isGit = ws.isGit;
  if (ws.createdAt !== undefined) def.createdAt = ws.createdAt;
  if (ws.autoRunRestoreCommands !== undefined)
    def.autoRunRestoreCommands = ws.autoRunRestoreCommands;
  if (ws.lastActiveBranchedWorkspaceId !== undefined)
    def.lastActiveBranchedWorkspaceId = ws.lastActiveBranchedWorkspaceId;
  if (ws.dashboardWorkspaceId !== undefined)
    def.dashboardWorkspaceId = ws.dashboardWorkspaceId;
  if (ws.parentWorkspaceId !== undefined)
    def.parentWorkspaceId = ws.parentWorkspaceId;
  if (ws.isDashboard !== undefined) def.isDashboard = ws.isDashboard;
  if (ws.dashboardContributionId !== undefined)
    def.dashboardContributionId = ws.dashboardContributionId;
  if ("worktreePath" in ws && ws.worktreePath !== undefined)
    def.worktreePath = ws.worktreePath as string;
  if ("branch" in ws && ws.branch !== undefined)
    def.branch = ws.branch as string;
  if ("baseBranch" in ws && ws.baseBranch !== undefined)
    def.baseBranch = ws.baseBranch as string;
  if ("repoPath" in ws && ws.repoPath !== undefined)
    def.repoPath = ws.repoPath as string;
  if (ws.locked !== undefined) def.locked = ws.locked;
  if (ws.extensionData !== undefined) def.extensionData = ws.extensionData;
  return def;
}
