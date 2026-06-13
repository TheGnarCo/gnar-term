/**
 * Connection-binding → workspace/pane resolution, plus the workspace/pane
 * mutation helpers the tool handlers build on.
 *
 * Implements the MCP spec § Connection binding resolution rules. Critically,
 * `resolveTarget` NEVER reads `activeWorkspace`: user GUI focus is not an
 * authoritative routing input.
 */
import { get } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import { workspaces } from "../../stores/workspace";
import {
  getAllPanes,
  getAllSurfaces,
  isTerminalSurface,
  uid,
  findPaneById as findPaneByIdInWorkspaces,
  findParentSplit,
  type Pane,
  type SplitNode,
  type Surface,
  type TerminalSurface,
  type Workspace,
} from "../../types";
import { waitForPtyReady } from "../../terminal-service";
import { unregisterMcpPty } from "../mcp-output-buffer";
import { sessions, ptyToSession } from "./state";
import type { ConnectionContext, ResolvedTarget, TargetArgs } from "./types";

// ---- Workspace / pane resolution ----

export function findPaneById(
  paneId: string,
): { workspace: Workspace; pane: Pane } | null {
  return findPaneByIdInWorkspaces(get(workspaces), paneId);
}

export function findWorkspaceById(workspaceId: string): Workspace | null {
  return get(workspaces).find((w) => w.id === workspaceId) ?? null;
}

/** Resolve which workspace (and optional host pane) a UI-mutating tool should
 *  target. Implements the resolution rules in the MCP spec § Connection binding.
 *  Throws with an actionable error message if no target can be resolved.
 *  Critically: this function NEVER reads `activeWorkspace`. User GUI focus is
 *  not an authoritative routing input. */
export function resolveTarget(
  args: TargetArgs,
  ctx: ConnectionContext,
): ResolvedTarget {
  // Rule 1: explicit pane_id wins.
  if (args.pane_id) {
    const found = findPaneById(args.pane_id);
    if (!found) {
      throw new Error(
        `pane_id "${args.pane_id}" not found (it may have been closed)`,
      );
    }
    return { workspace: found.workspace, hostPane: found.pane, source: "args-pane" };
  }
  // Rule 2: explicit workspace_id.
  if (args.workspace_id) {
    const ws = findWorkspaceById(args.workspace_id);
    if (!ws) {
      throw new Error(`workspace_id "${args.workspace_id}" not found`);
    }
    return { workspace: ws, hostPane: null, source: "args-workspace" };
  }
  // Rule 3a: chain off the most recent pane this connection spawned, if any.
  // Keeps the split tree shallow under rapid-fire spawns — see the comment on
  // `ConnectionContext.lastSpawnedPaneId`.
  if (ctx.lastSpawnedPaneId) {
    const found = findPaneById(ctx.lastSpawnedPaneId);
    if (found) {
      return {
        workspace: found.workspace,
        hostPane: found.pane,
        source: "binding-pane",
      };
    }
    // Last pane was closed. Fall through.
  }
  // Rule 3b: connection-bound pane (re-derive workspace in case pane was moved).
  const binding = ctx.binding;
  if (binding?.paneId) {
    const found = findPaneById(binding.paneId);
    if (found) {
      return {
        workspace: found.workspace,
        hostPane: found.pane,
        source: "binding-pane",
      };
    }
    // Bound pane was closed. Fall through to rule 4 (workspace-only binding).
  }
  // Rule 4: connection-bound workspace.
  if (binding?.workspaceId) {
    const ws = findWorkspaceById(binding.workspaceId);
    if (ws) {
      return { workspace: ws, hostPane: null, source: "binding-workspace" };
    }
  }
  // Rule 5: no target. Error loudly — never fall back to active workspace.
  throw new Error(
    "agent has no pane/workspace context — pass workspace_id explicitly, or run the agent inside a gnar-term pane",
  );
}

/** Pick a host pane to split off when the caller didn't supply one. Prefers
 *  the workspace's active pane; falls back to the first pane in the tree. */
export function pickHostPane(workspace: Workspace): Pane {
  const all = getAllPanes(workspace.splitRoot);
  if (workspace.activePaneId) {
    const active = all.find((p) => p.id === workspace.activePaneId);
    if (active) return active;
  }
  if (all.length > 0) return all[0];
  // Workspace exists but has no panes (shouldn't happen in practice; create one).
  const newPane: Pane = { id: uid(), surfaces: [], activeSurfaceId: null };
  workspace.splitRoot = { type: "pane", pane: newPane };
  workspaces.update((l) => [...l]);
  return newPane;
}

/** Split `hostPane` off into a new sibling pane within its workspace. */
export function splitPaneInWorkspace(
  workspace: Workspace,
  hostPane: Pane,
  direction: "horizontal" | "vertical",
): Pane {
  const newPane: Pane = { id: uid(), surfaces: [], activeSurfaceId: null };
  const newSplit: SplitNode = {
    type: "split",
    direction,
    children: [
      { type: "pane", pane: hostPane },
      { type: "pane", pane: newPane },
    ],
    ratio: 0.5,
  };
  if (
    workspace.splitRoot.type === "pane" &&
    workspace.splitRoot.pane.id === hostPane.id
  ) {
    workspace.splitRoot = newSplit;
  } else {
    const parentInfo = findParentSplit(workspace.splitRoot, hostPane.id);
    if (parentInfo && parentInfo.parent.type === "split") {
      parentInfo.parent.children[parentInfo.index] = newSplit;
    }
  }
  workspace.activePaneId = newPane.id;
  workspaces.update((l) => [...l]);
  return newPane;
}

export async function waitForPtyId(
  surface: TerminalSurface,
  timeoutMs = 5000,
): Promise<number> {
  return waitForPtyReady(surface, timeoutMs);
}

export async function getPtyCwd(ptyId: number): Promise<string> {
  try {
    return await invoke<string>("get_pty_cwd", { ptyId });
  } catch {
    return "";
  }
}

export function removeSurfaceFromPane(paneId: string, surfaceId: string): void {
  workspaces.update((list) => {
    for (const ws of list) {
      for (const pane of getAllPanes(ws.splitRoot)) {
        if (pane.id !== paneId) continue;
        const idx = pane.surfaces.findIndex((s) => s.id === surfaceId);
        if (idx < 0) continue;
        const surface = pane.surfaces[idx];
        if (isTerminalSurface(surface)) {
          try {
            surface.terminal.dispose();
          } catch {
            /* ignore */
          }
        }
        pane.surfaces.splice(idx, 1);
        if (pane.surfaces.length === 0) {
          pane.activeSurfaceId = null;
        } else {
          pane.activeSurfaceId =
            pane.surfaces[Math.min(idx, pane.surfaces.length - 1)].id;
        }
      }
    }
    return [...list];
  });
}

export function reapDeadSessions(): void {
  const aliveSurfaceIds = new Set<string>();
  for (const ws of get(workspaces)) {
    for (const surface of getAllSurfaces(ws)) {
      aliveSurfaceIds.add(surface.id);
    }
  }
  for (const [id, session] of sessions) {
    if (!aliveSurfaceIds.has(session.surfaceId)) {
      unregisterMcpPty(session.ptyId);
      ptyToSession.delete(session.ptyId);
      sessions.delete(id);
    }
  }
}

// ---- Workspace introspection helpers ----

export function describeSurface(s: Surface) {
  return { id: s.id, kind: s.kind, title: s.title };
}

export function describePane(pane: Pane, workspaceId: string) {
  const activeSurface = pane.surfaces.find((s) => s.id === pane.activeSurfaceId);
  let cwd = "";
  if (activeSurface && isTerminalSurface(activeSurface)) {
    cwd = activeSurface.cwd ?? "";
  }
  return {
    id: pane.id,
    workspaceId,
    cwd,
    activeSurfaceId: pane.activeSurfaceId,
    surfaces: pane.surfaces.map(describeSurface),
  };
}
