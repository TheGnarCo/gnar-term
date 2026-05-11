import type { Readable } from "svelte/store";
import {
  workspaces,
  activeWorkspace,
  activePane,
  activeSurface,
} from "../stores/workspace";
import type { Workspace } from "../types";
import type { WorkspaceRef } from "../../extensions/api";
import { theme } from "../stores/theme";
import {
  reorderContext,
  hoveredSidebarBlockId,
  hoveredRootRowKey,
} from "../stores/ui";
import { agentsStore } from "./agent-detection-service";
import { branchLifecycleStore } from "./branch-lifecycle";
import type { ExtensionAPI } from "../extension-types";

/** Read-only store wrappers that project internal state to safe public types. */
export function createStoreProjections(
  extId: string,
): Pick<
  ExtensionAPI,
  | "workspaces"
  | "activeWorkspace"
  | "activePane"
  | "activeSurface"
  | "agents"
  | "branchLifecycle"
  | "theme"
  | "reorderContext"
  | "hoveredSidebarBlockId"
  | "hoveredRootRowKey"
> {
  // Read-only store wrappers (strip set/update from Writable)
  const readOnly = <T>(store: {
    subscribe: (fn: (v: T) => void) => () => void;
  }): Readable<T> => ({
    subscribe: store.subscribe,
  });

  // Suppress unused-parameter lint — extId is accepted for API symmetry with
  // the other create*API helpers; future per-extension store filtering may
  // use it.
  void extId;

  function project(w: Workspace): WorkspaceRef {
    const ref: WorkspaceRef = { id: w.id, name: w.name };
    if (w.path !== undefined) ref.path = w.path;
    if (w.color !== undefined) ref.color = w.color;
    if (w.isGit !== undefined) ref.isGit = w.isGit;
    if (w.rootWorkspaceId !== undefined)
      ref.rootWorkspaceId = w.rootWorkspaceId;
    const bw = w as Workspace & {
      worktreePath?: string;
      branch?: string;
      baseBranch?: string;
      repoPath?: string;
    };
    if (bw.worktreePath !== undefined) ref.worktreePath = bw.worktreePath;
    if (bw.branch !== undefined) ref.branch = bw.branch;
    if (bw.baseBranch !== undefined) ref.baseBranch = bw.baseBranch;
    if (bw.repoPath !== undefined) ref.repoPath = bw.repoPath;
    if (w.isDashboard !== undefined) ref.isDashboard = w.isDashboard;
    if (w.dashboardContributionId !== undefined)
      ref.dashboardContributionId = w.dashboardContributionId;
    if (w.spawnedBy !== undefined) ref.spawnedBy = w.spawnedBy;
    if (w.spawnedFromIssues !== undefined)
      ref.spawnedFromIssues = w.spawnedFromIssues;
    return ref;
  }

  return {
    workspaces: {
      subscribe(fn: (value: unknown) => void) {
        return workspaces.subscribe((ws) => fn(ws.map(project)));
      },
    } as ExtensionAPI["workspaces"],
    activeWorkspace: {
      subscribe(fn: (value: unknown) => void) {
        return activeWorkspace.subscribe((w) => fn(w ? project(w) : null));
      },
    } as ExtensionAPI["activeWorkspace"],
    activePane: {
      subscribe(fn: (value: unknown) => void) {
        return activePane.subscribe((p) =>
          fn(
            p
              ? {
                  id: p.id,
                  surfaces: p.surfaces.map((s) => ({
                    id: s.id,
                    kind: s.kind,
                    title: s.title,
                    hasUnread: s.hasUnread,
                  })),
                  activeSurfaceId: p.activeSurfaceId,
                }
              : null,
          ),
        );
      },
    } as ExtensionAPI["activePane"],
    activeSurface: {
      subscribe(fn: (value: unknown) => void) {
        return activeSurface.subscribe((s) =>
          fn(
            s
              ? {
                  id: s.id,
                  kind: s.kind,
                  title: s.title,
                  hasUnread: s.hasUnread,
                }
              : null,
          ),
        );
      },
    } as ExtensionAPI["activeSurface"],
    agents: readOnly(agentsStore) as unknown as ExtensionAPI["agents"],
    branchLifecycle: readOnly(
      branchLifecycleStore,
    ) as unknown as ExtensionAPI["branchLifecycle"],
    theme: readOnly(theme) as unknown as ExtensionAPI["theme"],
    reorderContext: readOnly(
      reorderContext,
    ) as unknown as ExtensionAPI["reorderContext"],
    hoveredSidebarBlockId: readOnly(
      hoveredSidebarBlockId,
    ) as unknown as ExtensionAPI["hoveredSidebarBlockId"],
    hoveredRootRowKey: readOnly(
      hoveredRootRowKey,
    ) as unknown as ExtensionAPI["hoveredRootRowKey"],
  };
}
