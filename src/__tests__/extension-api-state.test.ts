/**
 * Tests for extension-api-state — setting coercion against declared types.
 * Config files live on disk and may be hand-edited, so the boundary has to
 * coerce rather than trust shape.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    extensions: {} as Record<string, { settings?: Record<string, unknown> }>,
  },
}));

vi.mock("../lib/config", async () => {
  const { writable } = await import("svelte/store");
  return {
    getConfig: () => mockConfig,
    configStore: writable(mockConfig),
  };
});

import { createStateAPI } from "../lib/services/extension-api-state";
import type { ExtensionManifest } from "../extensions/api";

function mkMaps() {
  return {
    stateMap: new Map<string, Map<string, unknown>>(),
    setExtensionState: vi.fn(),
  };
}

function mkManifest(
  fields: ExtensionManifest["contributes"] extends infer C
    ? C extends { settings?: infer S }
      ? S extends { fields: infer F }
        ? F
        : never
      : never
    : never,
): ExtensionManifest {
  return {
    id: "ext-state",
    name: "State Test",
    version: "0.0.1",
    entry: "index.js",
    contributes: {
      settings: { fields: fields as never },
    },
  };
}

beforeEach(() => {
  mockConfig.extensions = {};
});

describe("extension-api-state — setting coercion", () => {
  it("coerces string 'true'/'false' into booleans", () => {
    const manifest = mkManifest({
      enabled: { type: "boolean", title: "Enabled", default: false },
    });
    const api = createStateAPI("ext-state", manifest, mkMaps() as never);
    mockConfig.extensions["ext-state"] = { settings: { enabled: "true" } };
    expect(api.getSetting<boolean>("enabled")).toBe(true);
    mockConfig.extensions["ext-state"] = { settings: { enabled: "false" } };
    expect(api.getSetting<boolean>("enabled")).toBe(false);
  });

  it("coerces numeric strings into numbers", () => {
    const manifest = mkManifest({
      maxItems: { type: "number", title: "Max", default: 50 },
    });
    const api = createStateAPI("ext-state", manifest, mkMaps() as never);
    mockConfig.extensions["ext-state"] = { settings: { maxItems: "25" } };
    expect(api.getSetting<number>("maxItems")).toBe(25);
  });

  it("falls back to default when a number cannot be parsed", () => {
    const manifest = mkManifest({
      maxItems: { type: "number", title: "Max", default: 50 },
    });
    const api = createStateAPI("ext-state", manifest, mkMaps() as never);
    mockConfig.extensions["ext-state"] = { settings: { maxItems: "abc" } };
    expect(api.getSetting<number>("maxItems")).toBe(50);
  });

  it("leaves matching types alone", () => {
    const manifest = mkManifest({
      enabled: { type: "boolean", title: "Enabled", default: false },
      maxItems: { type: "number", title: "Max", default: 50 },
      theme: { type: "string", title: "Theme", default: "light" },
    });
    const api = createStateAPI("ext-state", manifest, mkMaps() as never);
    mockConfig.extensions["ext-state"] = {
      settings: { enabled: true, maxItems: 7, theme: "dark" },
    };
    expect(api.getSetting<boolean>("enabled")).toBe(true);
    expect(api.getSetting<number>("maxItems")).toBe(7);
    expect(api.getSetting<string>("theme")).toBe("dark");
  });

  it("getSettings() returns coerced values with defaults merged", () => {
    const manifest = mkManifest({
      enabled: { type: "boolean", title: "Enabled", default: false },
      maxItems: { type: "number", title: "Max", default: 50 },
      theme: { type: "string", title: "Theme", default: "light" },
    });
    const api = createStateAPI("ext-state", manifest, mkMaps() as never);
    mockConfig.extensions["ext-state"] = {
      settings: { enabled: "true", maxItems: "99" },
    };
    expect(api.getSettings()).toEqual({
      enabled: true,
      maxItems: 99,
      theme: "light",
    });
  });

  it("falls back to manifest default when key is absent", () => {
    const manifest = mkManifest({
      enabled: { type: "boolean", title: "Enabled", default: true },
    });
    const api = createStateAPI("ext-state", manifest, mkMaps() as never);
    expect(api.getSetting<boolean>("enabled")).toBe(true);
  });
});
