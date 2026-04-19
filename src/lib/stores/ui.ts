import { writable, derived } from "svelte/store";
import type { MenuItem } from "../context-menu-types";

export const isFullscreen = writable<boolean>(false);
export const primarySidebarVisible = writable<boolean>(true);

/**
 * Id of the primary-sidebar block currently hovered (mouseenter on its
 * drag-grip column). `__workspaces__` for the built-in Workspaces block,
 * the namespaced section id (e.g. `project-scope:projects`) otherwise,
 * `null` when no block is hovered. Section-header banners subscribe to
 * decide whether to paint the dark-dot frit over the rail-overlap zone.
 */
export const hoveredSidebarBlockId = writable<string | null>(null);

/**
 * Key of the root row currently hovered inside the Workspaces section
 * — encoded as `"kind:id"` (e.g. `"project:p-42"`, `"workspace:w-7"`),
 * or null when no row is hovered. Row renderers (ProjectRowBody,
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
 * True while a within-block (row-level) reorder is in progress. Derived —
 * do not write directly; update `reorderContext` instead.
 */
export const innerReorderActive = derived(
  reorderContext,
  ($ctx) => $ctx?.kind === "workspace" || $ctx?.kind === "project",
);

/**
 * True while a block-level (section) reorder is in progress. Derived —
 * do not write directly; update `reorderContext` instead.
 */
export const blockReorderActive = derived(
  reorderContext,
  ($ctx) => $ctx?.kind === "section",
);

/** When set, the settings overlay opens to this page ("general", "extensions", "ext:<id>") */
export const settingsPage = writable<string | null>(null);
export const primarySidebarWidth = writable<number>(220);
export const secondarySidebarVisible = writable<boolean>(false);
export const secondarySidebarWidth = writable<number>(220);
export const commandPaletteOpen = writable<boolean>(false);
export const findBarVisible = writable<boolean>(false);
export const settingsOpen = writable<boolean>(false);

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
  | {
      type: "create-workspace";
      name: string;
      cwd: string;
      options?: {
        env?: Record<string, string>;
        metadata?: Record<string, unknown>;
      };
    }
  | { type: "open-in-editor"; filePath: string }
  | {
      type: "open-surface";
      surfaceTypeId: string;
      title: string;
      props?: Record<string, unknown>;
    }
  | { type: "switch-workspace"; workspaceId: string }
  | { type: "close-workspace"; workspaceId: string };
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

/** Form prompt — multi-field dialog
 *
 * Field types:
 *   - text (default): free-text input
 *   - select:         dropdown of pre-defined options
 *   - info:           read-only label (useful for showing context like a
 *                     worktree path during a confirm dialog)
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
      options: Array<{ label: string; value: string }>;
    }
  | {
      key: string;
      label: string;
      defaultValue?: string;
      type: "info";
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
