/**
 * MCP-declared sidebar sections.
 *
 * MCP clients call the `render_sidebar` tool to declare or replace a
 * section in either the primary or secondary sidebar. The section is a
 * hierarchical tree of items; clicks on items fire `sidebar.item_clicked`
 * lifecycle events that clients poll via `poll_events`.
 *
 * This is distinct from the gnar-term extension system (src/extensions/*).
 * Extensions register sidebar tabs/sections via their ExtensionAPI.
 * Here, "sidebar section" is plain data supplied over MCP — rendered by a
 * single component (McpSidebarSection.svelte) that the primary/secondary
 * sidebars loop over.
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
export const mcpSidebarSections = writable<Map<string, SidebarSection>>(
  new Map(),
);

function keyOf(side: "primary" | "secondary", sectionId: string): string {
  return `${side}:${sectionId}`;
}

export function upsertSection(section: SidebarSection): void {
  mcpSidebarSections.update((map) => {
    const next = new Map(map);
    next.set(keyOf(section.side, section.sectionId), section);
    return next;
  });
}

export function removeSection(
  side: "primary" | "secondary",
  sectionId: string,
): void {
  mcpSidebarSections.update((map) => {
    if (!map.has(keyOf(side, sectionId))) return map;
    const next = new Map(map);
    next.delete(keyOf(side, sectionId));
    return next;
  });
}

export const primarySections = derived(mcpSidebarSections, ($map) =>
  Array.from($map.values()).filter((s) => s.side === "primary"),
);

export const secondarySections = derived(mcpSidebarSections, ($map) =>
  Array.from($map.values()).filter((s) => s.side === "secondary"),
);

export function _resetMcpSidebarForTest(): void {
  mcpSidebarSections.set(new Map());
}
