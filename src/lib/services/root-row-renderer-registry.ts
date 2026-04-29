/**
 * Root Row Renderer Registry — extensions contribute Svelte components
 * that render non-workspace rows (projects today, potentially other
 * kinds later) inside the Workspaces section's unified list.
 *
 * Keyed on `kind`. When WorkspaceListBlock iterates the rootRows
 * derived store, any row whose kind !== "workspace" is handed off to
 * the component registered under that kind; the component receives
 * `{ id }` as a prop and owns its own presentation + drag hover
 * behavior.
 */
import { createRegistry } from "./create-registry";

export interface RootRowRenderer {
  id: string; // kind (e.g. "project")
  source: string; // extension id that registered this renderer
  component: unknown; // Svelte component receiving { id: string }
  /**
   * Optional rail color resolver. Given a row's id, returns the hex
   * color that core should paint the DragGrip rail with. Used for
   * project rows so the rail matches the project's color; undefined
   * falls back to the theme accent. The same color drives the strong
   * overlay core paints on non-source rows during a root-row drag.
   */
  railColor?: (id: string) => string | undefined;
  /**
   * Optional label resolver. Given a row's id, returns a human-readable
   * name used as the centered label on the strong drag overlay and on
   * the DropGhost tile. Projects return the project name; undefined
   * leaves the overlay unlabeled.
   */
  label?: (id: string) => string | undefined;
}

const registry = createRegistry<RootRowRenderer>();

export const rootRowRendererStore = registry.store;
export const registerRootRowRenderer = registry.register;
export const unregisterRootRowRenderersBySource = registry.unregisterBySource;
export const getRootRowRenderer = registry.get;
