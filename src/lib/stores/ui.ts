import { writable } from "svelte/store";
import type { MenuItem } from "../context-menu-types";

export const sidebarVisible = writable<boolean>(true);
export const sidebarWidth = writable<number>(220);
export const commandPaletteOpen = writable<boolean>(false);
export const findBarVisible = writable<boolean>(false);

/**
 * Per-group collapsed flag, keyed by anchor workspace id. A missing entry
 * defaults to collapsed at the consumer; an explicit `false` keeps a group
 * expanded. No persistence wiring yet — Stage 2 adds it.
 */
export const groupCollapsedState = writable<Map<string, boolean>>(new Map());

/** Set the collapsed flag for a group (keyed by anchor id). */
export function setGroupCollapsed(groupId: string, collapsed: boolean): void {
  groupCollapsedState.update((current) => {
    const next = new Map(current);
    next.set(groupId, collapsed);
    return next;
  });
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

export const contextMenu = writable<ContextMenuState | null>(null);

/** Pending action dispatched from terminal-service.ts for App.svelte to handle */
export type PendingAction =
  | { type: "open-preview"; payload: string }
  | { type: "split-right" }
  | { type: "split-down" };
export const pendingAction = writable<PendingAction | null>(null);

/** Input prompt — replaces window.prompt() which doesn't work in Tauri WKWebView */
export interface InputPromptState {
  placeholder: string;
  defaultValue?: string;
  resolve: (value: string | null) => void;
}
export const inputPrompt = writable<InputPromptState | null>(null);

export function showInputPrompt(placeholder: string, defaultValue?: string): Promise<string | null> {
  return new Promise((resolve) => {
    inputPrompt.set({ placeholder, defaultValue, resolve });
  });
}

/** Yes/no confirmation prompt — in-app modal (WKWebView has no window.confirm). */
export interface ConfirmPromptState {
  message: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  resolve: (value: boolean) => void;
}
export const confirmPrompt = writable<ConfirmPromptState | null>(null);

export function showConfirmPrompt(
  message: string,
  opts: { title?: string; confirmLabel?: string; cancelLabel?: string } = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    confirmPrompt.set({ message, ...opts, resolve });
  });
}
