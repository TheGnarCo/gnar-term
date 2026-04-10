/**
 * Command Registry — store-based command registration for the command palette.
 *
 * Core seeds commands at startup. Extensions append via the ExtensionAPI.
 * The command palette reads from this store.
 */
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
export const unregisterCommand = registry.unregister;
export const unregisterBySource = registry.unregisterBySource;
export const resetCommands = registry.reset;
export const commandStore = registry.store;

export function registerCommands(cmds: Command[]): void {
  for (const cmd of cmds) {
    registry.register(cmd);
  }
}
