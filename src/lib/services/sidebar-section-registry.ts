/**
 * Primary Sidebar Section Registry — store-based section registration.
 *
 * Extensions register collapsible sections that appear below the
 * Workspaces section in the primary sidebar. Core owns the header
 * (label + chevron); extensions provide the content component.
 */
import { createRegistry } from "./create-registry";

// --- Types ---

export interface SidebarSection {
  id: string;
  label: string;
  component: unknown; // Svelte component
  source: string; // extension id
  collapsible?: boolean; // default true
  showLabel?: boolean; // default true
}

// --- Registry ---

const registry = createRegistry<SidebarSection>();

export const sidebarSectionStore = registry.store;
export const registerSidebarSection = registry.register;
export const unregisterSidebarSection = registry.unregister;
export const unregisterSidebarSectionsBySource = registry.unregisterBySource;
export const resetSidebarSections = registry.reset;

/** Reorder sections by moving item at `fromIdx` to `toIdx`. */
export function reorderSidebarSections(fromIdx: number, toIdx: number): void {
  registry.reorder(fromIdx, toIdx);
}
