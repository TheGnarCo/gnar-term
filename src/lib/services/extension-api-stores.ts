import type { Readable } from "svelte/store";
import {
  nestedWorkspaces,
  activeWorkspace,
  activePane,
  activeSurface,
} from "../stores/workspace";
import { theme } from "../stores/theme";
import {
  reorderContext,
  hoveredSidebarBlockId,
  hoveredRootRowKey,
} from "../stores/ui";
import { agentsStore } from "./agent-detection-service";
import type { ExtensionAPI } from "../extension-types";

/** Read-only store wrappers that project internal state to safe public types. */
export function createStoreProjections(
  extId: string,
): Pick<
  ExtensionAPI,
  | "nestedWorkspaces"
  | "activeWorkspace"
  | "activePane"
  | "activeSurface"
  | "agents"
  | "theme"
  | "reorderContext"
  | "hoveredSidebarBlockId"
  | "hoveredRootRowKey"
> {
  // Read-only store wrappers (strip set/update from Writable)
  const readOnly = <T>(store: {
    subscribe: (fn: (v: T) => void) => () => void;
  }): Readable<T> => ({
    subscribe: store.subscribe,
  });

  // Suppress unused-parameter lint — extId is accepted for API symmetry with
  // the other create*API helpers; future per-extension store filtering may
  // use it.
  void extId;

  return {
    nestedWorkspaces: {
      subscribe(fn: (value: unknown) => void) {
        return nestedWorkspaces.subscribe((ws) =>
          fn(
            ws.map((w) => ({
              id: w.id,
              name: w.name,
              metadata: w.metadata,
            })),
          ),
        );
      },
    } as ExtensionAPI["nestedWorkspaces"],
    activeWorkspace: {
      subscribe(fn: (value: unknown) => void) {
        return activeWorkspace.subscribe((w) =>
          fn(w ? { id: w.id, name: w.name, metadata: w.metadata } : null),
        );
      },
    } as ExtensionAPI["activeWorkspace"],
    activePane: {
      subscribe(fn: (value: unknown) => void) {
        return activePane.subscribe((p) =>
          fn(
            p
              ? {
                  id: p.id,
                  surfaces: p.surfaces.map((s) => ({
                    id: s.id,
                    kind: s.kind,
                    title: s.title,
                    hasUnread: s.hasUnread,
                  })),
                  activeSurfaceId: p.activeSurfaceId,
                }
              : null,
          ),
        );
      },
    } as ExtensionAPI["activePane"],
    activeSurface: {
      subscribe(fn: (value: unknown) => void) {
        return activeSurface.subscribe((s) =>
          fn(
            s
              ? {
                  id: s.id,
                  kind: s.kind,
                  title: s.title,
                  hasUnread: s.hasUnread,
                }
              : null,
          ),
        );
      },
    } as ExtensionAPI["activeSurface"],
    agents: readOnly(agentsStore) as unknown as ExtensionAPI["agents"],
    theme: readOnly(theme) as unknown as ExtensionAPI["theme"],
    reorderContext: readOnly(
      reorderContext,
    ) as unknown as ExtensionAPI["reorderContext"],
    hoveredSidebarBlockId: readOnly(
      hoveredSidebarBlockId,
    ) as unknown as ExtensionAPI["hoveredSidebarBlockId"],
    hoveredRootRowKey: readOnly(
      hoveredRootRowKey,
    ) as unknown as ExtensionAPI["hoveredRootRowKey"],
  };
}
