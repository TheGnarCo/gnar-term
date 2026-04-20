/**
 * Tests for ExtensionAPI.registerMarkdownComponent — verifies that
 * extensions can contribute live markdown-components, that registrations
 * carry the extension's id as their source, and that deactivating an
 * extension drops its components via the per-source cleanup map.
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

import type { ExtensionAPI, ExtensionManifest } from "../lib/extension-types";
import {
  registerExtension,
  activateExtension,
  deactivateExtension,
  resetExtensions,
} from "../lib/services/extension-loader";
import {
  getMarkdownComponent,
  listMarkdownComponents,
  resetMarkdownComponents,
} from "../lib/services/markdown-component-registry";

function makeManifest(
  overrides: Partial<ExtensionManifest> = {},
): ExtensionManifest {
  return {
    id: "comp-ext",
    name: "Comp Ext",
    version: "0.1.0",
    entry: "./dist/index.js",
    ...overrides,
  };
}

describe("ExtensionAPI.registerMarkdownComponent", () => {
  beforeEach(async () => {
    await resetExtensions();
    resetMarkdownComponents();
  });

  it("registers a component under the bare name with source=extId", async () => {
    const component = { __mock: "kanban-component" };
    registerExtension(makeManifest({ id: "agentic-orchestrator" }), (api) => {
      api.onActivate(() => {
        api.registerMarkdownComponent("kanban", component);
      });
    });
    await activateExtension("agentic-orchestrator");

    const c = getMarkdownComponent("kanban");
    expect(c).toBeDefined();
    expect(c!.name).toBe("kanban");
    expect(c!.component).toBe(component);
    expect(c!.source).toBe("agentic-orchestrator");
  });

  it("component appears in listMarkdownComponents()", async () => {
    registerExtension(makeManifest({ id: "ext-list" }), (api) => {
      api.onActivate(() => {
        api.registerMarkdownComponent("foo", { c: 1 });
        api.registerMarkdownComponent("bar", { c: 2 });
      });
    });
    await activateExtension("ext-list");

    const list = listMarkdownComponents();
    expect(list).toHaveLength(2);
    expect(list.map((w) => w.name).sort()).toEqual(["bar", "foo"]);
  });

  it("deactivating the extension removes its components", async () => {
    registerExtension(makeManifest({ id: "ext-cleanup" }), (api) => {
      api.onActivate(() => {
        api.registerMarkdownComponent("kanban", { c: 1 });
        api.registerMarkdownComponent("timeline", { c: 2 });
      });
    });
    await activateExtension("ext-cleanup");
    expect(listMarkdownComponents()).toHaveLength(2);

    deactivateExtension("ext-cleanup");

    expect(getMarkdownComponent("kanban")).toBeUndefined();
    expect(getMarkdownComponent("timeline")).toBeUndefined();
    expect(listMarkdownComponents()).toHaveLength(0);
  });

  it("re-activating after deactivation re-registers components (idempotent)", async () => {
    const component = { __mock: "comp" };
    registerExtension(makeManifest({ id: "ext-cycle" }), (api) => {
      api.onActivate(() => {
        api.registerMarkdownComponent("thing", component);
      });
    });

    await activateExtension("ext-cycle");
    expect(getMarkdownComponent("thing")?.source).toBe("ext-cycle");

    deactivateExtension("ext-cycle");
    expect(getMarkdownComponent("thing")).toBeUndefined();

    await activateExtension("ext-cycle");
    expect(getMarkdownComponent("thing")?.source).toBe("ext-cycle");
    expect(getMarkdownComponent("thing")?.component).toBe(component);
  });

  it("two extensions registering the same name: last-wins, source reflects the winner", async () => {
    const compA = { v: "a" };
    const compB = { v: "b" };

    registerExtension(makeManifest({ id: "ext-a" }), (api) => {
      api.onActivate(() => {
        api.registerMarkdownComponent("shared", compA);
      });
    });
    registerExtension(makeManifest({ id: "ext-b" }), (api) => {
      api.onActivate(() => {
        api.registerMarkdownComponent("shared", compB);
      });
    });

    await activateExtension("ext-a");
    expect(getMarkdownComponent("shared")?.source).toBe("ext-a");

    await activateExtension("ext-b");
    const winner = getMarkdownComponent("shared");
    expect(winner?.source).toBe("ext-b");
    expect(winner?.component).toBe(compB);
    expect(listMarkdownComponents()).toHaveLength(1);
  });

  it("optional configSchema round-trips into the registry entry", async () => {
    const schema = { fields: { columns: { type: "number" } } };
    registerExtension(makeManifest({ id: "ext-schema" }), (api) => {
      api.onActivate(() => {
        api.registerMarkdownComponent(
          "kanban",
          { c: 1 },
          { configSchema: schema },
        );
      });
    });
    await activateExtension("ext-schema");

    expect(getMarkdownComponent("kanban")?.configSchema).toEqual(schema);
  });

  it("omitting options leaves configSchema undefined", async () => {
    registerExtension(makeManifest({ id: "ext-noschema" }), (api) => {
      api.onActivate(() => {
        api.registerMarkdownComponent("plain", { c: 1 });
      });
    });
    await activateExtension("ext-noschema");

    const w = getMarkdownComponent("plain");
    expect(w).toBeDefined();
    expect(w!.configSchema).toBeUndefined();
  });

  it("exposes registerMarkdownComponent on the API surface", async () => {
    let capturedApi: ExtensionAPI | undefined;
    registerExtension(makeManifest({ id: "ext-surface-check" }), (api) => {
      capturedApi = api;
    });
    expect(capturedApi).toBeTruthy();
    expect(typeof capturedApi!.registerMarkdownComponent).toBe("function");
  });
});
