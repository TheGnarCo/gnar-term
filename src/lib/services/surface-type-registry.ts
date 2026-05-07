/**
 * Custom Surface Type Registry — store-based surface type registration.
 *
 * Extensions register new surface types beyond the built-in terminal.
 * Core uses the registry to look up the component for a given surface
 * kind when rendering panes. Core has no knowledge of which extensions
 * contribute which types — the registry is the only interface.
 */
import { createRegistry } from "./create-registry";

// --- Types ---

export interface SurfaceTypeDef {
  id: string;
  label: string;
  component: unknown; // Svelte component
  source: string; // extension id
  /**
   * Hide from the "+ new surface" menu. Set by extensions whose surface
   * type requires external context (e.g. a file path, a commit sha) and
   * can't be created from an empty click. Core reads this flag when
   * filtering the NewSurfaceButton dropdown — no extension-ids are
   * hard-coded there.
   */
  hideFromNewSurface?: boolean;
}

// --- Registry ---

const registry = createRegistry<SurfaceTypeDef>();

export const surfaceTypeStore = registry.store;
export const registerSurfaceType = registry.register;
export const unregisterSurfaceTypesBySource = registry.unregisterBySource;
export const resetSurfaceTypes = registry.reset;
