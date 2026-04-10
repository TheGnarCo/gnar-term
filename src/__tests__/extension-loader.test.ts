/**
 * Tests for extension-loader — the keystone of the extension system.
 *
 * Tests cover: manifest validation, ExtensionAPI construction, lifecycle
 * management (activate/deactivate), event filtering, command registration
 * with source tracking, scoped state, and the extension store.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn().mockResolvedValue(""),
  writeText: vi.fn().mockResolvedValue(undefined),
}));

const mockLoadState = vi.fn().mockResolvedValue({});
const mockSaveState = vi.fn().mockResolvedValue(undefined);
vi.mock("../lib/services/extension-state", () => ({
  loadExtensionState: (...args: unknown[]) => mockLoadState(...args),
  saveExtensionState: (...args: unknown[]) => mockSaveState(...args),
  deleteExtensionState: vi.fn().mockResolvedValue(undefined),
}));

import type { ExtensionAPI } from "../lib/extension-types";
import {
  validateManifest,
  createExtensionAPI,
  extensionStore,
  registerExtension,
  activateExtension,
  deactivateExtension,
  unloadExtension,
  resetExtensions,
  getExtensionApiById,
} from "../lib/services/extension-loader";
import { eventBus } from "../lib/services/event-bus";
import { commandStore } from "../lib/services/command-registry";
import {
  sidebarTabStore,
  resetSidebarTabs,
} from "../lib/services/sidebar-tab-registry";
import {
  sidebarSectionStore,
  resetSidebarSections,
} from "../lib/services/sidebar-section-registry";
import {
  surfaceTypeStore,
  resetSurfaceTypes,
} from "../lib/services/surface-type-registry";
import {
  contextMenuItemStore,
  resetContextMenuItems,
} from "../lib/services/context-menu-item-registry";
import type {
  ExtensionManifest,
  LoadedExtension,
} from "../lib/extension-types";
import * as config from "../lib/config";

// --- Helpers ---

function makeManifest(
  overrides: Partial<ExtensionManifest> = {},
): ExtensionManifest {
  return {
    id: "test-extension",
    name: "Test Extension",
    version: "0.1.0",
    entry: "./dist/index.js",
    ...overrides,
  };
}

// --- Manifest validation ---

describe("validateManifest", () => {
  it("accepts a valid minimal manifest", () => {
    const result = validateManifest(makeManifest());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("accepts a manifest with full contributions", () => {
    const result = validateManifest(
      makeManifest({
        contributes: {
          commands: [{ id: "do-thing", title: "Do Thing" }],
          events: ["workspace:created", "pane:focused"],
          secondarySidebarTabs: [{ id: "my-tab", label: "My Tab" }],
          primarySidebarSections: [{ id: "my-section", label: "My Section" }],
          surfaces: [{ id: "my-surface", label: "My Surface" }],
        },
      }),
    );
    expect(result.valid).toBe(true);
  });

  it("rejects a manifest missing required fields", () => {
    const result = validateManifest({
      name: "No ID",
    } as unknown as ExtensionManifest);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e: string) => e.includes("id"))).toBe(true);
  });

  it("rejects a manifest with empty id", () => {
    const result = validateManifest(makeManifest({ id: "" }));
    expect(result.valid).toBe(false);
  });

  it("rejects a manifest with empty version", () => {
    const result = validateManifest(makeManifest({ version: "" }));
    expect(result.valid).toBe(false);
  });

  it("rejects a manifest with invalid event types", () => {
    const result = validateManifest(
      makeManifest({
        contributes: {
          events: [
            "workspace:created",
            "not:a:real:event" as unknown as string,
          ],
        },
      }),
    );
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e: string) => e.includes("not:a:real:event")),
    ).toBe(true);
  });
});

// --- ExtensionAPI construction ---

describe("createExtensionAPI", () => {
  const manifest = makeManifest({
    contributes: {
      events: ["workspace:created", "workspace:closed"],
      commands: [{ id: "test-cmd", title: "Test Command" }],
    },
  });

  it("returns an object implementing ExtensionAPI", () => {
    const { api } = createExtensionAPI(manifest);
    expect(api).toHaveProperty("onActivate");
    expect(api).toHaveProperty("onDeactivate");
    expect(api).toHaveProperty("on");
    expect(api).toHaveProperty("off");
    expect(api).toHaveProperty("registerCommand");
    expect(api).toHaveProperty("registerSecondarySidebarTab");
    expect(api).toHaveProperty("registerPrimarySidebarSection");
    expect(api).toHaveProperty("registerSurfaceType");
    expect(api).toHaveProperty("state");
    expect(api).toHaveProperty("workspaces");
    expect(api).toHaveProperty("activeWorkspace");
    expect(api).toHaveProperty("activePane");
    expect(api).toHaveProperty("activeSurface");
    expect(api).toHaveProperty("theme");
    expect(api).toHaveProperty("settings");
  });

  it("exposes read-only Svelte stores", () => {
    const { api } = createExtensionAPI(manifest);
    // Readable stores have subscribe but not set
    expect(typeof api.workspaces.subscribe).toBe("function");
    expect(
      (api.workspaces as unknown as Record<string, unknown>).set,
    ).toBeUndefined();
  });
});

// --- Event filtering ---

describe("ExtensionAPI event filtering", () => {
  it("allows subscribing to declared events", () => {
    const manifest = makeManifest({
      contributes: { events: ["workspace:created"] },
    });
    const { api } = createExtensionAPI(manifest);
    const handler = vi.fn();

    // Should not throw
    api.on("workspace:created", handler);

    eventBus.emit({ type: "workspace:created", id: "ws1", name: "Test" });
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ type: "workspace:created", id: "ws1" }),
    );

    api.off("workspace:created", handler);
  });

  it("rejects subscribing to undeclared events", () => {
    const manifest = makeManifest({
      contributes: { events: ["workspace:created"] },
    });
    const { api } = createExtensionAPI(manifest);

    expect(() => {
      api.on("pane:focused", vi.fn());
    }).toThrow(/not declared/);
  });

  it("rejects all events when no events are declared (deny-by-default)", () => {
    const manifest = makeManifest(); // no contributes.events
    const { api } = createExtensionAPI(manifest);

    // Extensions with no declared events cannot subscribe to any
    expect(() => {
      api.on("workspace:created", vi.fn());
    }).toThrow(/not declared/);
  });
});

// --- Command registration ---

describe("ExtensionAPI command registration", () => {
  beforeEach(async () => {
    await resetExtensions();
  });

  it("registers commands with extension source", () => {
    const manifest = makeManifest({
      id: "my-ext",
      contributes: { commands: [{ id: "do-thing", title: "Do Thing" }] },
    });
    const { api } = createExtensionAPI(manifest);
    const handler = vi.fn();

    api.registerCommand("do-thing", handler);

    const cmds = get(commandStore);
    const registered = cmds.find((c) => c.id === "my-ext:do-thing");
    expect(registered).toBeDefined();
    expect(registered!.title).toBe("Do Thing");
    expect(registered!.source).toBe("my-ext");
    expect(registered!.action).toBe(handler);
  });

  it("namespaces command IDs with extension id", () => {
    const manifest = makeManifest({ id: "foo" });
    const { api } = createExtensionAPI(manifest);
    api.registerCommand("bar", vi.fn());

    const cmds = get(commandStore);
    expect(cmds.some((c) => c.id === "foo:bar")).toBe(true);
  });
});

// --- Scoped state ---

describe("ExtensionAPI state", () => {
  it("stores and retrieves values by key", () => {
    const { api } = createExtensionAPI(makeManifest());
    api.state.set("count", 42);
    expect(api.state.get<number>("count")).toBe(42);
  });

  it("returns undefined for unset keys", () => {
    const { api } = createExtensionAPI(makeManifest());
    expect(api.state.get("nope")).toBeUndefined();
  });

  it("isolates state between extensions", () => {
    const { api: api1 } = createExtensionAPI(makeManifest({ id: "ext-a" }));
    const { api: api2 } = createExtensionAPI(makeManifest({ id: "ext-b" }));

    api1.state.set("key", "a-value");
    api2.state.set("key", "b-value");

    expect(api1.state.get("key")).toBe("a-value");
    expect(api2.state.get("key")).toBe("b-value");
  });
});

// --- Extension lifecycle ---

describe("Extension lifecycle", () => {
  beforeEach(async () => {
    await resetExtensions();
  });

  it("registerExtension adds an extension to the store", () => {
    const manifest = makeManifest();
    registerExtension(manifest);

    const extensions = get(extensionStore);
    expect(extensions).toHaveLength(1);
    expect(extensions[0].manifest.id).toBe("test-extension");
    expect(extensions[0].enabled).toBe(false);
  });

  it("registerExtension rejects duplicate extension IDs", () => {
    registerExtension(makeManifest());
    expect(() => registerExtension(makeManifest())).toThrow(
      /already registered/,
    );
  });

  it("activateExtension calls the onActivate callback", async () => {
    const manifest = makeManifest();
    const activateFn = vi.fn();
    const registerFn = (api: ExtensionAPI) => {
      api.onActivate(activateFn);
    };

    registerExtension(manifest, registerFn);
    await activateExtension("test-extension");

    expect(activateFn).toHaveBeenCalledOnce();

    const extensions = get(extensionStore);
    expect(extensions[0].enabled).toBe(true);
  });

  it("deactivateExtension calls the onDeactivate callback", async () => {
    const manifest = makeManifest();
    const deactivateFn = vi.fn();
    const registerFn = (api: ExtensionAPI) => {
      api.onActivate(() => {});
      api.onDeactivate(deactivateFn);
    };

    registerExtension(manifest, registerFn);
    await activateExtension("test-extension");
    deactivateExtension("test-extension");

    expect(deactivateFn).toHaveBeenCalledOnce();

    const extensions = get(extensionStore);
    expect(extensions[0].enabled).toBe(false);
  });

  it("deactivateExtension cleans up registered commands", async () => {
    const manifest = makeManifest({
      id: "cleanup-test",
      contributes: { commands: [{ id: "my-cmd", title: "My Command" }] },
    });
    const registerFn = (api: ExtensionAPI) => {
      api.onActivate(() => {
        api.registerCommand("my-cmd", () => {});
      });
    };

    registerExtension(manifest, registerFn);
    await activateExtension("cleanup-test");

    // Command is registered
    expect(get(commandStore).some((c) => c.id === "cleanup-test:my-cmd")).toBe(
      true,
    );

    deactivateExtension("cleanup-test");

    // Command is cleaned up
    expect(get(commandStore).some((c) => c.id === "cleanup-test:my-cmd")).toBe(
      false,
    );
  });

  it("deactivateExtension cleans up event subscriptions", async () => {
    const manifest = makeManifest({
      id: "event-cleanup",
      contributes: { events: ["workspace:created"] },
    });
    const handler = vi.fn();
    const registerFn = (api: ExtensionAPI) => {
      api.onActivate(() => {
        api.on("workspace:created", handler);
      });
    };

    registerExtension(manifest, registerFn);
    await activateExtension("event-cleanup");

    // Handler is active
    eventBus.emit({ type: "workspace:created", id: "ws1", name: "Test" });
    expect(handler).toHaveBeenCalledOnce();

    deactivateExtension("event-cleanup");
    handler.mockClear();

    // Handler should be cleaned up
    eventBus.emit({ type: "workspace:created", id: "ws2", name: "Test 2" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("deactivateExtension cleans up registered sidebar tabs", async () => {
    const manifest = makeManifest({
      id: "tab-cleanup",
      contributes: {
        secondarySidebarTabs: [{ id: "my-tab", label: "My Tab" }],
      },
    });
    const registerFn = (api: ExtensionAPI) => {
      api.onActivate(() => {
        api.registerSecondarySidebarTab("my-tab", { fake: "component" });
      });
    };

    resetSidebarTabs();
    registerExtension(manifest, registerFn);
    await activateExtension("tab-cleanup");

    expect(
      get(sidebarTabStore).some((t) => t.id === "tab-cleanup:my-tab"),
    ).toBe(true);

    deactivateExtension("tab-cleanup");

    expect(
      get(sidebarTabStore).some((t) => t.id === "tab-cleanup:my-tab"),
    ).toBe(false);
  });

  it("deactivateExtension cleans up registered sidebar sections", async () => {
    const manifest = makeManifest({
      id: "section-cleanup",
      contributes: {
        primarySidebarSections: [{ id: "my-section", label: "My Section" }],
      },
    });
    const registerFn = (api: ExtensionAPI) => {
      api.onActivate(() => {
        api.registerPrimarySidebarSection("my-section", {
          fake: "component",
        });
      });
    };

    resetSidebarSections();
    registerExtension(manifest, registerFn);
    await activateExtension("section-cleanup");

    expect(
      get(sidebarSectionStore).some(
        (s) => s.id === "section-cleanup:my-section",
      ),
    ).toBe(true);

    deactivateExtension("section-cleanup");

    expect(
      get(sidebarSectionStore).some(
        (s) => s.id === "section-cleanup:my-section",
      ),
    ).toBe(false);
  });

  it("deactivateExtension cleans up registered surface types", async () => {
    const manifest = makeManifest({
      id: "surface-cleanup",
      contributes: {
        surfaces: [{ id: "my-surface", label: "My Surface" }],
      },
    });
    const registerFn = (api: ExtensionAPI) => {
      api.onActivate(() => {
        api.registerSurfaceType("my-surface", { fake: "component" });
      });
    };

    resetSurfaceTypes();
    registerExtension(manifest, registerFn);
    await activateExtension("surface-cleanup");

    expect(
      get(surfaceTypeStore).some((t) => t.id === "surface-cleanup:my-surface"),
    ).toBe(true);

    deactivateExtension("surface-cleanup");

    expect(
      get(surfaceTypeStore).some((t) => t.id === "surface-cleanup:my-surface"),
    ).toBe(false);
  });

  it("deactivateExtension cleans up registered context menu items", async () => {
    const manifest = makeManifest({
      id: "menu-cleanup",
      contributes: {
        contextMenuItems: [
          { id: "open-preview", label: "Open as Preview", when: "*.md" },
        ],
      },
    });
    const registerFn = (api: ExtensionAPI) => {
      api.onActivate(() => {
        api.registerContextMenuItem("open-preview", () => {});
      });
    };

    resetContextMenuItems();
    registerExtension(manifest, registerFn);
    await activateExtension("menu-cleanup");

    expect(
      get(contextMenuItemStore).some(
        (i) => i.id === "menu-cleanup:open-preview",
      ),
    ).toBe(true);

    deactivateExtension("menu-cleanup");

    expect(
      get(contextMenuItemStore).some(
        (i) => i.id === "menu-cleanup:open-preview",
      ),
    ).toBe(false);
  });

  it("registerContextMenuItem uses manifest label and when", async () => {
    const manifest = makeManifest({
      id: "ctx-manifest",
      contributes: {
        contextMenuItems: [
          { id: "my-item", label: "My Custom Label", when: "*.{ts,js}" },
        ],
      },
    });
    const registerFn = (api: ExtensionAPI) => {
      api.onActivate(() => {
        api.registerContextMenuItem("my-item", () => {});
      });
    };

    resetContextMenuItems();
    registerExtension(manifest, registerFn);
    await activateExtension("ctx-manifest");

    const item = get(contextMenuItemStore).find(
      (i) => i.id === "ctx-manifest:my-item",
    );
    expect(item).toBeTruthy();
    expect(item!.label).toBe("My Custom Label");
    expect(item!.when).toBe("*.{ts,js}");
  });

  it("registerContextMenuItem throws for undeclared itemId", async () => {
    const manifest = makeManifest({
      id: "ctx-undeclared",
      contributes: {
        contextMenuItems: [
          { id: "declared-item", label: "Declared", when: "*" },
        ],
      },
    });
    const registerFn = (api: ExtensionAPI) => {
      api.onActivate(() => {
        api.registerContextMenuItem("undeclared-item", () => {});
      });
    };

    resetContextMenuItems();
    registerExtension(manifest, registerFn);
    await expect(activateExtension("ctx-undeclared")).rejects.toThrow(
      /not declared in the manifest/,
    );
  });

  it("deactivateExtension closes orphaned extension surfaces", async () => {
    const manifest = makeManifest({
      id: "surface-orphan",
      contributes: {
        surfaces: [{ id: "viewer", label: "Viewer" }],
      },
    });
    const registerFn = (api: ExtensionAPI) => {
      api.onActivate(() => {
        api.registerSurfaceType("viewer", { fake: "component" });
      });
    };

    resetSurfaceTypes();
    registerExtension(manifest, registerFn);
    await activateExtension("surface-orphan");

    // Simulate a workspace with an extension surface of this type
    const { workspaces: wsStore } = await import("../lib/stores/workspace");
    wsStore.set([
      {
        id: "ws-1",
        name: "Test Workspace",
        activePaneId: "pane-1",
        splitRoot: {
          type: "pane",
          pane: {
            id: "pane-1",
            activeSurfaceId: "ext-surface-1",
            surfaces: [
              {
                id: "ext-surface-1",
                kind: "extension",
                surfaceTypeId: "surface-orphan:viewer",
              },
              {
                id: "term-surface-1",
                kind: "terminal",
                title: "zsh",
                ptyId: -1,
                terminal: { dispose: vi.fn(), focus: vi.fn() },
              },
            ],
          },
        },
      },
    ] as unknown as import("../lib/types").Workspace[]);

    deactivateExtension("surface-orphan");

    // The extension surface should be removed
    const ws = get(wsStore);
    const pane = ws[0].splitRoot.type === "pane" ? ws[0].splitRoot.pane : null;
    expect(pane).toBeTruthy();
    expect(pane!.surfaces).toHaveLength(1);
    expect(pane!.surfaces[0].id).toBe("term-surface-1");

    // Clean up
    wsStore.set([]);
  });

  it("activateExtension throws for unknown extension id", async () => {
    await expect(activateExtension("nonexistent")).rejects.toThrow(
      'Extension "nonexistent" not found',
    );
  });

  it("unloadExtension removes the extension from the store", async () => {
    registerExtension(makeManifest());
    await activateExtension("test-extension");

    unloadExtension("test-extension");

    expect(get(extensionStore)).toHaveLength(0);
  });

  it("activateExtension is a no-op for already-active extensions", async () => {
    const activateFn = vi.fn();
    registerExtension(makeManifest(), (api: ExtensionAPI) => {
      api.onActivate(activateFn);
    });

    await activateExtension("test-extension");
    await activateExtension("test-extension");

    expect(activateFn).toHaveBeenCalledOnce();
  });

  it("deactivateExtension is a no-op for inactive extensions", () => {
    registerExtension(makeManifest());
    // Should not throw
    deactivateExtension("test-extension");
  });

  it("registerExtension cleans up on registerFn throw", () => {
    const manifest = makeManifest({ id: "throw-register" });
    expect(() =>
      registerExtension(manifest, () => {
        throw new Error("register boom");
      }),
    ).toThrow("register boom");

    // Extension should NOT be in the store
    expect(get(extensionStore)).toHaveLength(0);
    // API should NOT be accessible
    expect(getExtensionApiById("throw-register")).toBeUndefined();
  });

  it("deactivateExtension completes cleanup even if deactivate callback throws", async () => {
    const manifest = makeManifest({
      id: "throw-deactivate",
      contributes: {
        commands: [{ id: "cmd", title: "Cmd" }],
        events: ["workspace:created"],
      },
    });
    const handler = vi.fn();
    registerExtension(manifest, (api: ExtensionAPI) => {
      api.onActivate(() => {
        api.registerCommand("cmd", () => {});
        api.on("workspace:created", handler);
      });
      api.onDeactivate(() => {
        throw new Error("deactivate boom");
      });
    });

    await activateExtension("throw-deactivate");

    // Command should be registered
    expect(get(commandStore).some((c) => c.id === "throw-deactivate:cmd")).toBe(
      true,
    );

    // Deactivate should NOT throw — error is caught internally
    expect(() => deactivateExtension("throw-deactivate")).not.toThrow();

    // Cleanup should still have run: command unregistered
    expect(get(commandStore).some((c) => c.id === "throw-deactivate:cmd")).toBe(
      false,
    );

    // Event handler should be cleaned up
    eventBus.emit({ type: "workspace:created", id: "ws-1", name: "Test" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("activateExtension rolls back partial registrations on callback throw", async () => {
    const manifest = makeManifest({
      id: "throw-activate",
      contributes: {
        commands: [{ id: "partial-cmd", title: "Partial" }],
        events: ["workspace:created"],
      },
    });
    const handler = vi.fn();
    registerExtension(manifest, (api: ExtensionAPI) => {
      api.onActivate(() => {
        api.registerCommand("partial-cmd", () => {});
        api.on("workspace:created", handler);
        throw new Error("activate boom");
      });
    });

    await expect(activateExtension("throw-activate")).rejects.toThrow(
      "activate boom",
    );

    // The partial command registration should be rolled back
    expect(
      get(commandStore).some((c) => c.id === "throw-activate:partial-cmd"),
    ).toBe(false);

    // The event handler should be cleaned up
    eventBus.emit({ type: "workspace:created", id: "ws-1", name: "Test" });
    expect(handler).not.toHaveBeenCalled();

    // Extension should NOT be marked as enabled
    const ext = get(extensionStore).find(
      (e) => e.manifest.id === "throw-activate",
    );
    expect(ext?.enabled).toBe(false);
  });
});

// --- State persistence lifecycle ---

describe("Extension state persistence", () => {
  beforeEach(async () => {
    await resetExtensions();
    mockLoadState.mockReset().mockResolvedValue({});
    mockSaveState.mockReset().mockResolvedValue(undefined);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("state.set debounces and writes to disk after 300ms", async () => {
    const manifest = makeManifest({ id: "state-debounce" });
    let capturedApi: ExtensionAPI | undefined;
    registerExtension(manifest, (api: ExtensionAPI) => {
      capturedApi = api;
      api.onActivate(() => {});
    });
    await activateExtension("state-debounce");

    capturedApi!.state.set("key1", "val1");
    capturedApi!.state.set("key2", "val2"); // should coalesce

    expect(mockSaveState).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);

    // Wait for the async saveExtensionState to resolve
    await vi.runAllTimersAsync();

    expect(mockSaveState).toHaveBeenCalledOnce();
    expect(mockSaveState).toHaveBeenCalledWith("state-debounce", {
      key1: "val1",
      key2: "val2",
    });
  });

  it("state loaded at activation is accessible via state.get", async () => {
    mockLoadState.mockResolvedValue({ saved: "data", count: 42 });

    const manifest = makeManifest({ id: "state-load" });
    let capturedApi: ExtensionAPI | undefined;
    registerExtension(manifest, (api: ExtensionAPI) => {
      capturedApi = api;
      api.onActivate(() => {});
    });
    await activateExtension("state-load");

    expect(capturedApi!.state.get("saved")).toBe("data");
    expect(capturedApi!.state.get("count")).toBe(42);
    expect(capturedApi!.state.get("missing")).toBeUndefined();
  });

  it("unloadExtension flushes pending debounced state write", async () => {
    const manifest = makeManifest({ id: "state-flush" });
    let capturedApi: ExtensionAPI | undefined;
    registerExtension(manifest, (api: ExtensionAPI) => {
      capturedApi = api;
      api.onActivate(() => {});
    });
    await activateExtension("state-flush");

    capturedApi!.state.set("pending", true);
    // Don't advance timers — the debounce hasn't fired yet
    expect(mockSaveState).not.toHaveBeenCalled();

    // Unload should flush immediately
    await unloadExtension("state-flush");

    expect(mockSaveState).toHaveBeenCalledOnce();
    expect(mockSaveState).toHaveBeenCalledWith("state-flush", {
      pending: true,
    });
  });
});

// --- Clipboard & file watch API ---

describe("ExtensionAPI clipboard and file watching", () => {
  beforeEach(async () => {
    await resetExtensions();
  });

  it("exposes readClipboard and writeClipboard on the API", async () => {
    const manifest = makeManifest({ id: "clip-test" });
    let capturedApi: ExtensionAPI | undefined;
    registerExtension(manifest, (api: ExtensionAPI) => {
      capturedApi = api;
    });

    expect(capturedApi).toBeTruthy();
    expect(typeof capturedApi!.readClipboard).toBe("function");
    expect(typeof capturedApi!.writeClipboard).toBe("function");
  });

  it("exposes onFileChanged on the API", async () => {
    const manifest = makeManifest({ id: "watch-test" });
    let capturedApi: ExtensionAPI | undefined;
    registerExtension(manifest, (api: ExtensionAPI) => {
      capturedApi = api;
    });

    expect(capturedApi).toBeTruthy();
    expect(typeof capturedApi!.onFileChanged).toBe("function");
  });

  it("onFileChanged returns an unsubscribe function", async () => {
    const manifest = makeManifest({ id: "unsub-test" });
    let capturedApi: ExtensionAPI | undefined;
    registerExtension(manifest, (api: ExtensionAPI) => {
      capturedApi = api;
    });

    const unsub = capturedApi!.onFileChanged(1, () => {});
    expect(typeof unsub).toBe("function");
  });
});

// --- Extension store ---

describe("extensionStore", () => {
  beforeEach(async () => {
    await resetExtensions();
  });

  it("starts empty", () => {
    expect(get(extensionStore)).toEqual([]);
  });

  it("is reactive to extension registration", () => {
    const values: LoadedExtension[][] = [];
    const unsub = extensionStore.subscribe((v) => values.push([...v]));

    registerExtension(makeManifest({ id: "a" }));
    registerExtension(makeManifest({ id: "b" }));

    expect(values.length).toBeGreaterThanOrEqual(3); // initial + 2 updates
    expect(values[values.length - 1]).toHaveLength(2);

    unsub();
  });
});

// --- Extension settings API ---

describe("Extension settings API", () => {
  beforeEach(async () => {
    await resetExtensions();
  });

  it("getSetting returns default from manifest when no config set", () => {
    const manifest = makeManifest({
      id: "settings-ext",
      contributes: {
        settings: {
          fields: {
            maxItems: {
              type: "number",
              title: "Max Items",
              default: 50,
            },
          },
        },
      },
    });

    vi.spyOn(config, "getConfig").mockReturnValue({});

    const { api } = createExtensionAPI(manifest);
    expect(api.getSetting<number>("maxItems")).toBe(50);
  });

  it("getSetting returns config value over default", () => {
    const manifest = makeManifest({
      id: "settings-ext",
      contributes: {
        settings: {
          fields: {
            maxItems: {
              type: "number",
              title: "Max Items",
              default: 50,
            },
          },
        },
      },
    });

    vi.spyOn(config, "getConfig").mockReturnValue({
      extensions: {
        "settings-ext": {
          enabled: true,
          settings: { maxItems: 100 },
        },
      },
    });

    const { api } = createExtensionAPI(manifest);
    expect(api.getSetting<number>("maxItems")).toBe(100);
  });

  it("getSettings returns all fields with defaults merged", () => {
    const manifest = makeManifest({
      id: "settings-ext",
      contributes: {
        settings: {
          fields: {
            enabled: { type: "boolean", title: "Enabled", default: true },
            name: { type: "string", title: "Name", default: "default" },
          },
        },
      },
    });

    vi.spyOn(config, "getConfig").mockReturnValue({
      extensions: {
        "settings-ext": {
          enabled: true,
          settings: { name: "custom" },
        },
      },
    });

    const { api } = createExtensionAPI(manifest);
    const settings = api.getSettings();
    expect(settings).toEqual({ enabled: true, name: "custom" });
  });

  it("getSetting returns undefined for unknown keys", () => {
    const manifest = makeManifest({ id: "settings-ext" });
    vi.spyOn(config, "getConfig").mockReturnValue({});

    const { api } = createExtensionAPI(manifest);
    expect(api.getSetting("nonexistent")).toBeUndefined();
  });
});

// --- Invoke allowlist ---

describe("ExtensionAPI invoke allowlist", () => {
  beforeEach(async () => {
    await resetExtensions();
  });

  it("allows file system commands", async () => {
    const manifest = makeManifest();
    const { api } = createExtensionAPI(manifest);

    // list_dir should not be rejected by the allowlist
    // (it will fail at the Tauri layer in tests, but that's expected)
    await expect(api.invoke("list_dir", { path: "/tmp" })).rejects.not.toThrow(
      /not allowed/,
    );
  });

  it("rejects PTY commands", async () => {
    const manifest = makeManifest();
    const { api } = createExtensionAPI(manifest);

    await expect(
      api.invoke("spawn_pty", { cols: 80, rows: 24 }),
    ).rejects.toThrow(/not allowed/);

    await expect(
      api.invoke("write_pty", { ptyId: 1, data: "rm -rf ~\n" }),
    ).rejects.toThrow(/not allowed/);

    await expect(api.invoke("kill_pty", { ptyId: 1 })).rejects.toThrow(
      /not allowed/,
    );
  });

  it("rejects unknown commands", async () => {
    const manifest = makeManifest();
    const { api } = createExtensionAPI(manifest);

    await expect(api.invoke("some_unknown_command", {})).rejects.toThrow(
      /not allowed/,
    );
  });

  it("blocks extension access to app config directory", async () => {
    const manifest = makeManifest();
    const { api } = createExtensionAPI(manifest);

    await expect(
      api.invoke("read_file", {
        path: "/home/user/.config/gnar-term/settings.json",
      }),
    ).rejects.toThrow(/Access denied/);

    await expect(
      api.invoke("list_dir", {
        path: "/home/user/.config/gnar-term/extensions",
      }),
    ).rejects.toThrow(/Access denied/);

    await expect(
      api.invoke("file_exists", {
        path: "/home/user/.config/gnar-term/state.json",
      }),
    ).rejects.toThrow(/Access denied/);
  });
});

// --- Manifest entry path validation ---

describe("validateManifest entry path validation", () => {
  it("rejects entry with path traversal (..)", () => {
    const result = validateManifest(
      makeManifest({ entry: "../../malicious.js" }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("entry path"))).toBe(true);
  });

  it("rejects entry starting with /", () => {
    const result = validateManifest(
      makeManifest({ entry: "/absolute/path.js" }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("entry path"))).toBe(true);
  });

  it("rejects entry starting with backslash", () => {
    const result = validateManifest(
      makeManifest({ entry: "\\windows\\path.js" }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("entry path"))).toBe(true);
  });

  it("accepts valid relative entry paths", () => {
    expect(
      validateManifest(makeManifest({ entry: "./dist/index.js" })).valid,
    ).toBe(true);
    expect(
      validateManifest(makeManifest({ entry: "dist/index.js" })).valid,
    ).toBe(true);
  });
});

// --- Extension ID format validation ---

describe("validateManifest ID format validation", () => {
  it("rejects uppercase characters", () => {
    const result = validateManifest(makeManifest({ id: "MyExtension" }));
    expect(result.valid).toBe(false);
  });

  it("rejects consecutive hyphens", () => {
    const result = validateManifest(makeManifest({ id: "my--ext" }));
    expect(result.valid).toBe(false);
  });

  it("rejects leading hyphen", () => {
    const result = validateManifest(makeManifest({ id: "-ext" }));
    expect(result.valid).toBe(false);
  });

  it("rejects trailing hyphen", () => {
    const result = validateManifest(makeManifest({ id: "ext-" }));
    expect(result.valid).toBe(false);
  });
});
