/**
 * Tests for SettingsOverlay — the settings UI overlay.
 *
 * Tests cover: rendering when open, hiding when closed, left nav with
 * General/Extensions pages, page switching, close on backdrop click,
 * and settings persistence.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/svelte";
import { get } from "svelte/store";

// --- Mocks ---

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "list_monospace_fonts")
      return Promise.resolve(["Menlo", "SF Mono"]);
    return Promise.resolve(undefined);
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

// --- Imports (after mocks) ---

import SettingsOverlay from "../lib/components/SettingsOverlay.svelte";
import SettingsGeneralTab from "../lib/components/SettingsGeneralTab.svelte";
import SettingsExtensionsTab from "../lib/components/SettingsExtensionsTab.svelte";
import SettingsExtensionPage from "../lib/components/SettingsExtensionPage.svelte";
import { settingsOpen } from "../lib/stores/ui";
import {
  registerExtension,
  resetExtensions,
} from "../lib/services/extension-loader";
import type { ExtensionManifest } from "../lib/extension-types";

// --- Tests ---

describe("SettingsOverlay", () => {
  beforeEach(() => {
    settingsOpen.set(false);
    cleanup();
  });

  it("does not render when settingsOpen is false", () => {
    const { container } = render(SettingsOverlay);
    expect(container.querySelector(".settings-overlay")).toBeNull();
  });

  it("renders when settingsOpen is true", () => {
    settingsOpen.set(true);
    const { container } = render(SettingsOverlay);
    expect(container.querySelector(".settings-overlay")).toBeTruthy();
  });

  it("renders left nav with General and Extensions pages", () => {
    settingsOpen.set(true);
    const { container } = render(SettingsOverlay);
    const navButtons = container.querySelectorAll("nav button");
    const labels = Array.from(navButtons).map((b) => b.textContent);
    expect(labels).toContain("General");
    expect(labels).toContain("Extensions");
  });

  it("shows General page by default", () => {
    settingsOpen.set(true);
    const { container } = render(SettingsOverlay);
    expect(container.querySelector("[data-page='general']")).toBeTruthy();
  });

  it("switches to Extensions page when clicked", async () => {
    settingsOpen.set(true);
    const { container } = render(SettingsOverlay);
    const navButtons = container.querySelectorAll("nav button");
    const extBtn = Array.from(navButtons).find(
      (b) => b.textContent === "Extensions",
    )!;
    await fireEvent.click(extBtn);
    expect(container.querySelector("[data-page='extensions']")).toBeTruthy();
    expect(container.querySelector("[data-page='general']")).toBeNull();
  });

  it("closes when backdrop is clicked", async () => {
    settingsOpen.set(true);
    const { container } = render(SettingsOverlay);
    const backdrop = container.querySelector(".settings-overlay");
    await fireEvent.click(backdrop!);
    expect(get(settingsOpen)).toBe(false);
  });

  it("does not close when inner panel is clicked", async () => {
    settingsOpen.set(true);
    const { container } = render(SettingsOverlay);
    const panel = container.querySelector(".settings-panel");
    await fireEvent.click(panel!);
    expect(get(settingsOpen)).toBe(true);
  });

  it("renders Settings title in the panel header", () => {
    settingsOpen.set(true);
    render(SettingsOverlay);
    expect(screen.getByText("Settings")).toBeTruthy();
  });

  it("General page has theme selector", () => {
    settingsOpen.set(true);
    const { container } = render(SettingsOverlay);
    const select = container.querySelector("select[data-field='theme']");
    expect(select).toBeTruthy();
  });

  it("General page has font size input", () => {
    settingsOpen.set(true);
    const { container } = render(SettingsOverlay);
    const input = container.querySelector("input[data-field='fontSize']");
    expect(input).toBeTruthy();
    expect((input as HTMLInputElement).type).toBe("number");
  });

  it("General page has font family dropdown", () => {
    settingsOpen.set(true);
    const { container } = render(SettingsOverlay);
    const select = container.querySelector("select[data-field='fontFamily']");
    expect(select).toBeTruthy();
  });

  it("General page has opacity input", () => {
    settingsOpen.set(true);
    const { container } = render(SettingsOverlay);
    const input = container.querySelector("input[data-field='opacity']");
    expect(input).toBeTruthy();
    expect((input as HTMLInputElement).type).toBe("range");
  });

  it("General page has Apply button", () => {
    settingsOpen.set(true);
    const { container } = render(SettingsOverlay);
    const btn = container.querySelector("[data-action='apply-settings']");
    expect(btn).toBeTruthy();
    expect(btn!.textContent).toBe("Apply");
  });

  it("Apply button is disabled when no changes are made", () => {
    settingsOpen.set(true);
    const { container } = render(SettingsOverlay);
    const btn = container.querySelector(
      "[data-action='apply-settings']",
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});

describe("SettingsOverlay — Extensions page", () => {
  beforeEach(async () => {
    settingsOpen.set(false);
    await resetExtensions();
    cleanup();
  });

  it("shows empty state when no extensions are loaded", async () => {
    settingsOpen.set(true);
    const { container } = render(SettingsOverlay);
    const navButtons = container.querySelectorAll("nav button");
    const extBtn = Array.from(navButtons).find(
      (b) => b.textContent === "Extensions",
    )!;
    await fireEvent.click(extBtn);
    expect(screen.getByText("No extensions installed")).toBeTruthy();
  });

  it("lists registered extensions with name and description", async () => {
    const manifest: ExtensionManifest = {
      id: "test-ext",
      name: "Test Extension",
      version: "1.0.0",
      description: "A test extension",
      entry: "./dist/index.js",
    };
    registerExtension(manifest);

    settingsOpen.set(true);
    const { container } = render(SettingsOverlay);
    const navButtons = container.querySelectorAll("nav button");
    const extBtn = Array.from(navButtons).find(
      (b) => b.textContent === "Extensions",
    )!;
    await fireEvent.click(extBtn);

    expect(screen.getByText("Test Extension")).toBeTruthy();
    expect(screen.getByText("A test extension")).toBeTruthy();
  });

  it("shows install from path button", async () => {
    settingsOpen.set(true);
    const { container } = render(SettingsOverlay);
    const navButtons = container.querySelectorAll("nav button");
    await fireEvent.click(
      Array.from(navButtons).find((b) => b.textContent === "Extensions")!,
    );

    const installBtn = container.querySelector(
      "[data-action='install-from-path']",
    );
    expect(installBtn).toBeTruthy();
  });

  it("shows enable/disable toggle for each extension", async () => {
    registerExtension({
      id: "toggle-ext",
      name: "Toggle Extension",
      version: "1.0.0",
      entry: "./dist/index.js",
    });

    settingsOpen.set(true);
    const { container } = render(SettingsOverlay);
    const navButtons = container.querySelectorAll("nav button");
    await fireEvent.click(
      Array.from(navButtons).find((b) => b.textContent === "Extensions")!,
    );

    const toggle = container.querySelector("[data-ext-toggle='toggle-ext']");
    expect(toggle).toBeTruthy();
  });

  it("shows settings gear button for extensions with settings schema", async () => {
    await resetExtensions();
    registerExtension({
      id: "settings-ext",
      name: "Settings Extension",
      version: "1.0.0",
      entry: "./dist/index.js",
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

    settingsOpen.set(true);
    const { container } = render(SettingsOverlay);
    const navButtons = container.querySelectorAll("nav button");
    await fireEvent.click(
      Array.from(navButtons).find((b) => b.textContent === "Extensions")!,
    );

    const settingsBtn = container.querySelector(
      "[data-ext-settings='settings-ext']",
    );
    expect(settingsBtn).toBeTruthy();
  });

  it("navigates to extension settings page when gear button is clicked", async () => {
    await resetExtensions();
    registerExtension({
      id: "expand-ext",
      name: "Expandable Extension",
      version: "1.0.0",
      entry: "./dist/index.js",
      contributes: {
        settings: {
          fields: {
            showHidden: {
              type: "boolean",
              title: "Show Hidden Files",
              default: false,
            },
            maxDepth: {
              type: "number",
              title: "Max Depth",
              description: "Maximum folder depth to display",
              default: 5,
            },
          },
        },
      },
    });

    settingsOpen.set(true);
    const { container } = render(SettingsOverlay);
    const navButtons = container.querySelectorAll("nav button");
    await fireEvent.click(
      Array.from(navButtons).find((b) => b.textContent === "Extensions")!,
    );

    // Click the gear button
    const settingsBtn = container.querySelector(
      "[data-ext-settings='expand-ext']",
    ) as HTMLElement;
    await fireEvent.click(settingsBtn);

    // Settings fields should now be visible
    expect(screen.getByText("Show Hidden Files")).toBeTruthy();
    expect(screen.getByText("Max Depth")).toBeTruthy();
    expect(screen.getByText("Maximum folder depth to display")).toBeTruthy();
  });

  it("does not show settings button for extensions without settings", async () => {
    await resetExtensions();
    registerExtension({
      id: "no-settings-ext",
      name: "No Settings Extension",
      version: "1.0.0",
      entry: "./dist/index.js",
    });

    settingsOpen.set(true);
    const { container } = render(SettingsOverlay);
    const navButtons = container.querySelectorAll("nav button");
    await fireEvent.click(
      Array.from(navButtons).find((b) => b.textContent === "Extensions")!,
    );

    const settingsBtn = container.querySelector(
      "[data-ext-settings='no-settings-ext']",
    );
    expect(settingsBtn).toBeNull();
  });
});

// ===========================================================================
// Sub-component direct tests
// ===========================================================================

describe("SettingsGeneralTab (standalone)", () => {
  const noop = () => {};

  it("renders theme, font size, font family, and opacity controls", () => {
    const { container } = render(SettingsGeneralTab, {
      props: {
        currentTheme: "github-dark",
        fontSize: 14,
        fontFamily: "",
        opacity: 1.0,
        availableFonts: ["Menlo", "SF Mono"],
        fontLoadError: "",
        onThemeChange: noop,
        onFontSizeChange: noop,
        onFontFamilyChange: noop,
        onOpacityChange: noop,
      },
    });
    expect(container.querySelector("[data-field='theme']")).toBeTruthy();
    expect(container.querySelector("[data-field='fontSize']")).toBeTruthy();
    expect(container.querySelector("[data-field='fontFamily']")).toBeTruthy();
    expect(container.querySelector("[data-field='opacity']")).toBeTruthy();
  });

  it("renders available fonts in the font family dropdown", () => {
    const { container } = render(SettingsGeneralTab, {
      props: {
        currentTheme: "github-dark",
        fontSize: 14,
        fontFamily: "",
        opacity: 1.0,
        availableFonts: ["Menlo", "SF Mono"],
        fontLoadError: "",
        onThemeChange: noop,
        onFontSizeChange: noop,
        onFontFamilyChange: noop,
        onOpacityChange: noop,
      },
    });
    const select = container.querySelector(
      "[data-field='fontFamily']",
    ) as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.text);
    expect(options).toContain("Default (auto-detect)");
    expect(options).toContain("Menlo");
    expect(options).toContain("SF Mono");
  });

  it("shows font load error when present", () => {
    render(SettingsGeneralTab, {
      props: {
        currentTheme: "github-dark",
        fontSize: 14,
        fontFamily: "",
        opacity: 1.0,
        availableFonts: [],
        fontLoadError: "Failed to load font list",
        onThemeChange: noop,
        onFontSizeChange: noop,
        onFontFamilyChange: noop,
        onOpacityChange: noop,
      },
    });
    expect(screen.getByText("Failed to load font list")).toBeTruthy();
  });

  it("calls onThemeChange when theme is changed", async () => {
    const onThemeChange = vi.fn();
    const { container } = render(SettingsGeneralTab, {
      props: {
        currentTheme: "github-dark",
        fontSize: 14,
        fontFamily: "",
        opacity: 1.0,
        availableFonts: [],
        fontLoadError: "",
        onThemeChange,
        onFontSizeChange: noop,
        onFontFamilyChange: noop,
        onOpacityChange: noop,
      },
    });
    const select = container.querySelector(
      "[data-field='theme']",
    ) as HTMLSelectElement;
    select.value = "dracula";
    await fireEvent.change(select);
    expect(onThemeChange).toHaveBeenCalledWith("dracula");
  });

  it("calls onOpacityChange when opacity slider changes", async () => {
    const onOpacityChange = vi.fn();
    const { container } = render(SettingsGeneralTab, {
      props: {
        currentTheme: "github-dark",
        fontSize: 14,
        fontFamily: "",
        opacity: 1.0,
        availableFonts: [],
        fontLoadError: "",
        onThemeChange: noop,
        onFontSizeChange: noop,
        onFontFamilyChange: noop,
        onOpacityChange,
      },
    });
    const input = container.querySelector(
      "[data-field='opacity']",
    ) as HTMLInputElement;
    input.value = "0.8";
    await fireEvent.input(input);
    expect(onOpacityChange).toHaveBeenCalled();
  });

  it("renders data-page='general' attribute", () => {
    const { container } = render(SettingsGeneralTab, {
      props: {
        currentTheme: "github-dark",
        fontSize: 14,
        fontFamily: "",
        opacity: 1.0,
        availableFonts: [],
        fontLoadError: "",
        onThemeChange: noop,
        onFontSizeChange: noop,
        onFontFamilyChange: noop,
        onOpacityChange: noop,
      },
    });
    expect(container.querySelector("[data-page='general']")).toBeTruthy();
  });
});

describe("SettingsExtensionsTab (standalone)", () => {
  const noop = () => {};

  beforeEach(async () => {
    await resetExtensions();
    cleanup();
  });

  it("shows empty state when no extensions are loaded", () => {
    render(SettingsExtensionsTab, {
      props: {
        effectiveEnabled: {},
        installError: "",
        activePage: "extensions",
        onToggleExtension: noop,
        onInstallFromPath: noop,
        onUninstall: noop,
        onNavigateToExtSettings: noop,
      },
    });
    expect(screen.getByText("No extensions installed")).toBeTruthy();
  });

  it("renders install from path button", () => {
    const { container } = render(SettingsExtensionsTab, {
      props: {
        effectiveEnabled: {},
        installError: "",
        activePage: "extensions",
        onToggleExtension: noop,
        onInstallFromPath: noop,
        onUninstall: noop,
        onNavigateToExtSettings: noop,
      },
    });
    expect(
      container.querySelector("[data-action='install-from-path']"),
    ).toBeTruthy();
  });

  it("shows install error when present", () => {
    render(SettingsExtensionsTab, {
      props: {
        effectiveEnabled: {},
        installError: "Path not found",
        activePage: "extensions",
        onToggleExtension: noop,
        onInstallFromPath: noop,
        onUninstall: noop,
        onNavigateToExtSettings: noop,
      },
    });
    expect(screen.getByText("Path not found")).toBeTruthy();
  });

  it("renders extension list with toggle buttons", () => {
    registerExtension({
      id: "standalone-ext",
      name: "Standalone Extension",
      version: "2.0.0",
      entry: "./dist/index.js",
      description: "A standalone test",
    });
    const { container } = render(SettingsExtensionsTab, {
      props: {
        effectiveEnabled: { "standalone-ext": true },
        installError: "",
        activePage: "extensions",
        onToggleExtension: noop,
        onInstallFromPath: noop,
        onUninstall: noop,
        onNavigateToExtSettings: noop,
      },
    });
    expect(screen.getByText("Standalone Extension")).toBeTruthy();
    expect(screen.getByText("A standalone test")).toBeTruthy();
    expect(screen.getByText("v2.0.0")).toBeTruthy();
    expect(
      container.querySelector("[data-ext-toggle='standalone-ext']"),
    ).toBeTruthy();
  });

  it("calls onToggleExtension when toggle button is clicked", async () => {
    registerExtension({
      id: "toggle-test",
      name: "Toggle Test",
      version: "1.0.0",
      entry: "./dist/index.js",
    });
    const onToggleExtension = vi.fn();
    const { container } = render(SettingsExtensionsTab, {
      props: {
        effectiveEnabled: { "toggle-test": true },
        installError: "",
        activePage: "extensions",
        onToggleExtension,
        onInstallFromPath: noop,
        onUninstall: noop,
        onNavigateToExtSettings: noop,
      },
    });
    const toggle = container.querySelector(
      "[data-ext-toggle='toggle-test']",
    ) as HTMLElement;
    await fireEvent.click(toggle);
    expect(onToggleExtension).toHaveBeenCalledWith("toggle-test", false);
  });

  it("renders data-page='extensions' attribute", () => {
    const { container } = render(SettingsExtensionsTab, {
      props: {
        effectiveEnabled: {},
        installError: "",
        activePage: "extensions",
        onToggleExtension: noop,
        onInstallFromPath: noop,
        onUninstall: noop,
        onNavigateToExtSettings: noop,
      },
    });
    expect(container.querySelector("[data-page='extensions']")).toBeTruthy();
  });
});

describe("SettingsExtensionPage (standalone)", () => {
  const noop = () => {};

  it("renders extension name and description", () => {
    render(SettingsExtensionPage, {
      props: {
        extId: "my-ext",
        extName: "My Extension",
        extDescription: "Does something useful",
        fields: {},
        activePage: "ext:my-ext",
        getSettingValue: () => undefined,
        onSettingChange: noop,
      },
    });
    expect(screen.getByText("My Extension")).toBeTruthy();
    expect(screen.getByText("Does something useful")).toBeTruthy();
  });

  it("renders boolean field as checkbox", () => {
    const { container } = render(SettingsExtensionPage, {
      props: {
        extId: "my-ext",
        extName: "My Extension",
        extDescription: undefined,
        fields: {
          enabled: {
            type: "boolean",
            title: "Enable Feature",
            default: false,
          },
        },
        activePage: "ext:my-ext",
        getSettingValue: () => false,
        onSettingChange: noop,
      },
    });
    expect(screen.getByText("Enable Feature")).toBeTruthy();
    const checkbox = container.querySelector(
      "input[type='checkbox']",
    ) as HTMLInputElement;
    expect(checkbox).toBeTruthy();
  });

  it("renders number field as number input", () => {
    const { container } = render(SettingsExtensionPage, {
      props: {
        extId: "my-ext",
        extName: "My Extension",
        extDescription: undefined,
        fields: {
          maxItems: {
            type: "number",
            title: "Max Items",
            description: "Maximum number of items",
            default: 50,
          },
        },
        activePage: "ext:my-ext",
        getSettingValue: () => 50,
        onSettingChange: noop,
      },
    });
    expect(screen.getByText("Max Items")).toBeTruthy();
    expect(screen.getByText("Maximum number of items")).toBeTruthy();
    const input = container.querySelector(
      "input[type='number']",
    ) as HTMLInputElement;
    expect(input).toBeTruthy();
  });

  it("renders select field with options", () => {
    render(SettingsExtensionPage, {
      props: {
        extId: "my-ext",
        extName: "My Extension",
        extDescription: undefined,
        fields: {
          mode: {
            type: "select",
            title: "Mode",
            default: "auto",
            options: [
              { value: "auto", label: "Auto" },
              { value: "manual", label: "Manual" },
            ],
          },
        },
        activePage: "ext:my-ext",
        getSettingValue: () => "auto",
        onSettingChange: noop,
      },
    });
    expect(screen.getByText("Mode")).toBeTruthy();
    expect(screen.getByText("Auto")).toBeTruthy();
    expect(screen.getByText("Manual")).toBeTruthy();
  });

  it("renders string field as text input", () => {
    const { container } = render(SettingsExtensionPage, {
      props: {
        extId: "my-ext",
        extName: "My Extension",
        extDescription: undefined,
        fields: {
          apiKey: {
            type: "string",
            title: "API Key",
            default: "",
          },
        },
        activePage: "ext:my-ext",
        getSettingValue: () => "",
        onSettingChange: noop,
      },
    });
    expect(screen.getByText("API Key")).toBeTruthy();
    const input = container.querySelector(
      "input[type='text']",
    ) as HTMLInputElement;
    expect(input).toBeTruthy();
  });

  it("calls onSettingChange when a field value changes", async () => {
    const onSettingChange = vi.fn();
    const { container } = render(SettingsExtensionPage, {
      props: {
        extId: "my-ext",
        extName: "My Extension",
        extDescription: undefined,
        fields: {
          apiKey: {
            type: "string",
            title: "API Key",
            default: "",
          },
        },
        activePage: "ext:my-ext",
        getSettingValue: () => "",
        onSettingChange,
      },
    });
    const input = container.querySelector(
      "input[type='text']",
    ) as HTMLInputElement;
    input.value = "new-key";
    await fireEvent.change(input);
    expect(onSettingChange).toHaveBeenCalledWith("my-ext", "apiKey", "new-key");
  });

  it("renders correct data-page attribute", () => {
    const { container } = render(SettingsExtensionPage, {
      props: {
        extId: "my-ext",
        extName: "My Extension",
        extDescription: undefined,
        fields: {},
        activePage: "ext:my-ext",
        getSettingValue: () => undefined,
        onSettingChange: noop,
      },
    });
    expect(container.querySelector("[data-page='ext:my-ext']")).toBeTruthy();
  });
});

// ===========================================================================
// Dirty state tracking (integrated)
// ===========================================================================

describe("SettingsOverlay — dirty state tracking", () => {
  beforeEach(() => {
    settingsOpen.set(false);
    cleanup();
  });

  it("Apply button becomes enabled after changing a setting", async () => {
    settingsOpen.set(true);
    const { container } = render(SettingsOverlay);

    // Apply button starts disabled
    const applyBtn = container.querySelector(
      "[data-action='apply-settings']",
    ) as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(true);

    // Change a setting value
    const fontSizeInput = container.querySelector(
      "[data-field='fontSize']",
    ) as HTMLInputElement;
    fontSizeInput.value = "16";
    await fireEvent.change(fontSizeInput);

    // Apply button should now be enabled
    const updatedBtn = container.querySelector(
      "[data-action='apply-settings']",
    ) as HTMLButtonElement;
    expect(updatedBtn.disabled).toBe(false);
  });

  it("shows unsaved changes warning when closing with dirty state", async () => {
    settingsOpen.set(true);
    const { container } = render(SettingsOverlay);

    // Make a change to trigger dirty state
    const fontSizeInput = container.querySelector(
      "[data-field='fontSize']",
    ) as HTMLInputElement;
    fontSizeInput.value = "18";
    await fireEvent.change(fontSizeInput);

    // Try to close via backdrop click
    const backdrop = container.querySelector(
      ".settings-overlay",
    ) as HTMLElement;
    await fireEvent.click(backdrop);

    // Should show unsaved warning, NOT close
    expect(get(settingsOpen)).toBe(true);
    expect(screen.getByText("Unsaved Changes")).toBeTruthy();
  });
});

describe("SettingsOverlay — Extension settings pages", () => {
  beforeEach(async () => {
    settingsOpen.set(false);
    await resetExtensions();
    cleanup();
  });

  function registerExtWithSettings(
    id: string,
    name: string,
    fields: Record<string, { type: string; title: string; default?: unknown }>,
  ) {
    registerExtension({
      id,
      name,
      version: "1.0.0",
      entry: "./dist/index.js",
      contributes: {
        settings: { fields: fields as never },
      },
    });
  }

  it("shows nav entries for extensions with settings", async () => {
    registerExtWithSettings("nav-ext", "Nav Extension", {
      color: { type: "string", title: "Color", default: "blue" },
    });

    settingsOpen.set(true);
    const { container } = render(SettingsOverlay);
    const navButtons = container.querySelectorAll("nav button");
    const labels = Array.from(navButtons).map((b) => b.textContent?.trim());

    expect(labels).toContain("General");
    expect(labels).toContain("Extensions");
    expect(labels).toContain("Nav Extension");
  });

  it("does not show nav entry for extensions without settings", async () => {
    registerExtension({
      id: "plain-ext",
      name: "Plain Extension",
      version: "1.0.0",
      entry: "./dist/index.js",
    });

    settingsOpen.set(true);
    const { container } = render(SettingsOverlay);
    const navButtons = container.querySelectorAll("nav button");
    const labels = Array.from(navButtons).map((b) => b.textContent?.trim());

    expect(labels).not.toContain("Plain Extension");
  });

  it("clicking extension nav entry shows its settings fields", async () => {
    registerExtWithSettings("click-ext", "Clickable Extension", {
      apiKey: { type: "string", title: "API Key", default: "" },
      maxRetries: { type: "number", title: "Max Retries", default: 3 },
    });

    settingsOpen.set(true);
    const { container } = render(SettingsOverlay);
    const navButtons = container.querySelectorAll("nav button");
    const extNavBtn = Array.from(navButtons).find(
      (b) => b.textContent?.trim() === "Clickable Extension",
    )!;
    await fireEvent.click(extNavBtn);

    // Should show the extension settings page
    expect(container.querySelector("[data-page='ext:click-ext']")).toBeTruthy();
    expect(screen.getByText("API Key")).toBeTruthy();
    expect(screen.getByText("Max Retries")).toBeTruthy();
  });

  it("extension settings page hides General and Extensions content", async () => {
    registerExtWithSettings("hide-ext", "Hide Test Extension", {
      val: { type: "string", title: "Value" },
    });

    settingsOpen.set(true);
    const { container } = render(SettingsOverlay);
    const navButtons = container.querySelectorAll("nav button");
    const extNavBtn = Array.from(navButtons).find(
      (b) => b.textContent?.trim() === "Hide Test Extension",
    )!;
    await fireEvent.click(extNavBtn);

    expect(container.querySelector("[data-page='general']")).toBeNull();
    expect(container.querySelector("[data-page='extensions']")).toBeNull();
  });

  it("gear button on Extensions page navigates to extension settings page", async () => {
    registerExtWithSettings("gear-ext", "Gear Extension", {
      mode: { type: "string", title: "Mode", default: "auto" },
    });

    settingsOpen.set(true);
    const { container } = render(SettingsOverlay);

    // Navigate to Extensions page
    const navButtons = container.querySelectorAll("nav button");
    await fireEvent.click(
      Array.from(navButtons).find(
        (b) => b.textContent?.trim() === "Extensions",
      )!,
    );

    // Click the gear button
    const gearBtn = container.querySelector(
      "[data-ext-settings='gear-ext']",
    ) as HTMLElement;
    await fireEvent.click(gearBtn);

    // Should navigate to the extension's settings page
    expect(container.querySelector("[data-page='ext:gear-ext']")).toBeTruthy();
    expect(screen.getByText("Mode")).toBeTruthy();
  });
});
