/**
 * Markdown-component registry — store-based registration of live components
 * that can be embedded inside a markdown preview document.
 *
 * Markdown rendered via the core preview pipeline may contain fenced
 * code blocks with the info-string `gnar:<component-name>`. The
 * markdown previewer splits the source into chunks (markdown vs.
 * widget directives) and looks each component name up in this
 * registry — registered components mount as live Svelte components,
 * unknown names render as a fallback chunk.
 *
 * Conflict resolution: last-wins. Re-registering a component with the
 * same name replaces the previous entry — matches the behavior of
 * sidebar-tab-registry, surface-type-registry, and friends.
 */
import { createRegistry, type SourcedItem } from "./create-registry";
import type { Readable } from "svelte/store";

// --- Types ---

export interface MarkdownComponent extends SourcedItem {
  /** The component identifier. Matches the suffix after `gnar:` in fenced info strings. */
  name: string;
  /** Svelte component. Receives the parsed YAML config object as props. */
  component: unknown;
  /** Source of the registration (extension id, "core", or a built-in id). */
  source: string;
  /**
   * Optional declarative schema for the component's config block.
   * Reserved so future phases (settings UI, MCP discoverability) can
   * introspect what a component accepts.
   */
  configSchema?: Record<string, unknown>;
}

// --- Registry ---

const registry = createRegistry<MarkdownComponent>({
  getId: (w) => w.name,
});

export const markdownComponentStore: Readable<MarkdownComponent[]> =
  registry.store;

export function registerMarkdownComponent(component: MarkdownComponent): void {
  registry.register(component);
}

export function unregisterMarkdownComponentsBySource(source: string): void {
  registry.unregisterBySource(source);
}

export function getMarkdownComponent(
  name: string,
): MarkdownComponent | undefined {
  return registry.get(name);
}

export function listMarkdownComponents(): MarkdownComponent[] {
  // Dereference the store synchronously.
  let snapshot: MarkdownComponent[] = [];
  const unsub = registry.store.subscribe((value) => {
    snapshot = value;
  });
  unsub();
  return snapshot;
}

/** Reset the registry — for testing only. */
export function resetMarkdownComponents(): void {
  registry.reset();
}
