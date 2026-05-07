/**
 * Root Row Renderer Registry — core and extensions contribute Svelte
 * components that render rows inside the Workspaces section's unified
 * list. Core registers "workspace"; extensions can register additional
 * kinds (e.g. "dashboard").
 *
 * Keyed on `kind`. WorkspaceListBlock iterates the rootRows derived
 * store and hands each row off to the component registered under its
 * kind; the component receives `{ id }` as a prop and owns its own
 * presentation + drag hover behavior.
 */
import { createRegistry } from "./create-registry";

export interface RootRowRenderer {
  id: string; // kind (e.g. "workspace", "dashboard")
  source: string; // extension id that registered this renderer
  component: unknown; // Svelte component receiving { id: string }
  /**
   * Optional rail color resolver. Given a row's id, returns the hex
   * color that core should paint the DragGrip rail with — undefined
   * falls back to the theme accent. The same color drives the strong
   * overlay core paints on non-source rows during a root-row drag.
   */
  railColor?: (id: string) => string | undefined;
  /**
   * Optional label resolver. Given a row's id, returns a human-readable
   * name used as the centered label on the strong drag overlay and on
   * the DropGhost tile. Undefined leaves the overlay unlabeled.
   */
  label?: (id: string) => string | undefined;
}

const registry = createRegistry<RootRowRenderer>();

export const rootRowRendererStore = registry.store;
export const registerRootRowRenderer = registry.register;
export const unregisterRootRowRenderersBySource = registry.unregisterBySource;
export const getRootRowRenderer = registry.get;
