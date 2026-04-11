/**
 * Workspace Action Registry
 *
 * Extensions register workspace creation actions (buttons) that appear in
 * the sidebar header and inside project sections. Each action has an icon,
 * label, handler, and optional visibility filter.
 */
import { writable, type Readable } from "svelte/store";

export interface WorkspaceActionContext {
  projectId?: string;
  projectPath?: string;
  projectName?: string;
  isGit?: boolean;
}

export interface WorkspaceAction {
  id: string;
  label: string;
  icon: string;
  shortcut?: string;
  source: string;
  handler: (ctx: WorkspaceActionContext) => void | Promise<void>;
  when?: (ctx: WorkspaceActionContext) => boolean;
}

const actions = writable<WorkspaceAction[]>([]);

export const workspaceActionStore: Readable<WorkspaceAction[]> = actions;

export function registerWorkspaceAction(action: WorkspaceAction): void {
  actions.update((list) => {
    if (list.some((a) => a.id === action.id)) {
      console.warn(
        `[workspace-action-registry] Action "${action.id}" already registered`,
      );
      return list;
    }
    return [...list, action];
  });
}

export function unregisterWorkspaceAction(id: string): void {
  actions.update((list) => list.filter((a) => a.id !== id));
}

export function unregisterWorkspaceActionsBySource(source: string): void {
  actions.update((list) => list.filter((a) => a.source !== source));
}

export function getWorkspaceActions(): WorkspaceAction[] {
  let current: WorkspaceAction[] = [];
  actions.subscribe((v) => (current = v))();
  return current;
}

export function resetWorkspaceActions(): void {
  actions.set([]);
}
