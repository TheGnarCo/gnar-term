/**
 * Command Registry — store-based command registration for the command palette.
 *
 * Core seeds commands at startup. Extensions append via the ExtensionAPI.
 * The command palette reads from this store.
 */
import { get } from "svelte/store";
import { createRegistry } from "./create-registry";
import { matchesShortcut } from "./shortcut-matcher";

export interface Command {
  id: string;
  title: string;
  shortcut?: string;
  action: (args?: unknown) => void | Promise<void>;
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

/** Execute a registered command by id. Returns false if not found. */
export function runCommandById(id: string, args?: unknown): boolean {
  const cmd = get(commandStore).find((c) => c.id === id);
  if (!cmd) return false;
  void cmd.action(args);
  return true;
}

/**
 * Attempt to execute a command whose shortcut matches the keyboard event.
 * Returns true if a command was matched and executed (and the event was preventDefault'd).
 */
export function executeByShortcut(e: KeyboardEvent): boolean {
  const cmds = get(commandStore);
  for (const cmd of cmds) {
    if (!cmd.shortcut) continue;
    if (matchesShortcut(cmd.shortcut, e)) {
      e.preventDefault();
      void cmd.action();
      return true;
    }
  }
  return false;
}
