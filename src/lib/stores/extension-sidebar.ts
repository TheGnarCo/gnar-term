/**
 * Extension-declared sidebar sections, scoped per workspace.
 *
 * MCP extensions call the `render_sidebar` tool to declare or replace a
 * section in either the primary or secondary sidebar of a specific workspace.
 * Sections are workspace-scoped: a section rendered in workspace A is invisible
 * in workspace B. This matches the connection-binding contract — each agent's
 * UI artifacts belong to its host workspace.
 *
 * Click events are emitted as `sidebar.item_clicked` lifecycle events the
 * extension polls for via `poll_events`.
 */
import { writable, derived } from "svelte/store";
import { activeWorkspace } from "./workspace";

export interface SidebarItem {
  id: string;
  label: string;
  icon?: string;
  indent?: number;
  children?: SidebarItem[];
}

export interface SidebarSection {
  side: "primary" | "secondary";
  sectionId: string;
  title: string;
  items: SidebarItem[];
  workspaceId: string;
}

/** Map keyed by `${workspaceId}:${side}:${sectionId}`. */
export const extensionSidebarSections = writable<Map<string, SidebarSection>>(
  new Map(),
);

function keyOf(
  workspaceId: string,
  side: "primary" | "secondary",
  sectionId: string,
): string {
  return `${workspaceId}:${side}:${sectionId}`;
}

export function upsertSection(section: SidebarSection): void {
  extensionSidebarSections.update((map) => {
    const next = new Map(map);
    next.set(keyOf(section.workspaceId, section.side, section.sectionId), section);
    return next;
  });
}

export function removeSection(
  workspaceId: string,
  side: "primary" | "secondary",
  sectionId: string,
): void {
  extensionSidebarSections.update((map) => {
    const k = keyOf(workspaceId, side, sectionId);
    if (!map.has(k)) return map;
    const next = new Map(map);
    next.delete(k);
    return next;
  });
}

/** Remove every section that belongs to a workspace (called on workspace
 *  destruction so dead sections don't accumulate forever). */
export function removeSectionsForWorkspace(workspaceId: string): void {
  extensionSidebarSections.update((map) => {
    const next = new Map<string, SidebarSection>();
    for (const [k, v] of map) {
      if (v.workspaceId !== workspaceId) next.set(k, v);
    }
    return next;
  });
}

/** Sections in the active workspace's primary sidebar. */
export const primarySections = derived(
  [extensionSidebarSections, activeWorkspace],
  ([$map, $ws]) => {
    if (!$ws) return [];
    return Array.from($map.values()).filter(
      (s) => s.side === "primary" && s.workspaceId === $ws.id,
    );
  },
);

/** Sections in the active workspace's secondary sidebar. */
export const secondarySections = derived(
  [extensionSidebarSections, activeWorkspace],
  ([$map, $ws]) => {
    if (!$ws) return [];
    return Array.from($map.values()).filter(
      (s) => s.side === "secondary" && s.workspaceId === $ws.id,
    );
  },
);

export function _resetExtensionSidebarForTest(): void {
  extensionSidebarSections.set(new Map());
}
