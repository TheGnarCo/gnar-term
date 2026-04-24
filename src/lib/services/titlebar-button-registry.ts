import type { Readable } from "svelte/store";
import { createRegistry } from "./create-registry";

export interface TitleBarButton {
  id: string;
  source: string;
  icon: unknown;
  title: string;
  isActive?: Readable<boolean>;
  onClick: () => void;
}

const buttonRegistry = createRegistry<TitleBarButton>();

export const titleBarButtonStore: Readable<TitleBarButton[]> =
  buttonRegistry.store;
export const registerTitleBarButton = buttonRegistry.register;

export function unregisterTitleBarButtonsBySource(source: string): void {
  buttonRegistry.unregisterBySource(source);
}

export function resetTitleBarButtons(): void {
  buttonRegistry.reset();
}
