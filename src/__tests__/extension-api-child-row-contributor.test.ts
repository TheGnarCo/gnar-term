/**
 * Tests for ExtensionAPI.registerChildRowContributor — verifies
 * registration carries the extId as source and that deactivation drops
 * the contributor via the per-source cleanup map.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn().mockResolvedValue(""),
  writeText: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn().mockResolvedValue(true),
  requestPermission: vi.fn().mockResolvedValue("granted"),
  sendNotification: vi.fn(),
}));
vi.mock("../lib/services/extension-state", () => ({
  loadExtensionState: vi.fn().mockResolvedValue({}),
  saveExtensionState: vi.fn().mockResolvedValue(undefined),
  deleteExtensionState: vi.fn().mockResolvedValue(undefined),
}));

import type { ExtensionManifest } from "../lib/extension-types";
import {
  registerExtension,
  activateExtension,
  deactivateExtension,
  resetExtensions,
} from "../lib/services/extension-loader";
import {
  childRowContributorStore,
  getChildRowsFor,
  resetChildRowContributors,
} from "../lib/services/child-row-contributor-registry";
import { get } from "svelte/store";

function makeManifest(
  overrides: Partial<ExtensionManifest> = {},
): ExtensionManifest {
  return {
    id: "contrib-ext",
    name: "Contrib Ext",
    version: "0.1.0",
    entry: "./dist/index.js",
    ...overrides,
  };
}

describe("ExtensionAPI.registerChildRowContributor", () => {
  beforeEach(async () => {
    await resetExtensions();
    resetChildRowContributors();
  });

  it("registers a contributor under the extension's id", async () => {
    registerExtension(makeManifest({ id: "ext-a" }), (api) => {
      api.onActivate(() => {
        api.registerChildRowContributor("project", (projectId) => [
          { kind: "agent-orchestrator", id: `${projectId}-d` },
        ]);
      });
    });
    await activateExtension("ext-a");

    const list = get(childRowContributorStore);
    expect(list).toHaveLength(1);
    expect(list[0].source).toBe("ext-a");
    expect(list[0].parentType).toBe("project");

    expect(getChildRowsFor("project", "p1")).toEqual([
      { kind: "agent-orchestrator", id: "p1-d" },
    ]);
  });

  it("deactivating the extension removes its contributor", async () => {
    registerExtension(makeManifest({ id: "ext-cleanup" }), (api) => {
      api.onActivate(() => {
        api.registerChildRowContributor("project", () => [
          { kind: "x", id: "y" },
        ]);
      });
    });
    await activateExtension("ext-cleanup");
    expect(get(childRowContributorStore)).toHaveLength(1);

    deactivateExtension("ext-cleanup");
    expect(get(childRowContributorStore)).toHaveLength(0);
    expect(getChildRowsFor("project", "p1")).toEqual([]);
  });
});
