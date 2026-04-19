/**
 * Secondary Sidebar Tab Registry — store-based tab and action registration.
 *
 * Extensions register tabs (with Svelte components) and actions (with handlers).
 * The SecondarySidebar component reads from these stores.
 *
 * Both tabs and actions ride the generic registry factory — actions use
 * `getId` to key on the composite `${tabId}:${actionId}` pair.
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

// --- Tab registry ---

const tabRegistry = createRegistry<SidebarTab>();

export const sidebarTabStore: Readable<SidebarTab[]> = tabRegistry.store;
export const registerSidebarTab = tabRegistry.register;

// --- Action registry (composite key via getId) ---

const actionRegistry = createRegistry<SidebarAction>({
  getId: (a) => `${a.tabId}:${a.actionId}`,
});

export const sidebarActionStore: Readable<SidebarAction[]> =
  actionRegistry.store;
export const registerSidebarAction = actionRegistry.register;

/** Unregister all tabs and actions from a given source extension. */
export function unregisterSidebarTabsBySource(source: string): void {
  tabRegistry.unregisterBySource(source);
  actionRegistry.unregisterBySource(source);
}

// --- Badge store (tab-level unread indicator) ---

const _badges = writable<Record<string, boolean>>({});
export const sidebarTabBadgeStore: Readable<Record<string, boolean>> = _badges;

export function setSidebarTabBadge(tabId: string, value: boolean): void {
  _badges.update((m) => ({ ...m, [tabId]: value }));
}

export function clearSidebarTabBadge(tabId: string): void {
  _badges.update((m) => {
    const next = { ...m };
    delete next[tabId];
    return next;
  });
}

export function resetSidebarTabBadges(): void {
  _badges.set({});
}

// --- Programmatic tab activation ---

const _activeTab = writable<string | null>(null);
export const activeSidebarTabStore = _activeTab;

export function activateSidebarTab(tabId: string): void {
  _activeTab.set(tabId);
}

/** Reset all tabs and actions — for testing only. */
export function resetSidebarTabs(): void {
  tabRegistry.reset();
  actionRegistry.reset();
  _badges.set({});
  _activeTab.set(null);
}
