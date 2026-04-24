import { writable, get } from "svelte/store";
import type { Component } from "svelte";
import { workspaces } from "../stores/workspace";
import { createWorkspaceFromDef, switchWorkspace } from "./workspace-service";

export interface DashboardWorkspaceEntry {
  id: string;
  label: string;
  icon: Component;
  component: Component;
}

export const dashboardWorkspaceRegistry = writable<
  Map<string, DashboardWorkspaceEntry>
>(new Map());

export function registerDashboardWorkspaceType(
  entry: DashboardWorkspaceEntry,
): void {
  dashboardWorkspaceRegistry.update((m) => {
    const next = new Map(m);
    next.set(entry.id, entry);
    return next;
  });
}

export function unregisterDashboardWorkspaceType(id: string): void {
  dashboardWorkspaceRegistry.update((m) => {
    const next = new Map(m);
    next.delete(id);
    return next;
  });
}

export function getDashboardEntry(
  id: string,
): DashboardWorkspaceEntry | undefined {
  return get(dashboardWorkspaceRegistry).get(id);
}

// Exported for tests only — resets the registry to empty.
export function clearDashboardRegistry(): void {
  dashboardWorkspaceRegistry.set(new Map());
}

export async function spawnOrNavigate(id: string): Promise<void> {
  const entry = getDashboardEntry(id);
  if (!entry) return;

  const wsList = get(workspaces);
  const existingIdx = wsList.findIndex(
    (w) => (w.metadata as Record<string, unknown>)?.dashboardWorkspaceId === id,
  );

  if (existingIdx >= 0) {
    switchWorkspace(existingIdx);
    return;
  }

  await createWorkspaceFromDef({
    name: entry.label,
    metadata: {
      isDashboard: true,
      dashboardWorkspaceId: id,
    },
    layout: { pane: { surfaces: [] } },
  });
}
