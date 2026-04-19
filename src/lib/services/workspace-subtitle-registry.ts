/**
 * Workspace Subtitle Registry — store-based registration for components
 * that render below workspace names in the primary sidebar.
 *
 * Extensions register Svelte components that receive a `workspaceId` prop.
 * Components are rendered in priority order (lower numbers first).
 */
import { derived } from "svelte/store";
import { createRegistry, type RegistryItem } from "./create-registry";

export interface WorkspaceSubtitle extends RegistryItem {
  component: unknown; // Svelte component — receives { workspaceId: string }
  priority: number; // Lower renders first. Default: 50
}

const registry = createRegistry<WorkspaceSubtitle>();

/** Sorted by priority (ascending). */
export const workspaceSubtitleStore = derived(registry.store, ($items) =>
  [...$items].sort((a, b) => a.priority - b.priority),
);

export const registerWorkspaceSubtitle = registry.register;
export const unregisterWorkspaceSubtitlesBySource = registry.unregisterBySource;
export const resetWorkspaceSubtitles = registry.reset;
