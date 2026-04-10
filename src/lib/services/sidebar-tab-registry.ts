/**
 * Secondary Sidebar Tab Registry — store-based tab and action registration.
 *
 * Extensions register tabs (with Svelte components) and actions (with handlers).
 * The SecondarySidebar component reads from these stores.
 *
 * Tabs use the generic registry factory. Actions use a separate store because
 * their identity key is composite (tabId + actionId), not a single id field.
 */
import { writable, type Readable } from "svelte/store";
import { createRegistry } from "./create-registry";

// --- Types ---

export interface SidebarTab {
  id: string;
  label: string;
  icon?: string;
  component: unknown; // Svelte component
  source: string; // extension id
}

export interface SidebarAction {
  tabId: string;
  actionId: string;
  title?: string;
  handler: () => void;
  source: string; // extension id
}

// --- Tab registry (via factory) ---

const tabRegistry = createRegistry<SidebarTab>();

export const sidebarTabStore: Readable<SidebarTab[]> = tabRegistry.store;
export const registerSidebarTab = tabRegistry.register;
export const unregisterSidebarTab = tabRegistry.unregister;

// --- Action store (composite key — manual) ---

const _actions = writable<SidebarAction[]>([]);
export const sidebarActionStore: Readable<SidebarAction[]> = _actions;

export function registerSidebarAction(action: SidebarAction): void {
  _actions.update((list) => {
    const idx = list.findIndex(
      (a) => a.tabId === action.tabId && a.actionId === action.actionId,
    );
    if (idx >= 0) {
      list[idx] = action;
      return [...list];
    }
    return [...list, action];
  });
}

export function unregisterSidebarAction(tabId: string, actionId: string): void {
  _actions.update((list) =>
    list.filter((a) => !(a.tabId === tabId && a.actionId === actionId)),
  );
}

/** Unregister all tabs and actions from a given source extension. */
export function unregisterSidebarTabsBySource(source: string): void {
  tabRegistry.unregisterBySource(source);
  _actions.update((list) => list.filter((a) => a.source !== source));
}

/** Reset all tabs and actions — for testing only. */
export function resetSidebarTabs(): void {
  tabRegistry.reset();
  _actions.set([]);
}
