/**
 * Tests for workspace-action-registry — workspace action buttons
 * registered by extensions for sidebar headers and top bar.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";
import {
  workspaceActionStore,
  registerWorkspaceAction,
  unregisterWorkspaceActionsBySource,
  resetWorkspaceActions,
  getWorkspaceActions,
  executeWorkspaceActionByShortcut,
  type WorkspaceAction,
  type WorkspaceActionContext,
} from "../lib/services/workspace-action-registry";

function makeAction(overrides: Partial<WorkspaceAction> = {}): WorkspaceAction {
  return {
    id: "test-action",
    label: "Test",
    icon: "+",
    source: "ext-1",
    handler: () => {},
    ...overrides,
  };
}

const mockContext: WorkspaceActionContext = {
  workspaceId: "ws-1",
  workspaceName: "Dev",
  cwd: "/home/user/project",
  isGit: true,
};

describe("workspace-action-registry", () => {
  beforeEach(() => {
    resetWorkspaceActions();
  });

  it("starts empty", () => {
    expect(get(workspaceActionStore)).toEqual([]);
    expect(getWorkspaceActions()).toEqual([]);
  });

  it("registers an action", () => {
    registerWorkspaceAction(
      makeAction({ id: "new-ws", label: "New Workspace" }),
    );
    const actions = getWorkspaceActions();
    expect(actions).toHaveLength(1);
    expect(actions[0].label).toBe("New Workspace");
  });

  it("handler receives context", () => {
    const handler = vi.fn();
    registerWorkspaceAction(makeAction({ id: "clone", handler }));
    getWorkspaceActions()[0].handler(mockContext);
    expect(handler).toHaveBeenCalledWith(mockContext);
  });

  it("supports zone property", () => {
    registerWorkspaceAction(makeAction({ id: "sidebar-btn", zone: "sidebar" }));
    registerWorkspaceAction(makeAction({ id: "ws-btn", zone: "workspace" }));
    registerWorkspaceAction(makeAction({ id: "default-btn" }));
    const actions = getWorkspaceActions();
    expect(actions[0].zone).toBe("sidebar");
    expect(actions[1].zone).toBe("workspace");
    expect(actions[2].zone).toBeUndefined();
  });

  it("when filter controls visibility", () => {
    const when = (ctx: WorkspaceActionContext) => ctx.isGit;
    registerWorkspaceAction(makeAction({ id: "git-only", when }));
    const action = getWorkspaceActions()[0];
    expect(action.when!(mockContext)).toBe(true);
    expect(action.when!({ ...mockContext, isGit: false })).toBe(false);
  });

  it("unregisters all actions by source", () => {
    registerWorkspaceAction(makeAction({ id: "a", source: "ext-1" }));
    registerWorkspaceAction(makeAction({ id: "b", source: "ext-2" }));
    registerWorkspaceAction(makeAction({ id: "c", source: "ext-1" }));
    unregisterWorkspaceActionsBySource("ext-1");
    const actions = getWorkspaceActions();
    expect(actions).toHaveLength(1);
    expect(actions[0].id).toBe("b");
  });

  it("resets to empty", () => {
    registerWorkspaceAction(makeAction({ id: "a" }));
    resetWorkspaceActions();
    expect(getWorkspaceActions()).toEqual([]);
  });

  it("preserves shortcut property", () => {
    registerWorkspaceAction(makeAction({ id: "quick", shortcut: "Cmd+N" }));
    expect(getWorkspaceActions()[0].shortcut).toBe("Cmd+N");
  });

  it("getWorkspaceActions returns same data as store", () => {
    registerWorkspaceAction(makeAction({ id: "a" }));
    registerWorkspaceAction(makeAction({ id: "b" }));
    expect(getWorkspaceActions()).toEqual(get(workspaceActionStore));
  });
});

describe("executeWorkspaceActionByShortcut", () => {
  beforeEach(() => resetWorkspaceActions());

  function keyEvent(
    key: string,
    mods: {
      meta?: boolean;
      ctrl?: boolean;
      shift?: boolean;
      alt?: boolean;
    } = {},
  ): KeyboardEvent {
    return new KeyboardEvent("keydown", {
      key,
      metaKey: !!mods.meta,
      ctrlKey: !!mods.ctrl,
      shiftKey: !!mods.shift,
      altKey: !!mods.alt,
      cancelable: true,
    });
  }

  it("invokes an action whose shortcut matches and preventDefaults", () => {
    const handler = vi.fn();
    registerWorkspaceAction(makeAction({ id: "n", shortcut: "⌘⇧N", handler }));
    const e = keyEvent("n", { meta: true, shift: true });
    expect(executeWorkspaceActionByShortcut(e)).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
  });

  it("returns false when no shortcut matches", () => {
    const handler = vi.fn();
    registerWorkspaceAction(makeAction({ id: "n", shortcut: "⌘⇧N", handler }));
    const e = keyEvent("x", { meta: true });
    expect(executeWorkspaceActionByShortcut(e)).toBe(false);
    expect(handler).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it("skips actions whose when() filter rejects", () => {
    const handler = vi.fn();
    registerWorkspaceAction(
      makeAction({
        id: "n",
        shortcut: "⌘⇧N",
        handler,
        when: () => false,
      }),
    );
    const e = keyEvent("n", { meta: true, shift: true });
    expect(executeWorkspaceActionByShortcut(e)).toBe(false);
    expect(handler).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it("accepts Ctrl+Shift+X word format", () => {
    const handler = vi.fn();
    registerWorkspaceAction(
      makeAction({ id: "n", shortcut: "Ctrl+Shift+P", handler }),
    );
    const e = keyEvent("p", { ctrl: true, shift: true });
    expect(executeWorkspaceActionByShortcut(e)).toBe(true);
    expect(handler).toHaveBeenCalled();
  });

  it("passes an empty context to the handler", () => {
    const handler = vi.fn();
    registerWorkspaceAction(makeAction({ id: "n", shortcut: "⌘⇧N", handler }));
    executeWorkspaceActionByShortcut(
      keyEvent("n", { meta: true, shift: true }),
    );
    expect(handler).toHaveBeenCalledWith({});
  });
});
