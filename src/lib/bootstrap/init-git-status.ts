/**
 * Git Status bootstrap — registers the workspace subtitle component,
 * starts the polling service, and wires workspace lifecycle events to
 * the per-workspace polling state.
 */
import { eventBus, type AppEvent } from "../services/event-bus";
import { registerWorkspaceSubtitle } from "../services/workspace-subtitle-registry";
import {
  GIT_STATUS_SOURCE,
  startGitStatusService,
  handleWorkspaceActivated,
  handleWorkspaceCreated,
  handleWorkspaceClosed,
} from "../services/git-status-service";
import GitStatusLine from "../components/GitStatusLine.svelte";
import WorkspaceDiffPrSubtitle from "../components/WorkspaceDiffPrSubtitle.svelte";

export function initGitStatus(): void {
  registerWorkspaceSubtitle({
    id: `${GIT_STATUS_SOURCE}:subtitle`,
    source: GIT_STATUS_SOURCE,
    component: GitStatusLine,
    priority: 10,
  });

  registerWorkspaceSubtitle({
    id: `${GIT_STATUS_SOURCE}:diff-pr-subtitle`,
    source: GIT_STATUS_SOURCE,
    component: WorkspaceDiffPrSubtitle,
    priority: 20,
  });

  startGitStatusService();

  eventBus.on("workspace:activated", (event: AppEvent) => {
    if (event.type !== "workspace:activated") return;
    handleWorkspaceActivated(event.id);
  });

  eventBus.on("workspace:created", (event: AppEvent) => {
    if (event.type !== "workspace:created") return;
    handleWorkspaceCreated(event.id);
  });

  eventBus.on("workspace:closed", (event: AppEvent) => {
    if (event.type !== "workspace:closed") return;
    handleWorkspaceClosed(event.id);
  });
}
