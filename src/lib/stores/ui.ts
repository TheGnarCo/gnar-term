import { writable } from "svelte/store";
import type { MenuItem } from "../context-menu-types";

export const primarySidebarVisible = writable<boolean>(true);
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
  | { type: "open-preview"; payload: string }
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
    };
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
