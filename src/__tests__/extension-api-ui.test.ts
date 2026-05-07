/**
 * Tests for extension-api-ui — the layer between manifest declarations and
 * the core registries. Covers manifest↔runtime fallback for command shortcut,
 * workspace-action icon/shortcut/zone, and workspace-subtitle priority.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import { createUIRegistrationAPI } from "../lib/services/extension-api-ui";
import { commandStore, resetCommands } from "../lib/services/command-registry";
import {
  workspaceActionStore,
  resetWorkspaceActions,
} from "../lib/services/workspace-action-registry";
import {
  workspaceSubtitleStore,
  resetWorkspaceSubtitles,
} from "../lib/services/workspace-subtitle-registry";
import type { ExtensionManifest } from "../extensions/api";

function mkManifest(
  contributes: ExtensionManifest["contributes"],
): ExtensionManifest {
  return {
    id: "ext-ui",
    name: "UI Test",
    version: "0.0.1",
    entry: "index.js",
    contributes,
  };
}

describe("extension-api-ui — manifest/runtime fallback", () => {
  beforeEach(() => {
    resetCommands();
    resetWorkspaceActions();
    resetWorkspaceSubtitles();
  });

  it("registerCommand reads shortcut from manifest when not passed", () => {
    const manifest = mkManifest({
      commands: [{ id: "greet", title: "Greet", shortcut: "⌘⇧G" }],
    });
    const api = createUIRegistrationAPI("ext-ui", manifest);
    api.registerCommand("greet", () => {});
    const cmd = get(commandStore).find((c) => c.id === "ext-ui:greet");
    expect(cmd?.shortcut).toBe("⌘⇧G");
    expect(cmd?.title).toBe("Greet");
  });

  it("registerCommand runtime shortcut wins over manifest", () => {
    const manifest = mkManifest({
      commands: [{ id: "greet", title: "Greet", shortcut: "⌘G" }],
    });
    const api = createUIRegistrationAPI("ext-ui", manifest);
    api.registerCommand("greet", () => {}, { shortcut: "⌘⇧G" });
    const cmd = get(commandStore).find((c) => c.id === "ext-ui:greet");
    expect(cmd?.shortcut).toBe("⌘⇧G");
  });

  it("registerWorkspaceAction inherits icon/shortcut/zone from manifest", () => {
    const manifest = mkManifest({
      workspaceActions: [
        {
          id: "quick",
          title: "Quick Terminal",
          icon: "terminal",
          shortcut: "⌘⇧T",
          zone: "sidebar",
        },
      ],
    });
    const api = createUIRegistrationAPI("ext-ui", manifest);
    api.registerWorkspaceAction("quick", {
      label: "Quick Terminal",
      // runtime omits icon/shortcut/zone; manifest fills them in
      handler: () => {},
    });
    const action = get(workspaceActionStore).find(
      (a) => a.id === "ext-ui:quick",
    );
    expect(action?.icon).toBe("terminal");
    expect(action?.shortcut).toBe("⌘⇧T");
    expect(action?.zone).toBe("sidebar");
  });

  it("registerWorkspaceAction runtime options override manifest defaults", () => {
    const manifest = mkManifest({
      workspaceActions: [
        {
          id: "quick",
          title: "Quick Terminal",
          icon: "terminal",
          shortcut: "⌘⇧T",
          zone: "sidebar",
        },
      ],
    });
    const api = createUIRegistrationAPI("ext-ui", manifest);
    api.registerWorkspaceAction("quick", {
      label: "Quick Terminal",
      icon: "zap",
      shortcut: "⌘⇧Z",
      zone: "workspace",
      handler: () => {},
    });
    const action = get(workspaceActionStore).find(
      (a) => a.id === "ext-ui:quick",
    );
    expect(action?.icon).toBe("zap");
    expect(action?.shortcut).toBe("⌘⇧Z");
    expect(action?.zone).toBe("workspace");
  });

  it("registerWorkspaceSubtitle inherits priority from manifest", () => {
    const manifest = mkManifest({
      workspaceSubtitle: { priority: 5 },
    });
    const api = createUIRegistrationAPI("ext-ui", manifest);
    api.registerWorkspaceSubtitle({});
    const entry = get(workspaceSubtitleStore).find(
      (s) => s.id === "ext-ui:subtitle",
    );
    expect(entry?.priority).toBe(5);
  });

  it("registerWorkspaceSubtitle defaults to 50 without manifest", () => {
    const manifest = mkManifest({});
    const api = createUIRegistrationAPI("ext-ui", manifest);
    api.registerWorkspaceSubtitle({});
    const entry = get(workspaceSubtitleStore).find(
      (s) => s.id === "ext-ui:subtitle",
    );
    expect(entry?.priority).toBe(50);
  });
});
