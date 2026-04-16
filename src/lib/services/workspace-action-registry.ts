/**
 * Workspace Action Registry
 *
 * Extensions register workspace actions (buttons) that appear in
 * the sidebar header or top bar. Each action has an icon, label,
 * zone, handler, and optional visibility filter.
 */
import { get } from "svelte/store";
import { createRegistry, type RegistryItem } from "./create-registry";
import type { WorkspaceActionContext } from "../extension-types";

export type { WorkspaceActionContext };

export interface WorkspaceAction extends RegistryItem {
  label: string;
  icon: string;
  shortcut?: string;
  /** Where the action appears: "workspace" (default) in the workspace header,
   *  "sidebar" in the top bar alongside reorder. */
  zone?: "workspace" | "sidebar";
  handler: (ctx: WorkspaceActionContext) => void | Promise<void>;
  when?: (ctx: WorkspaceActionContext) => boolean;
}

const registry = createRegistry<WorkspaceAction>();

export const workspaceActionStore = registry.store;
export const registerWorkspaceAction = registry.register;
export const unregisterWorkspaceActionsBySource = registry.unregisterBySource;
export const resetWorkspaceActions = registry.reset;

export function getWorkspaceActions(): WorkspaceAction[] {
  return get(registry.store);
}
