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
    render(WorkspaceListBlock);
    expect(document.body.querySelector("[data-root-row-popover]")).toBeNull();
  });

  it("renders one popover positioned at the hovered row when the sidebar is collapsed", async () => {
    const { container } = render(WorkspaceListBlock);
    const row = container.querySelector(
      "[data-root-row-key]",
    ) as HTMLElement | null;
    expect(row).not.toBeNull();
    await fireEvent.mouseEnter(row!);
    await tick();
    const popover = document.body.querySelector(
      "[data-root-row-popover]",
    ) as HTMLElement | null;
    expect(popover).not.toBeNull();
    expect(popover!.style.position).toBe("fixed");
    // Popover renders at left:4 so it aligns with the expanded sidebar's
    // 4px left gutter; effective width is sidebarWidth - 4 (216 of 220).
    expect(popover!.style.width).toBe("216px");
    expect(get(hoveredRootRowKey)).toBe(row!.getAttribute("data-root-row-key"));
  });

  it("clears the popover after the cursor leaves the popover region", async () => {
    vi.useFakeTimers();
    const { container } = render(WorkspaceListBlock);
    const row = container.querySelector("[data-root-row-key]") as HTMLElement;
    await fireEvent.mouseEnter(row);
    await tick();
    expect(
      document.body.querySelector("[data-root-row-popover]"),
    ).not.toBeNull();

    // Simulate cursor moving to a clearly out-of-bounds position. The
    // document-level mousemove handler hit-tests against the row and
    // popover rects; in jsdom getBoundingClientRect returns zeros, so
    // any non-origin coordinate counts as "outside".
    await fireEvent.mouseMove(document, { clientX: 999, clientY: 999 });
    await tick();
    // Still present — grace timer hasn't fired yet.
    expect(
      document.body.querySelector("[data-root-row-popover]"),
    ).not.toBeNull();

    vi.advanceTimersByTime(151);
    await tick();
    expect(document.body.querySelector("[data-root-row-popover]")).toBeNull();
    expect(get(hoveredRootRowKey)).toBeNull();
    vi.useRealTimers();
  });

  it("keeps the popover open while the cursor is inside its rect", async () => {
    vi.useFakeTimers();
    const { container } = render(WorkspaceListBlock);
    const row = container.querySelector("[data-root-row-key]") as HTMLElement;
    await fireEvent.mouseEnter(row);
    await tick();
    const popover = document.body.querySelector(
      "[data-root-row-popover]",
    ) as HTMLElement;
    expect(popover).not.toBeNull();

    // Stub the popover's bounding rect so the geometry check returns true
    // for a point inside it. Without this, jsdom reports a zero-rect.
    popover.getBoundingClientRect = () =>
      ({
        left: 0,
        right: 200,
        top: 0,
        bottom: 100,
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        toJSON: () => ({}),
      }) as DOMRect;

    // Cursor moves to a point inside the popover — even after a long
    // wait, the popover must stay open because each mousemove clears
    // the grace timer.
    await fireEvent.mouseMove(document, { clientX: 50, clientY: 50 });
    vi.advanceTimersByTime(500);
    await tick();
    expect(
      document.body.querySelector("[data-root-row-popover]"),
    ).not.toBeNull();
    vi.useRealTimers();
  });

  it("dismisses the popover when sidebar expands", async () => {
    const { container } = render(WorkspaceListBlock);
    const row = container.querySelector("[data-root-row-key]") as HTMLElement;
    await fireEvent.mouseEnter(row);
    await tick();
    expect(
      document.body.querySelector("[data-root-row-popover]"),
    ).not.toBeNull();

    sidebarVisible.set(true);
    await tick();
    expect(document.body.querySelector("[data-root-row-popover]")).toBeNull();
    expect(get(hoveredRootRowKey)).toBeNull();
  });

  it("does not render a popover when sidebar is expanded", async () => {
    sidebarVisible.set(true);
    const { container } = render(WorkspaceListBlock);
    const row = container.querySelector("[data-root-row-key]") as HTMLElement;
    await fireEvent.mouseEnter(row);
    await tick();
    expect(document.body.querySelector("[data-root-row-popover]")).toBeNull();
  });
});
