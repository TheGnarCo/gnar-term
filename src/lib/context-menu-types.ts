import type { Component } from "svelte";

export interface MenuItem {
  label: string;
  action: () => void;
  shortcut?: string;
  separator?: boolean;
  disabled?: boolean;
  danger?: boolean;
  /** Optional leading icon. Rendered at 12x12 to the left of the label. */
  icon?: Component;
}
