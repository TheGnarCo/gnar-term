/**
 * Worktree bootstrap — owns the worktree-backed workspace concept.
 * Registers the create / archive / merge-archive commands and subscribes
 * to workspace lifecycle events so worktree-backed workspaces stay in
 * sync with core state. The ⎇ Branch button and `core:create-worktree`
 * workspace action are registered in init-workspace-groups.
 */
import { eventBus, type AppEvent } from "../services/event-bus";
import { registerCommand } from "../services/command-registry";
import {
  archiveWorktreeWorkspace,
  createWorktreeWorkspace,
  handleWorkspaceClosed,
  handleWorkspaceCreated,
  loadWorktreeEntries,
  mergeAndArchiveWorktreeWorkspace,
} from "../services/worktree-service";

export function initWorktrees(): void {
  loadWorktreeEntries();

  registerCommand({
    id: "worktrees:create-workspace",
    title: "New Worktree...",
    source: "worktrees",
    action: (args) => {
      const ctx =
        args && typeof args === "object"
          ? (args as Record<string, unknown>)
          : {};
      void createWorktreeWorkspace(ctx);
    },
  });

  registerCommand({
    id: "worktrees:archive-workspace",
    title: "Archive Worktree...",
    source: "worktrees",
    action: () => archiveWorktreeWorkspace(),
  });

  registerCommand({
    id: "worktrees:merge-archive-workspace",
    title: "Merge & Archive Worktree...",
    source: "worktrees",
    action: () => mergeAndArchiveWorktreeWorkspace(),
  });

  eventBus.on("workspace:created", (event: AppEvent) => {
    if (event.type !== "workspace:created") return;
    handleWorkspaceCreated(
      event.id,
      event.metadata as import("../types").NestedWorkspaceMetadata | undefined,
    );
  });

  eventBus.on("workspace:closed", (event: AppEvent) => {
    if (event.type !== "workspace:closed") return;
    void handleWorkspaceClosed(event.id);
  });
}
