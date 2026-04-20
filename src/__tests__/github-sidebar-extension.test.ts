/**
 * Tests for the github-sidebar extension — registers the GitHub
 * secondary sidebar tab, refresh action, and refresh-github command.
 * The action and command both invoke a refresh callback the live tab
 * component stashes in api.state under the "refresh" key.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: vi.fn().mockResolvedValue(undefined),
}));

import {
  githubSidebarManifest,
  registerGitHubSidebarExtension,
} from "../extensions/github-sidebar";
import {
  registerExtension,
  activateExtension,
  resetExtensions,
  getExtensionApiById,
} from "../lib/services/extension-loader";
import {
  sidebarTabStore,
  sidebarActionStore,
  resetSidebarTabs,
} from "../lib/services/sidebar-tab-registry";
import { commandStore, resetCommands } from "../lib/services/command-registry";

describe("github-sidebar extension", () => {
  beforeEach(async () => {
    await resetExtensions();
    resetSidebarTabs();
    resetCommands();
  });

  it("manifest declares the github sidebar tab and refresh-github command", () => {
    const tabs = githubSidebarManifest.contributes?.secondarySidebarTabs;
    expect(tabs).toHaveLength(1);
    expect(tabs![0].id).toBe("github");
    expect(tabs![0].label).toBe("GitHub");
    expect(tabs![0].icon).toBe("github");
    expect(tabs![0].actions?.[0].id).toBe("refresh");

    const commands = githubSidebarManifest.contributes?.commands;
    expect(commands).toHaveLength(1);
    expect(commands![0].id).toBe("refresh-github");
  });

  it("on activation registers the sidebar tab with namespaced id", async () => {
    registerExtension(githubSidebarManifest, registerGitHubSidebarExtension);
    await activateExtension("github-sidebar");

    const tab = get(sidebarTabStore).find(
      (t) => t.id === "github-sidebar:github",
    );
    expect(tab).toBeTruthy();
    expect(tab!.label).toBe("GitHub");
    expect(tab!.icon).toBe("github");
    expect(tab!.source).toBe("github-sidebar");
  });

  it("registers the refresh sidebar action on the tab", async () => {
    registerExtension(githubSidebarManifest, registerGitHubSidebarExtension);
    await activateExtension("github-sidebar");

    const action = get(sidebarActionStore).find(
      (a) => a.tabId === "github-sidebar:github" && a.actionId === "refresh",
    );
    expect(action).toBeTruthy();
    expect(action!.source).toBe("github-sidebar");
  });

  it("registers the refresh-github command", async () => {
    registerExtension(githubSidebarManifest, registerGitHubSidebarExtension);
    await activateExtension("github-sidebar");

    const cmd = get(commandStore).find(
      (c) => c.id === "github-sidebar:refresh-github",
    );
    expect(cmd).toBeTruthy();
    expect(cmd!.title).toBe("Refresh GitHub Data");
    expect(cmd!.source).toBe("github-sidebar");
  });

  it("refresh action and command are no-ops when no tab is mounted", async () => {
    registerExtension(githubSidebarManifest, registerGitHubSidebarExtension);
    await activateExtension("github-sidebar");

    const action = get(sidebarActionStore).find(
      (a) => a.tabId === "github-sidebar:github" && a.actionId === "refresh",
    );
    const cmd = get(commandStore).find(
      (c) => c.id === "github-sidebar:refresh-github",
    );

    expect(() => action!.handler()).not.toThrow();
    expect(() => cmd!.action()).not.toThrow();
  });

  it("refresh action invokes the callback stashed in api.state", async () => {
    registerExtension(githubSidebarManifest, registerGitHubSidebarExtension);
    await activateExtension("github-sidebar");

    const cb = vi.fn();
    const api = getExtensionApiById("github-sidebar")!;
    api.state.set("refresh", cb);

    const action = get(sidebarActionStore).find(
      (a) => a.tabId === "github-sidebar:github" && a.actionId === "refresh",
    );
    action!.handler();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("refresh-github command invokes the callback stashed in api.state", async () => {
    registerExtension(githubSidebarManifest, registerGitHubSidebarExtension);
    await activateExtension("github-sidebar");

    const cb = vi.fn();
    const api = getExtensionApiById("github-sidebar")!;
    api.state.set("refresh", cb);

    const cmd = get(commandStore).find(
      (c) => c.id === "github-sidebar:refresh-github",
    );
    void cmd!.action();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("triggers no callback after the tab clears its api.state slot", async () => {
    registerExtension(githubSidebarManifest, registerGitHubSidebarExtension);
    await activateExtension("github-sidebar");

    const cb = vi.fn();
    const api = getExtensionApiById("github-sidebar")!;
    api.state.set("refresh", cb);
    api.state.set("refresh", null);

    const action = get(sidebarActionStore).find(
      (a) => a.tabId === "github-sidebar:github" && a.actionId === "refresh",
    );
    action!.handler();
    expect(cb).not.toHaveBeenCalled();
  });
});
