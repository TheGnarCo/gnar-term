import { writable } from "svelte/store";
import type { MenuItem } from "../context-menu-types";

export const sidebarVisible = writable<boolean>(true);
export const commandPaletteOpen = writable<boolean>(false);
export const findBarVisible = writable<boolean>(false);

export interface ContextMenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

export const contextMenu = writable<ContextMenuState | null>(null);

/** Pending action dispatched from terminal-service.ts for App.svelte to handle */
export interface PendingAction {
  type: string;
  payload?: any;
}
export const pendingAction = writable<PendingAction | null>(null);
