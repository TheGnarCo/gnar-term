/**
 * NestedWorkspace status registry — stores StatusItems contributed by extensions.
 *
 * One flat registry for all nestedWorkspaces. UI components and extensions
 * consume workspace-filtered derived stores via getWorkspaceStatus().
 */
import { derived, type Readable } from "svelte/store";
import { createRegistry } from "./create-registry";
import type { StatusItem, StatusItemInput } from "../types/status";
import { get } from "svelte/store";

export const statusRegistry = createRegistry<StatusItem>();

// --- Composite ID helpers ---

function compositeId(
  source: string,
  workspaceId: string,
  itemId: string,
): string {
  return `${source}:${workspaceId}:${itemId}`;
}

// --- Write helpers ---

export function setStatusItem(
  source: string,
  workspaceId: string,
  itemId: string,
  input: StatusItemInput,
): void {
  statusRegistry.register({
    ...input,
    id: compositeId(source, workspaceId, itemId),
    source,
    workspaceId,
  });
}

export function clearStatusItem(
  source: string,
  workspaceId: string,
  itemId: string,
): void {
  statusRegistry.unregister(compositeId(source, workspaceId, itemId));
}

export function clearAllStatusForSourceAndWorkspace(
  source: string,
  workspaceId: string,
): void {
  const items = get(statusRegistry.store);
  for (const item of items) {
    if (item.source === source && item.workspaceId === workspaceId) {
      statusRegistry.unregister(item.id);
    }
  }
}

export function clearAllStatusForWorkspace(workspaceId: string): void {
  const items = get(statusRegistry.store);
  for (const item of items) {
    if (item.workspaceId === workspaceId) {
      statusRegistry.unregister(item.id);
    }
  }
}

export function unregisterStatusBySource(source: string): void {
  statusRegistry.unregisterBySource(source);
}

// --- Read helpers (memoized derived stores) ---

const workspaceStatusCache = new Map<string, Readable<StatusItem[]>>();

export function getWorkspaceStatus(
  workspaceId: string,
): Readable<StatusItem[]> {
  let store = workspaceStatusCache.get(workspaceId);
  if (!store) {
    store = derived(statusRegistry.store, ($items) =>
      $items
        .filter((i) => i.workspaceId === workspaceId)
        .sort((a, b) => a.priority - b.priority),
    );
    workspaceStatusCache.set(workspaceId, store);
  }
  return store;
}

const categoryStatusCache = new Map<string, Readable<StatusItem[]>>();

export function getWorkspaceStatusByCategory(
  workspaceId: string,
  category: string,
): Readable<StatusItem[]> {
  const key = `${workspaceId}:${category}`;
  let store = categoryStatusCache.get(key);
  if (!store) {
    store = derived(statusRegistry.store, ($items) =>
      $items
        .filter((i) => i.workspaceId === workspaceId && i.category === category)
        .sort((a, b) => a.priority - b.priority),
    );
    categoryStatusCache.set(key, store);
  }
  return store;
}
