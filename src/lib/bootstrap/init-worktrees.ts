/**
 * Worktree bootstrap — registers archive / merge-archive commands and
 * subscribes to workspace lifecycle events so worktree-backed nestedWorkspaces
 * stay in sync with core state. Workspace creation is owned by the
 * branched-workspaces extension.
 */
import { eventBus, type AppEvent } from "../services/event-bus";
import { registerCommand } from "../services/command-registry";
import {
  archiveWorktreeWorkspace,
  handleWorkspaceClosed,
  handleWorkspaceCreated,
  loadWorktreeEntries,
  mergeAndArchiveWorktreeWorkspace,
} from "../services/worktree-service";

export function initWorktrees(): void {
  loadWorktreeEntries();

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
