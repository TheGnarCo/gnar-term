/**
 * Command Registry — store-based command registration for the command palette.
 *
 * Core seeds commands at startup. Extensions append via the ExtensionAPI.
 * The command palette reads from this store.
 */
import { get } from "svelte/store";
import { createRegistry } from "./create-registry";

export interface Command {
  id: string;
  title: string;
  shortcut?: string;
  action: () => void | Promise<void>;
  source: string;
}

const registry = createRegistry<Command>();

export const registerCommand = registry.register;
export const unregisterBySource = registry.unregisterBySource;
export const resetCommands = registry.reset;
export const commandStore = registry.store;

export function registerCommands(cmds: Command[]): void {
  for (const cmd of cmds) {
    registry.register(cmd);
  }
}

interface KeyDescriptor {
  key: string;
  meta: boolean;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

function parseShortcut(shortcut: string): KeyDescriptor | null {
  if (!shortcut) return null;

  let meta = false;
  let ctrl = false;
  let shift = false;
  let alt = false;

  // Normalize Mac symbol format: ⌘=meta, ⇧=shift, ⌥=alt, ⌃=ctrl
  let s = shortcut;
  if (s.includes("⌘")) {
    meta = true;
    s = s.replaceAll("⌘", "");
  }
  if (s.includes("⇧")) {
    shift = true;
    s = s.replaceAll("⇧", "");
  }
  if (s.includes("⌥")) {
    alt = true;
    s = s.replaceAll("⌥", "");
  }
  if (s.includes("⌃")) {
    ctrl = true;
    s = s.replaceAll("⌃", "");
  }

  // Normalize "Ctrl+Shift+X" format
  const parts = s
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
  for (let i = 0; i < parts.length - 1; i++) {
    const mod = parts[i]!.toLowerCase();
    if (mod === "ctrl") ctrl = true;
    else if (mod === "shift") shift = true;
    else if (mod === "alt") alt = true;
    else if (mod === "meta" || mod === "cmd") meta = true;
  }

  const key = parts[parts.length - 1];
  if (!key) return null;

  return { key: key.toLowerCase(), meta, ctrl, shift, alt };
}

/**
 * Attempt to execute a command whose shortcut matches the keyboard event.
 * Returns true if a command was matched and executed (and the event was preventDefault'd).
 */
export function executeByShortcut(e: KeyboardEvent): boolean {
  const cmds = get(commandStore);
  for (const cmd of cmds) {
    if (!cmd.shortcut) continue;
    const desc = parseShortcut(cmd.shortcut);
    if (!desc) continue;
    if (
      e.key.toLowerCase() === desc.key &&
      e.metaKey === desc.meta &&
      e.ctrlKey === desc.ctrl &&
      e.shiftKey === desc.shift &&
      e.altKey === desc.alt
    ) {
      e.preventDefault();
      void cmd.action();
      return true;
    }
  }
  return false;
}
