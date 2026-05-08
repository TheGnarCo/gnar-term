import { derived, get, type Readable } from "svelte/store";
import type { Component } from "svelte";
import { workspaces } from "../stores/workspace";
import {
  createWorkspaceFromDef,
  switchWorkspace,
} from "./workspace-runtime-service";
import { createRegistry } from "./create-registry";
import {
  registerSurfaceType,
  unregisterSurfaceType,
} from "./surface-type-registry";

/**
 * Surface-type id derived from a dashboard workspace registration. Each
 * dashboard component is mounted as a normal extension surface, so the
 * pane keeps its tab bar, split affordances, and tab-add menu — users
 * can split a dashboard and put a terminal next to it without losing
 * the dashboard surface. Hidden from the "+ new surface" menu so users
 * don't try to spawn a free-floating dashboard surface from an empty pane.
 */
export function dashboardSurfaceTypeId(dashboardId: string): string {
  return `dashboard:${dashboardId}`;
}

interface DashboardWorkspaceEntry {
  id: string;
  label: string;
  icon: Component;
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
  entry: Omit<DashboardWorkspaceEntry, "source"> & {
    source?: string;
    component: Component;
  },
): void {
  const source = entry.source ?? "";
  registerSurfaceType({
    id: dashboardSurfaceTypeId(entry.id),
    label: entry.label,
    component: entry.component,
    source,
    hideFromNewSurface: true,
  });
  registry.register({
    id: entry.id,
    label: entry.label,
    icon: entry.icon,
    source,
    accentColor: entry.accentColor,
  });
}

export function unregisterDashboardWorkspaceType(id: string): void {
  registry.unregister(id);
  unregisterSurfaceType(dashboardSurfaceTypeId(id));
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

  const wsList = get(workspaces);
  const existingIdx = wsList.findIndex(
    (w) => w.dashboardContributionId === id && w.rootWorkspaceId === undefined,
  );

  if (existingIdx >= 0) {
    switchWorkspace(existingIdx);
    return;
  }

  await createWorkspaceFromDef({
    name: entry.label,
    isDashboard: true,
    dashboardContributionId: id,
    layout: {
      pane: {
        surfaces: [
          {
            type: "registry",
            extensionType: dashboardSurfaceTypeId(id),
            name: entry.label,
            focus: true,
          },
        ],
      },
    },
  });
}
