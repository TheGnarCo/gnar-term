/**
 * Dashboard Section Registry — extensions register reusable dashboard
 * "sections" (issue lists, kanban boards, etc.) by id. Other dashboard
 * bodies look the section up by id and mount it via ExtensionWrapper so
 * the wrapped component sees the registering extension's API.
 *
 * Parallel to (and intentionally simpler than) markdown-component-registry:
 * no widget config schema, no markdown serialization — sections are
 * mounted directly with ordinary Svelte props.
 */
import type { Component } from "svelte";
import { createRegistry } from "./create-registry";

export interface DashboardSectionEntry {
  /** Stable section id. Looked up by `id` from any dashboard body. */
  id: string;
  /** Source extension that registered this section. ExtensionWrapper
   * uses this to resolve the API context when the section is mounted. */
  source: string;
  /** The Svelte component that renders this section. */
  component: Component;
}

const registry = createRegistry<DashboardSectionEntry>();

export function registerDashboardSection(entry: DashboardSectionEntry): void {
  registry.register(entry);
}

export function unregisterDashboardSection(id: string): void {
  registry.unregister(id);
}

export function getDashboardSection(
  id: string,
): DashboardSectionEntry | undefined {
  return registry.get(id);
}

export const dashboardSectionStore = registry.store;

export function resetDashboardSections(): void {
  registry.reset();
}
