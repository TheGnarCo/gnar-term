/**
 * Preview-surface registry — tracks every open PreviewSurface in the app.
 *
 * The PreviewSurface is core's first-class file-preview surface kind. The
 * registry indexes each mounted PreviewSurface by its surfaceId and
 * remembers its backing file path along with the pane and workspace it
 * lives in. Consumers use this registry to:
 *   - dedupe spawn-by-path (focus an existing preview instead of opening
 *     a duplicate — used by openDashboard for AgentDashboards)
 *   - drive future MCP discovery tools
 *
 * Population is owned by PreviewSurface.svelte's mount/destroy lifecycle
 * so the registry can never disagree with what's actually rendered.
 */
import { writable, get, type Readable } from "svelte/store";

export interface PreviewSurfaceEntry {
  surfaceId: string;
  path: string;
  paneId: string;
  workspaceId: string;
}

const _store = writable<PreviewSurfaceEntry[]>([]);

export const previewSurfaceStore: Readable<PreviewSurfaceEntry[]> = _store;

export function registerPreviewSurface(entry: PreviewSurfaceEntry): void {
  _store.update((list) => {
    const idx = list.findIndex((e) => e.surfaceId === entry.surfaceId);
    if (idx >= 0) {
      const next = [...list];
      next[idx] = entry;
      return next;
    }
    return [...list, entry];
  });
}

export function unregisterPreviewSurface(surfaceId: string): void {
  _store.update((list) => list.filter((e) => e.surfaceId !== surfaceId));
}

export function listPreviewSurfaces(): PreviewSurfaceEntry[] {
  return get(_store);
}

export function findPreviewSurfaceByPath(
  path: string,
): PreviewSurfaceEntry | undefined {
  return get(_store).find((e) => e.path === path);
}

export function resetPreviewSurfaceRegistry(): void {
  _store.set([]);
}
