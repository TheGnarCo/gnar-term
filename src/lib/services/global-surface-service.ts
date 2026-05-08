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
 * Surface-type id for a registered global surface. Each global surface
 * is mounted as a normal registry surface inside a top-level dashboard
 * workspace; PaneView suppresses the TabBar for these workspaces (see
 * `Workspace.isDashboard && !Workspace.rootWorkspaceId`) so the surface
 * fills the pane chromelessly.
 *
 * The `dashboard:` prefix is preserved verbatim from the previous
 * "dashboard surface" naming — it is stamped onto persisted SurfaceDef
 * records and renaming it would invalidate existing on-disk workspaces.
 * Hidden from the "+ new surface" menu so users don't try to spawn a
 * free-floating global surface from an empty pane.
 */
export function globalSurfaceTypeId(globalSurfaceId: string): string {
  return `dashboard:${globalSurfaceId}`;
}

interface GlobalSurfaceEntry {
  id: string;
  label: string;
  icon: Component;
  /** Extension ID that registered this entry — used to provide API context when rendering. */
  source: string;
  /** Overrides the workspace row rail/icon color. When absent, falls back to theme accent. */
  accentColor?: string;
}

const registry = createRegistry<GlobalSurfaceEntry>();

/** Readable Map store — consumers can use `$globalSurfaceRegistry.get(id)`. */
export const globalSurfaceRegistry: Readable<Map<string, GlobalSurfaceEntry>> =
  derived(registry.store, ($entries) => {
    const m = new Map<string, GlobalSurfaceEntry>();
    for (const e of $entries) m.set(e.id, e);
    return m;
  });

export function registerGlobalSurface(
  entry: Omit<GlobalSurfaceEntry, "source"> & {
    source?: string;
    component: Component;
  },
): void {
  const source = entry.source ?? "";
  registerSurfaceType({
    id: globalSurfaceTypeId(entry.id),
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

export function unregisterGlobalSurface(id: string): void {
  registry.unregister(id);
  unregisterSurfaceType(globalSurfaceTypeId(id));
}

function getGlobalSurfaceEntry(id: string): GlobalSurfaceEntry | undefined {
  return registry.get(id);
}

// Exported for tests only — resets the registry to empty.
export function clearGlobalSurfaceRegistry(): void {
  registry.reset();
}

export async function spawnOrNavigate(id: string): Promise<void> {
  const entry = getGlobalSurfaceEntry(id);
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
            extensionType: globalSurfaceTypeId(id),
            name: entry.label,
            focus: true,
          },
        ],
      },
    },
  });
}
