/**
 * Settings → Themes tab smoke test. Verifies the tab renders one delete
 * button per user-imported theme so the import → delete loop has a
 * working surface. Heavy mocking — config and theme-registry are stubbed
 * because the actual stores wire into Tauri APIs.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/svelte";
import { themes } from "../lib/theme-data";
import type { GnarTermConfig } from "../lib/config";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/config", async () => {
  const { writable } = await import("svelte/store");
  const store = writable<GnarTermConfig>({});
  let current: GnarTermConfig = {};
  store.subscribe((c) => {
    current = c;
  });
  return {
    configStore: store,
    getConfig: () => current,
    saveConfig: vi.fn(async (updates: Partial<GnarTermConfig>) => {
      current = { ...current, ...updates };
      store.set(current);
    }),
    __setConfig: (c: GnarTermConfig) => {
      current = c;
      store.set(c);
    },
  };
});

vi.mock("../lib/services/theme-registry", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/services/theme-registry")>();
  return {
    ...actual,
    registerTheme: vi.fn(),
    unregisterThemesBySource: vi.fn(),
  };
});

import SettingsThemesTab from "../lib/components/SettingsThemesTab.svelte";
import * as configMock from "../lib/config";

// Cast to reach the test-only setter exposed by the mock factory.
const setConfig = (
  configMock as unknown as {
    __setConfig: (c: GnarTermConfig) => void;
  }
).__setConfig;

describe("SettingsThemesTab", () => {
  beforeEach(() => {
    cleanup();
    setConfig({});
  });

  it("shows empty state when no user themes are configured", () => {
    const { container } = render(SettingsThemesTab);
    expect(container.querySelector('[data-page="themes"]')).toBeTruthy();
    expect(container.textContent).toContain("No imported themes yet");
    expect(container.querySelectorAll("[data-theme-delete]")).toHaveLength(0);
  });

  it("renders one delete button per user-imported theme", () => {
    setConfig({
      userThemes: {
        "my-cool-theme": { ...themes["github-dark"], name: "My Cool Theme" },
        "second-theme": { ...themes["tokyo-night"], name: "Second Theme" },
      },
    });

    const { container } = render(SettingsThemesTab);
    const deleteButtons = container.querySelectorAll("[data-theme-delete]");
    expect(deleteButtons).toHaveLength(2);
    expect(deleteButtons[0].getAttribute("data-theme-delete")).toBe(
      "my-cool-theme",
    );
    expect(deleteButtons[1].getAttribute("data-theme-delete")).toBe(
      "second-theme",
    );
  });

  it("exposes an import button that triggers the file picker", () => {
    const { container } = render(SettingsThemesTab);
    const importBtn = container.querySelector('[data-action="import-theme"]');
    expect(importBtn).toBeTruthy();
    const fileInput = container.querySelector('input[type="file"]');
    expect(fileInput).toBeTruthy();
    expect(fileInput?.getAttribute("accept")).toContain(".itermcolors");
    expect(fileInput?.getAttribute("accept")).toContain(".yaml");
  });
});
