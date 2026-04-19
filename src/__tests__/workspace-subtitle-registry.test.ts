import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import {
  workspaceSubtitleStore,
  registerWorkspaceSubtitle,
  unregisterWorkspaceSubtitlesBySource,
  resetWorkspaceSubtitles,
} from "../lib/services/workspace-subtitle-registry";

describe("workspace-subtitle-registry", () => {
  beforeEach(() => {
    resetWorkspaceSubtitles();
  });

  it("registers a subtitle component", () => {
    const FakeComponent = {};
    registerWorkspaceSubtitle({
      id: "ext:git-status",
      component: FakeComponent,
      source: "git-status",
      priority: 10,
    });

    const items = get(workspaceSubtitleStore);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("ext:git-status");
    expect(items[0].component).toBe(FakeComponent);
    expect(items[0].priority).toBe(10);
  });

  it("sorts by priority (lower first)", () => {
    registerWorkspaceSubtitle({
      id: "ext:high",
      component: {},
      source: "ext-high",
      priority: 50,
    });
    registerWorkspaceSubtitle({
      id: "ext:low",
      component: {},
      source: "ext-low",
      priority: 10,
    });

    const items = get(workspaceSubtitleStore);
    expect(items[0].id).toBe("ext:low");
    expect(items[1].id).toBe("ext:high");
  });

  it("unregisters by source", () => {
    registerWorkspaceSubtitle({
      id: "ext:a",
      component: {},
      source: "ext-a",
      priority: 10,
    });
    registerWorkspaceSubtitle({
      id: "ext:b",
      component: {},
      source: "ext-b",
      priority: 20,
    });

    unregisterWorkspaceSubtitlesBySource("ext-a");
    const items = get(workspaceSubtitleStore);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("ext:b");
  });

  it("defaults priority to 50 when not specified", () => {
    registerWorkspaceSubtitle({
      id: "ext:default",
      component: {},
      source: "ext-default",
      priority: 50,
    });

    const items = get(workspaceSubtitleStore);
    expect(items[0].priority).toBe(50);
  });
});
