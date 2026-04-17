/**
 * Extension-declared sidebar sections.
 *
 * MCP extensions call the `render_sidebar` tool to declare or replace a
 * section in either the primary or secondary sidebar. The section is a
 * hierarchical tree of items; clicks on items fire `sidebar.item_clicked`
 * lifecycle events that extensions poll for.
 */
import { writable, derived } from "svelte/store";

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
}

/** Map keyed by `${side}:${sectionId}` so each section is a single upsert. */
export const extensionSidebarSections = writable<Map<string, SidebarSection>>(
  new Map(),
);

function keyOf(side: "primary" | "secondary", sectionId: string): string {
  return `${side}:${sectionId}`;
}

export function upsertSection(section: SidebarSection): void {
  extensionSidebarSections.update((map) => {
    const next = new Map(map);
    next.set(keyOf(section.side, section.sectionId), section);
    return next;
  });
}

export function removeSection(
  side: "primary" | "secondary",
  sectionId: string,
): void {
  extensionSidebarSections.update((map) => {
    if (!map.has(keyOf(side, sectionId))) return map;
    const next = new Map(map);
    next.delete(keyOf(side, sectionId));
    return next;
  });
}

export const primarySections = derived(extensionSidebarSections, ($map) =>
  Array.from($map.values()).filter((s) => s.side === "primary"),
);

export const secondarySections = derived(extensionSidebarSections, ($map) =>
  Array.from($map.values()).filter((s) => s.side === "secondary"),
);

export function _resetExtensionSidebarForTest(): void {
  extensionSidebarSections.set(new Map());
}
