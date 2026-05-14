import { writable, derived } from "svelte/store";
import type { MenuItem } from "../context-menu-types";

export const isFullscreen = writable<boolean>(false);

/**
 * True while the pointer is inside the application window. Flips to
 * false when the cursor leaves the window edge OR the window loses
 * focus. Sidebar rows watch this to force-clear stuck hover state —
 * native `mouseleave` on a row can be skipped when the cursor exits
 * via the leftmost viewport pixel (rail-flush rows), leaving the row
 * painted in its hover variant. Subscribers reactively zero their
 * local hover when this flips false.
 *
 * Wired once at app startup via `installPointerWindowListeners`.
 */
export const pointerInsideWindow = writable<boolean>(true);

let _pointerListenersInstalled = false;
export function installPointerWindowListeners(): () => void {
  if (_pointerListenersInstalled || typeof document === "undefined") {
    return () => {};
  }
  _pointerListenersInstalled = true;

  const drop = () => pointerInsideWindow.set(false);
  const claim = () => pointerInsideWindow.set(true);
  // mouseout with no relatedTarget = cursor left the window.
  const onMouseOut = (e: MouseEvent) => {
    if (!e.relatedTarget) pointerInsideWindow.set(false);
  };

  document.addEventListener("mouseleave", drop);
  document.addEventListener("pointerleave", drop);
  document.addEventListener("mouseenter", claim);
  document.addEventListener("pointerenter", claim);
  window.addEventListener("blur", drop);
  window.addEventListener("focus", claim);
  document.addEventListener("mouseout", onMouseOut);

  return () => {
    document.removeEventListener("mouseleave", drop);
    document.removeEventListener("pointerleave", drop);
    document.removeEventListener("mouseenter", claim);
    document.removeEventListener("pointerenter", claim);
    window.removeEventListener("blur", drop);
    window.removeEventListener("focus", claim);
    document.removeEventListener("mouseout", onMouseOut);
    _pointerListenersInstalled = false;
  };
}

/**
 * Primary sidebar expanded/collapsed state. Persisted in AppState as
 * `sidebarVisible` (boolean) by `sidebar-persistence-service` so the
 * user's choice survives across launches.
 *
 *   true  — expanded: full-width sidebar takes layout space.
 *   false — collapsed: 4px rail-only slot; full sidebar appears as
 *           a per-row popover over the terminal area, and the
 *           "+ New" split button moves to the TitleBar.
 *
 * The boolean keeps its historical name (and persisted key) for
 * AppState migration — pre-existing `false` values now read as
 * "collapsed" instead of "hidden", which is the intended upgrade.
 */
export const sidebarVisible = writable<boolean>(true);

/**
 * Id of the sidebar block currently hovered (mouseenter on its
 * drag-grip column). `__workspaces__` for the built-in Workspaces block,
 * the namespaced section id (e.g. `workspaces:workspaces`) otherwise,
 * `null` when no block is hovered. Section-header banners subscribe to
 * decide whether to paint the dark-dot frit over the rail-overlap zone.
 */
export const hoveredSidebarBlockId = writable<string | null>(null);

/**
 * Per-banner collapsed state, keyed by `scopeId` (the workspace id for
 * root banners). Lifted out of SidebarBanner local state so the
 * popover banner (rendered when the sidebar is collapsed) and the
 * main-view banner (the same row clipped to the 12px rail strip)
 * share one source of truth — toggling one keeps the rail height in
 * the other in sync. Missing entries default to `true` (collapsed) at
 * the consumer; explicit entries are persisted across launches via
 * `services/sidebar-persistence-service`.
 */
export const bannerCollapsedState = writable<Map<string, boolean>>(new Map());

export function setBannerCollapsed(scopeId: string, value: boolean): void {
  bannerCollapsedState.update((m) => {
    if ((m.get(scopeId) ?? true) === value) return m;
    const n = new Map(m);
    n.set(scopeId, value);
    return n;
  });
}

/**
 * Key of the root row currently hovered inside the Workspaces section
 * — encoded as `"kind:id"` (e.g. `"workspace:g-42"`, `"branch:w-7"`),
 * or null when no row is hovered. Row renderers (WorkspaceRowBody,
 * WorkspaceItem-in-root mode) subscribe to decide whether their rail
 * is in the expanded hover state.
 */
export const hoveredRootRowKey = writable<string | null>(null);

import type { ReorderContext } from "../../extensions/api";
export type { ReorderContext };

/**
 * The sidebar drag-reorder currently in progress, or null when nothing is
 * being dragged. Canonical type lives in extensions/api.ts so the extension
 * public surface can consume it.
 */
export const reorderContext = writable<ReorderContext | null>(null);

/**
 * True while any sidebar reorder is in progress. Consumers use this to
 * suppress hover-expand on non-source DragGrips and to gate canStart on
 * all drag handles.
 */
export const anyReorderActive = derived(
  reorderContext,
  ($ctx) => $ctx !== null,
);

/**
 * True when the sidebar is in a state where banner drag is allowed:
 * sidebar expanded AND no reorder already in flight. While the sidebar
 * is collapsed the rails act as a visual index only — drag is disabled
 * to keep the rail strip stable while the cursor hovers it.
 */
export const canSidebarDrag = derived(
  [sidebarVisible, anyReorderActive],
  ([$visible, $reordering]) => $visible && !$reordering,
);

/**
 * True while a within-block (row-level) reorder is in progress. Derived —
 * do not write directly; update `reorderContext` instead.
 */
export const innerReorderActive = derived(
  reorderContext,
  ($ctx) => $ctx?.kind === "branch" || $ctx?.kind === "workspace",
);

/**
 * True while a block-level (section) reorder is in progress. Derived —
 * do not write directly; update `reorderContext` instead.
 */
export const blockReorderActive = derived(
  reorderContext,
  ($ctx) => $ctx?.kind === "section",
);

export const sidebarWidth = writable<number>(220);
export const commandPaletteOpen = writable<boolean>(false);
export const findBarVisible = writable<boolean>(false);

export interface ContextMenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

export const contextMenu = writable<ContextMenuState | null>(null);

/** Pending action dispatched from terminal-service.ts for App.svelte to handle */
export type PendingAction =
  | { type: "split-right" }
  | { type: "split-down" }
  | { type: "open-in-editor"; filePath: string }
  | {
      type: "open-surface";
      surfaceTypeId: string;
      title: string;
      props?: Record<string, unknown>;
    }
  | { type: "switch-workspace"; workspaceId: string }
  | { type: "close-workspace"; workspaceId: string }
  | { type: "open-preview"; target: string };
export const pendingAction = writable<PendingAction | null>(null);

/** Input prompt — replaces window.prompt() which doesn't work in Tauri WKWebView */
export interface InputPromptState {
  placeholder: string;
  defaultValue?: string;
  resolve: (value: string | null) => void;
}
export const inputPrompt = writable<InputPromptState | null>(null);

export function showInputPrompt(
  placeholder: string,
  defaultValue?: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    inputPrompt.set({ placeholder, defaultValue, resolve });
  });
}

/**
 * Confirmation prompt — themed replacement for window.confirm() which
 * Tauri v2 blocks without the dialog plugin capability.
 */
interface ConfirmPromptState {
  message: string;
  title?: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  resolve: (value: boolean) => void;
}
export const confirmPrompt = writable<ConfirmPromptState | null>(null);

export function showConfirmPrompt(
  message: string,
  options?: {
    title?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
  },
): Promise<boolean> {
  return new Promise((resolve) => {
    confirmPrompt.set({
      message,
      title: options?.title,
      confirmLabel: options?.confirmLabel ?? "Confirm",
      cancelLabel: options?.cancelLabel ?? "Cancel",
      danger: options?.danger,
      resolve,
    });
  });
}

/** Form prompt — multi-field dialog
 *
 * Field types:
 *   - text (default): free-text input
 *   - select:         dropdown of pre-defined options
 *   - info:           read-only label (useful for showing context like a
 *                     worktree path during a confirm dialog)
 *   - color:          swatch picker over WORKSPACE_COLOR_SLOTS (matches
 *                     the chrome used by workspace creation)
 */
export type FormField =
  | {
      key: string;
      label: string;
      defaultValue?: string;
      placeholder?: string;
      type?: "text";
    }
  | {
      key: string;
      label: string;
      defaultValue?: string;
      type: "select";
      /** Optional `group` tags each option as belonging to a named
       *  `<optgroup>`. Groups render in the order they first appear in
       *  the options list, with ungrouped options rendering before any
       *  group. Pass options pre-sorted; the renderer preserves order. */
      options: Array<{ label: string; value: string; group?: string }>;
    }
  | {
      key: string;
      label: string;
      defaultValue?: string;
      type: "info";
    }
  | {
      key: string;
      label: string;
      defaultValue?: string;
      type: "color";
    }
  | {
      key: string;
      label: string;
      defaultValue?: string;
      placeholder?: string;
      type: "directory";
      required?: boolean;
      pickerTitle?: string;
      /** When true, the Browse button is hidden — the value is shown
       *  but not editable. Use when the caller has already resolved
       *  the directory and the user shouldn't be able to repoint it
       *  (e.g. a dashboard spawned inside a workspace inherits the
       *  workspace's path). */
      readonly?: boolean;
    };
export interface FormPromptState {
  title: string;
  fields: FormField[];
  error?: string;
  submitLabel?: string;
  resolve: (values: Record<string, string> | null) => void;
}
export const formPrompt = writable<FormPromptState | null>(null);

export function showFormPrompt(
  title: string,
  fields: FormField[],
  options?: { submitLabel?: string },
): Promise<Record<string, string> | null> {
  return new Promise((resolve) => {
    formPrompt.set({
      title,
      fields,
      submitLabel: options?.submitLabel,
      resolve,
    });
  });
}

export const renamingSurfaceId = writable<string | null>(null);
