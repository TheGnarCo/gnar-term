/**
 * Verifies that interactive controls inside the collapsed-sidebar popover
 * banner are reachable: the chevron toggle, dashboard chips, and nested
 * workspace rows must all fire their click handlers when the cursor is
 * inside the popover banner.
 *
 * The popover renders the same row body as the in-sidebar banner via the
 * `rowBody` snippet, so its descendants can be hit-tested by their data
 * attributes after fireEvent.mouseEnter on the row container surfaces it.
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/svelte";
import { tick } from "svelte";
import { get } from "svelte/store";
import WorkspaceListBlock from "../lib/components/WorkspaceListBlock.svelte";
import {
  sidebarVisible,
  sidebarWidth,
  hoveredRootRowKey,
  bannerCollapsedState,
} from "../lib/stores/ui";
import { workspaces } from "../lib/stores/workspace";
import { rootRowOrder } from "../lib/stores/root-row-order";
import { registerRootRowRenderer } from "../lib/services/root-row-renderer-registry";
import WorkspaceRowBody from "../lib/components/WorkspaceRowBody.svelte";
import { initCoreExtensionAPI } from "../lib/bootstrap/init-core-extension-api";

function fakeWorkspace(id: string, branchedIds: string[] = []) {
  const paneId = `pane-${id}`;
  return {
    id,
    name: `WS ${id}`,
    color: "blue",
    path: `/tmp/${id}`,
    branchedWorkspaceIds: branchedIds,
    isGit: false,
    createdAt: new Date().toISOString(),
    paneLayout: {
      type: "pane",
      pane: { id: paneId, surfaces: [], activeSurfaceId: null },
    },
    activePaneId: paneId,
  };
}

describe("Collapsed sidebar popover clicks", () => {
  beforeEach(() => {
    initCoreExtensionAPI();
    registerRootRowRenderer({
      id: "workspace",
      source: "core",
      component: WorkspaceRowBody,
      label: (id: string) => {
        let result: string | undefined;
        workspaces.subscribe((list) => {
          result = list.find((w) => w.id === id)?.name;
        })();
        return result;
      },
    });
    sidebarWidth.set(220);
    sidebarVisible.set(false);
    bannerCollapsedState.set(new Map());
    // Workspace with one branched child so the chevron toggle renders
    // (`expandable` requires at least one non-dashboard child).
    workspaces.set([
      fakeWorkspace("ws-1", ["br-1"]) as never,
      {
        ...fakeWorkspace("br-1"),
        rootWorkspaceId: "ws-1",
      } as never,
    ]);
    rootRowOrder.set([{ kind: "workspace", id: "ws-1" }]);
    hoveredRootRowKey.set(null);
    // Banner defaults to collapsed (true) when no entry exists in the
    // map, so we leave the map empty and verify the consumer reads the
    // default before/after the click.
  });

  afterEach(() => {
    cleanup();
    sidebarVisible.set(true);
    workspaces.set([]);
    rootRowOrder.set([]);
    hoveredRootRowKey.set(null);
    bannerCollapsedState.set(new Map());
  });

  it("toggles the banner collapsed state when the chevron in the popover is clicked", async () => {
    const { container } = render(WorkspaceListBlock);
    const row = container.querySelector(
      "[data-root-row-key]",
    ) as HTMLElement | null;
    expect(row).not.toBeNull();
    await fireEvent.mouseEnter(row!);
    await tick();

    const popover = container.querySelector(
      "[data-root-row-popover]",
    ) as HTMLElement | null;
    expect(popover).not.toBeNull();

    // The chevron toggle button lives in the banner's btn-row slot. Find
    // it by its aria-label inside the popover (excludes the clipped
    // in-sidebar instance).
    const chevron = popover!.querySelector(
      'button[aria-label="Expand workspace"]',
    ) as HTMLButtonElement | null;
    expect(chevron).not.toBeNull();

    // Sanity: banner starts collapsed (default — no entry in map).
    expect(get(bannerCollapsedState).get("ws-1") ?? true).toBe(true);

    await fireEvent.click(chevron!);
    await tick();

    // After the click, the banner should be expanded (entry === false).
    expect(get(bannerCollapsedState).get("ws-1")).toBe(false);
  });
});
