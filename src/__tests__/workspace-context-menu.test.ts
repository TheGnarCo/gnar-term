/**
 * Tests for buildWorkspaceContextMenuItems — the shared factory that
 * shapes the right-click menu used by both the root WorkspaceListBlock
 * and nested WorkspaceListView. Covers the lock/unlock surface and its
 * effect on the Archive / Close items.
 */
import { describe, it, expect, vi } from "vitest";
import { buildWorkspaceContextMenuItems } from "../lib/utils/workspace-context-menu";

const baseOpts = {
  isDashboard: false,
  isInsideWorkspace: false,
  canPromoteCommand: false,
  workspaceCount: 2,
  onClose: () => {},
};

describe("buildWorkspaceContextMenuItems — lock/unlock", () => {
  it("omits lock toggle entirely when onToggleLock is not provided", () => {
    const items = buildWorkspaceContextMenuItems({ ...baseOpts });
    const labels = items.map((i) => i.label);
    expect(labels).not.toContain("Lock Workspace");
    expect(labels).not.toContain("Unlock Workspace");
  });

  it("renders 'Lock NestedWorkspace' when isLocked is false", () => {
    const onToggleLock = vi.fn();
    const items = buildWorkspaceContextMenuItems({
      ...baseOpts,
      isLocked: false,
      onToggleLock,
    });
    const labels = items.map((i) => i.label);
    expect(labels).toContain("Lock Workspace");
    expect(labels).not.toContain("Unlock Workspace");
  });

  it("renders 'Unlock NestedWorkspace' when isLocked is true", () => {
    const onToggleLock = vi.fn();
    const items = buildWorkspaceContextMenuItems({
      ...baseOpts,
      isLocked: true,
      onToggleLock,
    });
    const labels = items.map((i) => i.label);
    expect(labels).toContain("Unlock Workspace");
    expect(labels).not.toContain("Lock Workspace");
  });

  it("invokes onToggleLock when the lock item is activated", () => {
    const onToggleLock = vi.fn();
    const items = buildWorkspaceContextMenuItems({
      ...baseOpts,
      isLocked: false,
      onToggleLock,
    });
    const lock = items.find((i) => i.label === "Lock Workspace");
    expect(lock).toBeDefined();
    lock!.action();
    expect(onToggleLock).toHaveBeenCalledTimes(1);
  });

  it("disables Close NestedWorkspace when the workspace is locked", () => {
    const items = buildWorkspaceContextMenuItems({
      ...baseOpts,
      isLocked: true,
      onToggleLock: () => {},
    });
    const close = items.find((i) => i.label === "Close Workspace");
    expect(close).toBeDefined();
    expect(close!.disabled).toBe(true);
  });

  it("disables Archive when the workspace is locked", () => {
    const items = buildWorkspaceContextMenuItems({
      ...baseOpts,
      isLocked: true,
      onToggleLock: () => {},
      onArchive: () => {},
    });
    const archive = items.find((i) => i.label === "Archive");
    expect(archive).toBeDefined();
    expect(archive!.disabled).toBe(true);
  });

  it("does not disable Archive when the workspace is unlocked", () => {
    const items = buildWorkspaceContextMenuItems({
      ...baseOpts,
      isLocked: false,
      onToggleLock: () => {},
      onArchive: () => {},
    });
    const archive = items.find((i) => i.label === "Archive");
    expect(archive).toBeDefined();
    expect(archive!.disabled).toBeFalsy();
  });

  it("hides the lock toggle for dashboards even if onToggleLock is provided", () => {
    const items = buildWorkspaceContextMenuItems({
      ...baseOpts,
      isDashboard: true,
      isLocked: false,
      onToggleLock: () => {},
    });
    const labels = items.map((i) => i.label);
    expect(labels).not.toContain("Lock Workspace");
    expect(labels).not.toContain("Unlock Workspace");
  });

  it("treats omitted isLocked as false (default behavior unchanged)", () => {
    const items = buildWorkspaceContextMenuItems({
      ...baseOpts,
      onArchive: () => {},
    });
    const close = items.find((i) => i.label === "Close Workspace");
    expect(close).toBeDefined();
    // workspaceCount of 2 + not locked + not dashboard = enabled
    expect(close!.disabled).toBe(false);
    const archive = items.find((i) => i.label === "Archive");
    expect(archive).toBeDefined();
    expect(archive!.disabled).toBeFalsy();
  });
});
