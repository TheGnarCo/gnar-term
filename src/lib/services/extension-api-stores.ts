import type { Readable } from "svelte/store";
import {
  workspaces,
  activeWorkspace,
  activePane,
  activeSurface,
} from "../stores/workspace";
import { theme } from "../stores/theme";
import type { ExtensionAPI } from "../extension-types";

/** Read-only store wrappers that project internal state to safe public types. */
export function createStoreProjections(
  extId: string,
): Pick<
  ExtensionAPI,
  "workspaces" | "activeWorkspace" | "activePane" | "activeSurface" | "theme"
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
    workspaces: {
      subscribe(fn: (value: unknown) => void) {
        return workspaces.subscribe((ws) =>
          fn(ws.map((w) => ({ id: w.id, name: w.name }))),
        );
      },
    } as ExtensionAPI["workspaces"],
    activeWorkspace: {
      subscribe(fn: (value: unknown) => void) {
        return activeWorkspace.subscribe((w) =>
          fn(w ? { id: w.id, name: w.name } : null),
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
    theme: readOnly(theme) as unknown as ExtensionAPI["theme"],
  };
}
