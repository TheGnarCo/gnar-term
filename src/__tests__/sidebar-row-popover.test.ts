/**
 * Verifies the per-row popover behavior of WorkspaceListBlock when the
 * sidebar is collapsed:
 *   - No popover is rendered initially.
 *   - Hovering a rendered row produces exactly one popover element.
 *   - Leaving the row clears the popover after the grace period.
 *   - Expanding the sidebar mid-hover dismisses the popover.
 *
 * The test mounts WorkspaceListBlock with a single workspace registered
 * so the unified drag pipeline produces a single .root-row.
 */
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/svelte";
import { tick } from "svelte";
import { get } from "svelte/store";
import WorkspaceListBlock from "../lib/components/WorkspaceListBlock.svelte";
import {
  sidebarVisible,
  sidebarWidth,
  hoveredRootRowKey,
} from "../lib/stores/ui";
import { workspaces } from "../lib/stores/workspace";
import { rootRowOrder } from "../lib/stores/root-row-order";
import { registerRootRowRenderer } from "../lib/services/root-row-renderer-registry";
import WorkspaceRowBody from "../lib/components/WorkspaceRowBody.svelte";
import { initCoreExtensionAPI } from "../lib/bootstrap/init-core-extension-api";

// Minimal workspace fixture sufficient for the rendered-rows derivation.
function fakeWorkspace(id: string) {
  return {
    id,
    name: `WS ${id}`,
    color: "blue",
    path: `/tmp/${id}`,
    branchedWorkspaceIds: [],
    isGit: false,
    createdAt: new Date().toISOString(),
  };
}

describe("WorkspaceListBlock per-row popover (collapsed sidebar)", () => {
  beforeEach(() => {
    // Workspace rows render through the registered "workspace"
    // root-row renderer (mounted via ExtensionWrapper). Without this,
    // no [data-root-row-key] element is produced.
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
    workspaces.set([fakeWorkspace("ws-1") as never]);
    rootRowOrder.set([{ kind: "workspace", id: "ws-1" }]);
    hoveredRootRowKey.set(null);
  });

  afterEach(() => {
    cleanup();
    sidebarVisible.set(true);
    workspaces.set([]);
    rootRowOrder.set([]);
    hoveredRootRowKey.set(null);
  });

  it("does not render a popover when no row is hovered", () => {
    const { container } = render(WorkspaceListBlock);
    expect(container.querySelector("[data-root-row-popover]")).toBeNull();
  });

  it("renders one popover positioned at the hovered row when the sidebar is collapsed", async () => {
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
    expect(popover!.style.position).toBe("fixed");
    expect(popover!.style.width).toBe("220px");
    expect(get(hoveredRootRowKey)).toBe(row!.getAttribute("data-root-row-key"));
  });

  it("clears the popover after mouseleave grace period", async () => {
    vi.useFakeTimers();
    const { container } = render(WorkspaceListBlock);
    const row = container.querySelector("[data-root-row-key]") as HTMLElement;
    await fireEvent.mouseEnter(row);
    await tick();
    expect(container.querySelector("[data-root-row-popover]")).not.toBeNull();

    await fireEvent.mouseLeave(row);
    await tick();
    // Still present — grace timer hasn't fired yet.
    expect(container.querySelector("[data-root-row-popover]")).not.toBeNull();

    vi.advanceTimersByTime(151);
    await tick();
    expect(container.querySelector("[data-root-row-popover]")).toBeNull();
    expect(get(hoveredRootRowKey)).toBeNull();
    vi.useRealTimers();
  });

  it("dismisses the popover when sidebar expands", async () => {
    const { container } = render(WorkspaceListBlock);
    const row = container.querySelector("[data-root-row-key]") as HTMLElement;
    await fireEvent.mouseEnter(row);
    await tick();
    expect(container.querySelector("[data-root-row-popover]")).not.toBeNull();

    sidebarVisible.set(true);
    await tick();
    expect(container.querySelector("[data-root-row-popover]")).toBeNull();
    expect(get(hoveredRootRowKey)).toBeNull();
  });

  it("does not render a popover when sidebar is expanded", async () => {
    sidebarVisible.set(true);
    const { container } = render(WorkspaceListBlock);
    const row = container.querySelector("[data-root-row-key]") as HTMLElement;
    await fireEvent.mouseEnter(row);
    await tick();
    expect(container.querySelector("[data-root-row-popover]")).toBeNull();
  });
});
