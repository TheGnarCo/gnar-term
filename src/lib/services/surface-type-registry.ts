/**
 * Custom Surface Type Registry — store-based surface type registration.
 *
 * Extensions register new surface types (beyond the built-in terminal and
 * preview types). Core uses the registry to look up the component for a
 * given surface kind when rendering panes.
 */
import { createRegistry } from "./create-registry";

// --- Types ---

export interface SurfaceTypeDef {
  id: string;
  label: string;
  component: unknown; // Svelte component
  source: string; // extension id
}

// --- Registry ---

const registry = createRegistry<SurfaceTypeDef>();

export const surfaceTypeStore = registry.store;
export const registerSurfaceType = registry.register;
export const unregisterSurfaceTypesBySource = registry.unregisterBySource;
export const resetSurfaceTypes = registry.reset;
