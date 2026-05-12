import { get } from "svelte/store";
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
 * The `when` predicate honors `ctx.activePaneId` / `ctx.paneId` if core ever
 * supplies them; when the context is empty (the current shape for the
 * workspace zone), it falls back to `get(api.activePane)` so the action is
 * only visible when the current pane has no detected agent.
 */
export function registerWorkspaceActions(api: ExtensionAPI): void {
  api.registerWorkspaceAction("spawn-agentic-branch", {
    label: "+ branch + agent",
    zone: "workspace-tile",
    handler: () => openSpawnBranchFlow(api),
  });

  api.registerWorkspaceAction("boot-agent-here", {
    label: "Boot agent here",
    zone: "workspace",
    // Degraded: no "spawn into active pane" API exists on the extension
    // surface. Reuse the full spawn-branch flow so the action is always
    // wired. Tracked as a follow-up (see cycle-6.md deviation note).
    handler: () => openSpawnBranchFlow(api),
    when: (ctx) => {
      const ctxPaneId =
        typeof ctx.activePaneId === "string"
          ? ctx.activePaneId
          : typeof ctx.paneId === "string"
            ? ctx.paneId
            : null;

      const paneId = ctxPaneId ?? get(api.activePane)?.id ?? null;

      // No pane in context AND no globally-active pane — hide the action.
      // A "boot agent here" button with no "here" to target is misleading.
      if (paneId === null) return false;

      return api.getAgentByPane(paneId) === null;
    },
  });
}
