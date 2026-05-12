import type { ExtensionAPI } from "../../api";
import { openSpawnBranchFlow } from "../header/spawn-branch-flow";

/**
 * Register workspace-tile and workspace-zone actions for the agentic extension.
 *
 * - "spawn-agentic-branch": appears on each workspace tile ("+ branch + agent").
 *   Reuses the same spawn flow as the dashboard header button.
 *
 * - "boot-agent-here": appears in the workspace zone when the active pane has
 *   no detected agent. Degrades gracefully to the full spawn-branch flow because
 *   a lightweight "spawn agent into this pane" API does not exist in the current
 *   extension surface. Deviation documented in cycle-6.md.
 *
 * Note: WorkspaceActionContext carries workspace-level fields
 * (rootWorkspaceId, isGit, etc.) but NOT a per-pane identifier — the context
 * shape is `Record<string, unknown>` per api.ts:1048. The `when` predicate
 * reads `ctx.activePaneId ?? ctx.paneId` defensively; if neither is present the
 * predicate returns true (permissive fallback so the button remains visible).
 */
export function registerWorkspaceActions(api: ExtensionAPI): void {
  api.registerWorkspaceAction("spawn-agentic-branch", {
    label: "+ branch + agent",
    zone: "workspace-tile",
    handler: () => {
      void openSpawnBranchFlow(api);
    },
  });

  api.registerWorkspaceAction("boot-agent-here", {
    label: "Boot agent here",
    zone: "workspace",
    handler: () => {
      // Degraded: no "spawn into active pane" API exists on the extension
      // surface. Reuse the full spawn-branch flow so the action is always
      // wired. Tracked as a follow-up (see cycle-6.md deviation note).
      void openSpawnBranchFlow(api);
    },
    when: (ctx) => {
      const paneId =
        typeof ctx.activePaneId === "string"
          ? ctx.activePaneId
          : typeof ctx.paneId === "string"
            ? ctx.paneId
            : null;

      if (paneId === null) {
        // No pane context — show the action (permissive fallback).
        return true;
      }

      return api.getAgentByPane(paneId) === null;
    },
  });
}
