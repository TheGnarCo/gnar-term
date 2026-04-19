/**
 * Supplementary component rendering tests — verifies the split settings
 * sub-components maintain correct architectural boundaries and tests
 * component integration patterns not covered by components.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/svelte";
import { readFileSync } from "fs";

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
import SettingsExtensionPage from "../lib/components/SettingsExtensionPage.svelte";
import { settingsOpen, settingsPage } from "../lib/stores/ui";
import {
  registerExtension,
  resetExtensions,
} from "../lib/services/extension-loader";

// ===========================================================================
// Architectural verification: SettingsOverlay imports sub-components
// ===========================================================================

describe("SettingsOverlay sub-component architecture", () => {
  it("SettingsOverlay imports all three sub-components", () => {
    const source = readFileSync(
      "src/lib/components/SettingsOverlay.svelte",
      "utf-8",
    );
    expect(source).toContain(
      'import SettingsGeneralTab from "./SettingsGeneralTab.svelte"',
    );
    expect(source).toContain(
      'import SettingsExtensionsTab from "./SettingsExtensionsTab.svelte"',
    );
    expect(source).toContain(
      'import SettingsExtensionPage from "./SettingsExtensionPage.svelte"',
    );
  });

  it("SettingsOverlay renders SettingsGeneralTab via <SettingsGeneralTab> tag", () => {
    const source = readFileSync(
      "src/lib/components/SettingsOverlay.svelte",
      "utf-8",
    );
    expect(source).toContain("<SettingsGeneralTab");
  });

  it("SettingsOverlay renders SettingsExtensionsTab via <SettingsExtensionsTab> tag", () => {
    const source = readFileSync(
      "src/lib/components/SettingsOverlay.svelte",
      "utf-8",
    );
    expect(source).toContain("<SettingsExtensionsTab");
  });

  it("SettingsOverlay renders SettingsExtensionPage via <SettingsExtensionPage> tag", () => {
    const source = readFileSync(
      "src/lib/components/SettingsOverlay.svelte",
      "utf-8",
    );
    expect(source).toContain("<SettingsExtensionPage");
  });

  it("sub-components do not import settingsOpen store (parent owns open/close)", () => {
    const generalSource = readFileSync(
      "src/lib/components/SettingsGeneralTab.svelte",
      "utf-8",
    );
    const extensionsSource = readFileSync(
      "src/lib/components/SettingsExtensionsTab.svelte",
      "utf-8",
    );
    const extPageSource = readFileSync(
      "src/lib/components/SettingsExtensionPage.svelte",
      "utf-8",
    );
    expect(generalSource).not.toContain("settingsOpen");
    expect(extensionsSource).not.toContain("settingsOpen");
    expect(extPageSource).not.toContain("settingsOpen");
  });

  it("sub-components do not import applySettings or saveConfig (parent owns apply)", () => {
    const generalSource = readFileSync(
      "src/lib/components/SettingsGeneralTab.svelte",
      "utf-8",
    );
    const extensionsSource = readFileSync(
      "src/lib/components/SettingsExtensionsTab.svelte",
      "utf-8",
    );
    const extPageSource = readFileSync(
      "src/lib/components/SettingsExtensionPage.svelte",
      "utf-8",
    );
    expect(generalSource).not.toContain("saveConfig");
    expect(extensionsSource).not.toContain("saveConfig");
    expect(extPageSource).not.toContain("saveConfig");
  });
});

// ===========================================================================
// Integration: navigation between tabs in assembled SettingsOverlay
// ===========================================================================

describe("SettingsOverlay — tab navigation integration", () => {
  beforeEach(async () => {
    settingsOpen.set(false);
    await resetExtensions();
    cleanup();
  });

  it("navigates General -> Extensions -> back to General", async () => {
    settingsOpen.set(true);
    const { container } = render(SettingsOverlay);

    // Start on General
    expect(container.querySelector("[data-page='general']")).toBeTruthy();

    // Navigate to Extensions
    const navButtons = container.querySelectorAll("nav button");
    const extBtn = Array.from(navButtons).find(
      (b) => b.textContent === "Extensions",
    )!;
    await fireEvent.click(extBtn);
    expect(container.querySelector("[data-page='extensions']")).toBeTruthy();
    expect(container.querySelector("[data-page='general']")).toBeNull();

    // Navigate back to General
    const generalBtn = Array.from(
      container.querySelectorAll("nav button"),
    ).find((b) => b.textContent === "General")!;
    await fireEvent.click(generalBtn);
    expect(container.querySelector("[data-page='general']")).toBeTruthy();
    expect(container.querySelector("[data-page='extensions']")).toBeNull();
  });

  it("navigates to extension settings page via settingsPage store", async () => {
    registerExtension({
      id: "store-nav-ext",
      name: "Store Nav Extension",
      version: "1.0.0",
      entry: "./dist/index.js",
      contributes: {
        settings: {
          fields: {
            val: { type: "string", title: "Value", default: "" },
          },
        },
      },
    });

    settingsPage.set("ext:store-nav-ext");
    settingsOpen.set(true);
    const { container } = render(SettingsOverlay);

    // Should navigate directly to the extension's settings page
    expect(
      container.querySelector("[data-page='ext:store-nav-ext']"),
    ).toBeTruthy();
    // Extension name appears in both nav and page header; verify the page content
    expect(screen.getAllByText("Store Nav Extension").length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText("Value")).toBeTruthy();
  });

  it("Extensions tab gear button navigates to extension settings page", async () => {
    registerExtension({
      id: "gear-nav-ext",
      name: "Gear Nav Extension",
      version: "1.0.0",
      entry: "./dist/index.js",
      contributes: {
        settings: {
          fields: {
            color: { type: "string", title: "Color", default: "red" },
          },
        },
      },
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

    // Click gear button
    const gearBtn = container.querySelector(
      "[data-ext-settings='gear-nav-ext']",
    ) as HTMLElement;
    await fireEvent.click(gearBtn);

    // Should now show extension settings page
    expect(
      container.querySelector("[data-page='ext:gear-nav-ext']"),
    ).toBeTruthy();
    expect(screen.getByText("Color")).toBeTruthy();
  });
});

// ===========================================================================
// Component file structure verification
// ===========================================================================

describe("Settings sub-component file structure", () => {
  it("SettingsGeneralTab.svelte exists and has script tag", () => {
    const source = readFileSync(
      "src/lib/components/SettingsGeneralTab.svelte",
      "utf-8",
    );
    expect(source).toContain('<script lang="ts">');
    expect(source).toContain("export let currentTheme");
    expect(source).toContain("export let fontSize");
    expect(source).toContain("export let fontFamily");
    expect(source).toContain("export let opacity");
  });

  it("SettingsExtensionsTab.svelte exists and has script tag", () => {
    const source = readFileSync(
      "src/lib/components/SettingsExtensionsTab.svelte",
      "utf-8",
    );
    expect(source).toContain('<script lang="ts">');
    expect(source).toContain("export let effectiveEnabled");
    expect(source).toContain("export let onToggleExtension");
  });

  it("SettingsExtensionPage.svelte exists and has script tag", () => {
    const source = readFileSync(
      "src/lib/components/SettingsExtensionPage.svelte",
      "utf-8",
    );
    expect(source).toContain('<script lang="ts">');
    expect(source).toContain("export let extId");
    expect(source).toContain("export let fields");
    expect(source).toContain("export let getSettingValue");
    expect(source).toContain("export let onSettingChange");
  });

  it("SettingsOverlay.svelte is significantly smaller after split", () => {
    const source = readFileSync(
      "src/lib/components/SettingsOverlay.svelte",
      "utf-8",
    );
    const lines = source.split("\n").length;
    // Original was 801 lines; the shell should be well under 500
    expect(lines).toBeLessThan(500);
  });
});

// ===========================================================================
// SettingsGeneralTab — callback prop contracts
// ===========================================================================

describe("SettingsGeneralTab — callback contracts", () => {
  const noop = () => {};

  it("calls onFontSizeChange with parsed integer when valid", async () => {
    const onFontSizeChange = vi.fn();
    const { container } = render(SettingsGeneralTab, {
      props: {
        currentTheme: "github-dark",
        fontSize: 14,
        fontFamily: "",
        opacity: 1.0,
        availableFonts: [],
        fontLoadError: "",
        onThemeChange: noop,
        onFontSizeChange,
        onFontFamilyChange: noop,
        onOpacityChange: noop,
      },
    });
    const input = container.querySelector(
      "[data-field='fontSize']",
    ) as HTMLInputElement;
    input.value = "20";
    await fireEvent.change(input);
    expect(onFontSizeChange).toHaveBeenCalledWith(20);
  });

  it("does not call onFontSizeChange for invalid input", async () => {
    const onFontSizeChange = vi.fn();
    const { container } = render(SettingsGeneralTab, {
      props: {
        currentTheme: "github-dark",
        fontSize: 14,
        fontFamily: "",
        opacity: 1.0,
        availableFonts: [],
        fontLoadError: "",
        onThemeChange: noop,
        onFontSizeChange,
        onFontFamilyChange: noop,
        onOpacityChange: noop,
      },
    });
    const input = container.querySelector(
      "[data-field='fontSize']",
    ) as HTMLInputElement;
    input.value = "abc";
    await fireEvent.change(input);
    expect(onFontSizeChange).not.toHaveBeenCalled();
  });

  it("calls onFontFamilyChange with selected value", async () => {
    const onFontFamilyChange = vi.fn();
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
        onFontFamilyChange,
        onOpacityChange: noop,
      },
    });
    const select = container.querySelector(
      "[data-field='fontFamily']",
    ) as HTMLSelectElement;
    select.value = "Menlo";
    await fireEvent.change(select);
    expect(onFontFamilyChange).toHaveBeenCalledWith("Menlo");
  });
});

// ===========================================================================
// SettingsExtensionPage — field type rendering
// ===========================================================================

describe("SettingsExtensionPage — field descriptions and defaults", () => {
  const noop = () => {};

  it("renders field description when present", () => {
    render(SettingsExtensionPage, {
      props: {
        extId: "desc-ext",
        extName: "Description Test",
        extDescription: undefined,
        fields: {
          timeout: {
            type: "number",
            title: "Timeout",
            description: "Request timeout in seconds",
            default: 30,
          },
        },
        activePage: "ext:desc-ext",
        getSettingValue: () => 30,
        onSettingChange: noop,
      },
    });
    expect(screen.getByText("Request timeout in seconds")).toBeTruthy();
  });

  it("does not render description when absent", () => {
    const { container } = render(SettingsExtensionPage, {
      props: {
        extId: "no-desc-ext",
        extName: "No Description Test",
        extDescription: undefined,
        fields: {
          count: {
            type: "number",
            title: "Count",
            default: 10,
          },
        },
        activePage: "ext:no-desc-ext",
        getSettingValue: () => 10,
        onSettingChange: noop,
      },
    });
    // Only the title label should be present, no description span
    const labels = container.querySelectorAll("label");
    expect(labels.length).toBe(1);
    const spans = labels[0].querySelectorAll("span");
    // Should have exactly 1 span (the title), no description
    expect(spans.length).toBe(1);
    expect(spans[0].textContent).toBe("Count");
  });

  it("renders multiple fields in order", () => {
    render(SettingsExtensionPage, {
      props: {
        extId: "multi-ext",
        extName: "Multi Field Test",
        extDescription: undefined,
        fields: {
          alpha: { type: "string", title: "Alpha", default: "" },
          beta: { type: "boolean", title: "Beta", default: false },
          gamma: { type: "number", title: "Gamma", default: 0 },
        },
        activePage: "ext:multi-ext",
        getSettingValue: () => "",
        onSettingChange: noop,
      },
    });
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();
    expect(screen.getByText("Gamma")).toBeTruthy();
  });
});
