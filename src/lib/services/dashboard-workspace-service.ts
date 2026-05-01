import { derived, get, type Readable } from "svelte/store";
import type { Component } from "svelte";
import { nestedWorkspaces } from "../stores/nested-workspace";
import {
  createNestedWorkspaceFromDef,
  switchNestedWorkspace,
} from "./nested-workspace-service";
import { createRegistry } from "./create-registry";

interface DashboardWorkspaceEntry {
  id: string;
  label: string;
  icon: Component;
  component: Component;
  /** Extension ID that registered this entry — used to provide API context when rendering. */
  source: string;
  /** Overrides the workspace row rail/icon color. When absent, falls back to theme accent. */
  accentColor?: string;
}

const registry = createRegistry<DashboardWorkspaceEntry>();

/** Readable Map store — consumers can use `$dashboardWorkspaceRegistry.get(id)`. */
export const dashboardWorkspaceRegistry: Readable<
  Map<string, DashboardWorkspaceEntry>
> = derived(registry.store, ($entries) => {
  const m = new Map<string, DashboardWorkspaceEntry>();
  for (const e of $entries) m.set(e.id, e);
  return m;
});

export function registerDashboardWorkspaceType(
  entry: Omit<DashboardWorkspaceEntry, "source"> & { source?: string },
): void {
  registry.register({ source: "", ...entry });
}

export function unregisterDashboardWorkspaceType(id: string): void {
  registry.unregister(id);
}

function getDashboardEntry(id: string): DashboardWorkspaceEntry | undefined {
  return registry.get(id);
}

// Exported for tests only — resets the registry to empty.
export function clearDashboardRegistry(): void {
  registry.reset();
}

export async function spawnOrNavigate(id: string): Promise<void> {
  const entry = getDashboardEntry(id);
  if (!entry) return;

  const wsList = get(nestedWorkspaces);
  const existingIdx = wsList.findIndex(
    (w) => w.metadata?.dashboardNestedWorkspaceId === id,
  );

  if (existingIdx >= 0) {
    switchNestedWorkspace(existingIdx);
    return;
  }

  await createNestedWorkspaceFromDef({
    name: entry.label,
    metadata: {
      isDashboard: true,
      dashboardNestedWorkspaceId: id,
    },
    layout: { pane: { surfaces: [] } },
  });
}
