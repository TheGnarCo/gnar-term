import { writable } from "svelte/store";
import type { MenuItem } from "../context-menu-types";

export const isFullscreen = writable<boolean>(false);
export const primarySidebarVisible = writable<boolean>(true);

/**
 * True while a within-block drag-reorder is in progress (workspace row,
 * project row, etc.). Outer-block drag grips hide and outer-block
 * drag-start is suppressed while this is true, so the two reorder contexts
 * never compete.
 */
export const innerReorderActive = writable<boolean>(false);

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

/** Form prompt — multi-field dialog */
export interface FormField {
  key: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
}
export interface FormPromptState {
  title: string;
  fields: FormField[];
  error?: string;
  resolve: (values: Record<string, string> | null) => void;
}
export const formPrompt = writable<FormPromptState | null>(null);

export function showFormPrompt(
  title: string,
  fields: FormField[],
): Promise<Record<string, string> | null> {
  return new Promise((resolve) => {
    formPrompt.set({ title, fields, resolve });
  });
}
