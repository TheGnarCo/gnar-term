/**
 * Overlay Registry — store-based overlay registration.
 *
 * Extensions register overlay components (dialogs, dashboards, modals)
 * that render above the main UI. App.svelte reads from this store and
 * renders all registered overlays generically.
 */
import { createRegistry } from "./create-registry";

export interface OverlayEntry {
  id: string;
  component: unknown; // Svelte component
  source: string; // extension id
  props?: Record<string, unknown>;
}

const registry = createRegistry<OverlayEntry>();

export const overlayStore = registry.store;
export const registerOverlay = registry.register;
export const unregisterOverlay = registry.unregister;
export const unregisterOverlaysBySource = registry.unregisterBySource;
export const resetOverlays = registry.reset;
