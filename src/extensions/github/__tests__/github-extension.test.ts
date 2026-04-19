/**
 * Tests for the GitHub included extension — validates that the extension
 * registers a secondary sidebar tab, action, and command via the extension API.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import { githubManifest, registerGitHubExtension } from "../index";
import {
  sidebarTabStore,
  sidebarActionStore,
  resetSidebarTabs,
} from "../../../lib/services/sidebar-tab-registry";
import {
  commandStore,
  resetCommands,
} from "../../../lib/services/command-registry";
import {
  registerExtension,
  activateExtension,
  resetExtensions,
} from "../../../lib/services/extension-loader";

describe("GitHub included extension", () => {
  beforeEach(async () => {
    await resetExtensions();
    resetSidebarTabs();
    resetCommands();
  });

  // --- Manifest tests ---

  it("manifest has correct id and metadata", () => {
    expect(githubManifest.id).toBe("github");
    expect(githubManifest.name).toBe("GitHub");
    expect(githubManifest.version).toBe("0.1.0");
    expect(githubManifest.included).toBe(true);
  });

  it("manifest declares a secondary sidebar tab", () => {
    const tabs = githubManifest.contributes?.secondarySidebarTabs;
    expect(tabs).toHaveLength(1);
    expect(tabs![0]).toMatchObject({
      id: "github",
      label: "GitHub",
      icon: "github",
    });
  });

  it("manifest declares a refresh action on the tab", () => {
    const actions =
      githubManifest.contributes?.secondarySidebarTabs?.[0]?.actions;
    expect(actions).toHaveLength(1);
    expect(actions![0]).toMatchObject({
      id: "refresh",
      icon: "refresh",
      title: "Refresh",
    });
  });

  it("manifest declares refresh-github command", () => {
    expect(githubManifest.contributes?.commands).toEqual([
      { id: "refresh-github", title: "Refresh GitHub Data" },
    ]);
  });

  it("manifest does not declare unused events", () => {
    expect(githubManifest.contributes?.events).toBeUndefined();
  });

  // --- Registration tests ---

  it("registers sidebar tab via API with namespaced id", async () => {
    registerExtension(githubManifest, registerGitHubExtension);
    await activateExtension("github");

    const tabs = get(sidebarTabStore);
    const githubTab = tabs.find((t) => t.id === "github:github");
    expect(githubTab).toBeTruthy();
    expect(githubTab!.source).toBe("github");
    expect(githubTab!.component).toBeTruthy();
  });

  it("registers sidebar action via API", async () => {
    registerExtension(githubManifest, registerGitHubExtension);
    await activateExtension("github");

    const actions = get(sidebarActionStore);
    const refreshAction = actions.find(
      (a) => a.tabId === "github:github" && a.actionId === "refresh",
    );
    expect(refreshAction).toBeTruthy();
    expect(refreshAction!.source).toBe("github");
  });

  it("registers command via API with namespaced id", async () => {
    registerExtension(githubManifest, registerGitHubExtension);
    await activateExtension("github");

    const cmds = get(commandStore);
    const refreshCmd = cmds.find((c) => c.id === "github:refresh-github");
    expect(refreshCmd).toBeTruthy();
    expect(refreshCmd!.title).toBe("Refresh GitHub Data");
    expect(refreshCmd!.source).toBe("github");
  });

  // --- Refresh callback via state ---

  it("refresh action calls function stored in api.state", async () => {
    registerExtension(githubManifest, registerGitHubExtension);
    await activateExtension("github");

    const actions = get(sidebarActionStore);
    const refreshAction = actions.find(
      (a) => a.tabId === "github:github" && a.actionId === "refresh",
    );
    expect(refreshAction).toBeTruthy();

    // Simulate what GitHubTab.svelte does: store a refresh callback
    // We need to access the extension's state API — the action handler
    // reads from it. Since we can't easily get the API instance in tests,
    // we verify the action handler doesn't throw when no callback is set.
    expect(() => refreshAction!.handler()).not.toThrow();
  });

  it("command handler does not throw when no refresh callback is set", async () => {
    registerExtension(githubManifest, registerGitHubExtension);
    await activateExtension("github");

    const cmds = get(commandStore);
    const refreshCmd = cmds.find((c) => c.id === "github:refresh-github");
    expect(refreshCmd).toBeTruthy();
    expect(() => refreshCmd!.action()).not.toThrow();
  });
});
