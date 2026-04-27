<script lang="ts">
  import { onMount } from "svelte";
  import { theme } from "../stores/theme";
  import { getConfig, saveConfig } from "../config";
  import {
    extensionStore,
    activateExtension,
    deactivateExtension,
  } from "../services/extension-loader";
  import {
    installExtensionFromPath,
    uninstallExtension,
  } from "../services/extension-management";
  import { showInputPrompt } from "../stores/ui";
  import { invoke } from "@tauri-apps/api/core";
  import { getVersion } from "@tauri-apps/api/app";
  import { isDebugBuild } from "../services/service-helpers";
  import type { ExtensionSettingsField } from "../extension-types";

  let appVersion = "";
  let isDev = import.meta.env.DEV;

  import SettingsGeneralTab from "./SettingsGeneralTab.svelte";
  import SettingsExtensionsTab from "./SettingsExtensionsTab.svelte";
  import SettingsExtensionPage from "./SettingsExtensionPage.svelte";

  let installError = "";

  type SettingsPage = "general" | "extensions" | `ext:${string}`;
  let activePage: SettingsPage = "general";

  let currentTheme = "";
  let fontSize = 14;
  let fontFamily = "";
  let opacity = 1.0;
  let availableFonts: string[] = [];
  let fontLoadError = "";

  function loadSettings() {
    const cfg = getConfig();
    currentTheme = cfg.theme || "github-dark";
    fontSize = cfg.fontSize || 14;
    fontFamily = cfg.fontFamily || "";
    opacity = cfg.opacity ?? 1.0;
    fontLoadError = "";
    invoke<string[]>("list_monospace_fonts")
      .then((fonts) => {
        availableFonts = fonts;
      })
      .catch((err) => {
        availableFonts = [];
        fontLoadError = "Failed to load font list";
        console.warn("[settings] Font list load failed:", err);
      });
  }

  onMount(async () => {
    loadSettings();
    pendingExtToggle = {};
    pendingExtSettings = {};
    showUnsavedWarning = false;
    [appVersion, isDev] = await Promise.all([getVersion(), isDebugBuild()]);
  });

  let dirty = false;

  let pendingExtToggle: Record<string, boolean> = {};
  let pendingExtSettings: Record<string, Record<string, unknown>> = {};

  $: effectiveEnabled = (() => {
    const toggle = pendingExtToggle;
    const result: Record<string, boolean> = {};
    for (const ext of $extensionStore) {
      result[ext.manifest.id] =
        ext.manifest.id in toggle
          ? (toggle[ext.manifest.id] ?? false)
          : ext.enabled;
    }
    return result;
  })();

  function getExtSettingValue(
    extId: string,
    key: string,
    field: ExtensionSettingsField,
  ): unknown {
    if (pendingExtSettings[extId]?.[key] !== undefined) {
      return pendingExtSettings[extId][key];
    }
    const cfg = getConfig();
    const saved = cfg.extensions?.[extId]?.settings?.[key];
    if (saved !== undefined) return saved;
    return field.default;
  }

  function handleExtSettingChange(extId: string, key: string, value: unknown) {
    if (!pendingExtSettings[extId]) {
      pendingExtSettings[extId] = {};
    }
    pendingExtSettings[extId][key] = value;
    pendingExtSettings = pendingExtSettings;
    dirty = true;
  }

  function handleThemeChange(value: string) {
    currentTheme = value;
    dirty = true;
  }

  function handleFontSizeChange(value: number) {
    fontSize = value;
    dirty = true;
  }

  function handleFontFamilyChange(value: string) {
    fontFamily = value;
    dirty = true;
  }

  function handleOpacityChange(value: number) {
    opacity = value;
    dirty = true;
  }

  async function applySettings() {
    theme.set(currentTheme);
    void saveConfig({
      theme: currentTheme,
      fontSize,
      fontFamily,
      opacity,
    });

    const cfg = getConfig();
    const extensions = { ...cfg.extensions };
    for (const [extId, enabled] of Object.entries(pendingExtToggle)) {
      if (enabled) {
        await activateExtension(extId);
      } else {
        deactivateExtension(extId);
      }
      extensions[extId] = { ...extensions[extId], enabled };
    }
    for (const [extId, settings] of Object.entries(pendingExtSettings)) {
      if (!extensions[extId]) {
        extensions[extId] = { enabled: true };
      }
      extensions[extId] = {
        ...extensions[extId],
        settings: { ...extensions[extId].settings, ...settings },
      };
    }

    if (
      Object.keys(pendingExtToggle).length > 0 ||
      Object.keys(pendingExtSettings).length > 0
    ) {
      void saveConfig({ extensions });
    }
    pendingExtToggle = {};
    pendingExtSettings = {};
    dirty = false;
  }

  function toggleExtension(extId: string, enabled: boolean) {
    pendingExtToggle[extId] = enabled;
    pendingExtToggle = pendingExtToggle;
    dirty = true;
  }

  async function handleInstallFromPath() {
    installError = "";
    const path = await showInputPrompt("Path to extension directory");
    if (!path) return;
    const result = await installExtensionFromPath(path);
    if (!result.success) {
      installError = result.error || "Install failed";
    }
  }

  function handleUninstall(extId: string) {
    void uninstallExtension(extId);
  }

  function handleNavigateToExtSettings(extId: string) {
    activePage = `ext:${extId}`;
  }

  let showUnsavedWarning = false;

  function discardChanges() {
    showUnsavedWarning = false;
    dirty = false;
    pendingExtToggle = {};
    pendingExtSettings = {};
    loadSettings();
  }

  const corePages: Array<{ id: SettingsPage; label: string }> = [
    { id: "general", label: "General" },
    { id: "extensions", label: "Extensions" },
  ];

  $: extensionPages = $extensionStore
    .filter((ext) => ext.manifest.contributes?.settings)
    .map((ext) => ({
      id: `ext:${ext.manifest.id}` as SettingsPage,
      label: ext.manifest.name,
    }));

  function getActiveExtForPage(
    page: string,
    store: typeof $extensionStore,
  ): {
    id: string;
    ext: (typeof store)[0];
    settings: NonNullable<
      NonNullable<(typeof store)[0]["manifest"]["contributes"]>["settings"]
    >;
  } | null {
    if (!page.startsWith("ext:")) return null;
    const id = page.slice(4);
    const ext = store.find((e) => e.manifest.id === id);
    const settings = ext?.manifest?.contributes?.settings;
    if (!ext || !settings) return null;
    return { id, ext, settings };
  }
  $: activeExtPage = getActiveExtForPage(activePage, $extensionStore);
</script>

<div
  style="
    width: 100%; height: 100%;
    display: flex; overflow: hidden; position: relative;
    background: {$theme.bg};
  "
>
  <!-- Left nav -->
  <nav
    style="
      width: 160px; flex-shrink: 0;
      border-right: 1px solid {$theme.border};
      padding: 16px 0;
      display: flex; flex-direction: column; gap: 2px;
    "
  >
    <div
      style="
        padding: 0 16px 12px;
        font-size: 13px; font-weight: 600;
        color: {$theme.fg};
      "
    >
      Settings
    </div>

    {#each corePages as page}
      <button
        style="
          display: block; width: calc(100% - 16px); margin: 0 8px;
          padding: 6px 12px; border: none; border-radius: 6px;
          background: {activePage === page.id
          ? $theme.bgHighlight
          : 'transparent'};
          color: {activePage === page.id ? $theme.fg : $theme.fgDim};
          font-size: 12px; text-align: left; cursor: pointer;
        "
        on:click={() => (activePage = page.id)}>{page.label}</button
      >
    {/each}

    {#if extensionPages.length > 0}
      <div
        style="
          margin: 8px 16px 4px;
          border-top: 1px solid {$theme.border};
          padding-top: 8px;
          font-size: 10px; color: {$theme.fgDim};
          text-transform: uppercase; letter-spacing: 0.5px;
        "
      >
        Extensions
      </div>
      {#each extensionPages as page}
        <button
          style="
            display: block; width: calc(100% - 16px); margin: 0 8px;
            padding: 6px 12px; border: none; border-radius: 6px;
            background: {activePage === page.id
            ? $theme.bgHighlight
            : 'transparent'};
            color: {activePage === page.id ? $theme.fg : $theme.fgDim};
            font-size: 12px; text-align: left; cursor: pointer;
          "
          on:click={() => (activePage = page.id)}>{page.label}</button
        >
      {/each}
    {/if}
  </nav>

  <!-- Right column: content + footer -->
  <div
    style="flex: 1; display: flex; flex-direction: column; overflow: hidden;"
  >
    <!-- Content area -->
    <div style="flex: 1; overflow-y: auto; padding: 16px 20px;">
      {#if activePage === "general"}
        <SettingsGeneralTab
          {currentTheme}
          {fontSize}
          {fontFamily}
          {opacity}
          {availableFonts}
          {fontLoadError}
          onThemeChange={handleThemeChange}
          onFontSizeChange={handleFontSizeChange}
          onFontFamilyChange={handleFontFamilyChange}
          onOpacityChange={handleOpacityChange}
        />
      {:else if activePage === "extensions"}
        <SettingsExtensionsTab
          {effectiveEnabled}
          {installError}
          {activePage}
          onToggleExtension={toggleExtension}
          onInstallFromPath={handleInstallFromPath}
          onUninstall={handleUninstall}
          onNavigateToExtSettings={handleNavigateToExtSettings}
        />
      {/if}

      {#if activeExtPage}
        <SettingsExtensionPage
          extId={activeExtPage.id}
          extName={activeExtPage.ext.manifest.name}
          extDescription={activeExtPage.ext.manifest.description}
          fields={activeExtPage.settings.fields}
          {activePage}
          getSettingValue={getExtSettingValue}
          onSettingChange={handleExtSettingChange}
        />
      {/if}
    </div>

    <!-- Bottom bar with version info + Apply -->
    <div
      style="
        padding: 10px 20px; border-top: 1px solid {$theme.border};
        display: flex; justify-content: space-between; align-items: center; flex-shrink: 0;
      "
    >
      <div style="display: flex; align-items: center; gap: 8px;">
        {#if appVersion}
          <span style="font-size: 11px; color: {$theme.fgDim};">v{appVersion}</span>
          <span style="
            font-size: 10px; font-weight: 600; letter-spacing: 0.5px;
            padding: 2px 6px; border-radius: 4px;
            background: {isDev ? 'rgba(200,144,10,0.15)' : $theme.bgSurface};
            color: {isDev ? '#C8900A' : $theme.fgDim};
          ">{isDev ? "DEV" : "PROD"}</span>
        {/if}
      </div>
      <button
        data-action="apply-settings"
        disabled={!dirty}
        on:click={applySettings}
        style="
          padding: 6px 16px; border-radius: 6px; font-size: 12px;
          border: none; cursor: {dirty ? 'pointer' : 'default'};
          background: {dirty ? $theme.accent : $theme.bgSurface};
          color: {dirty ? '#fff' : $theme.fgDim};
          opacity: {dirty ? 1 : 0.5};
        ">Apply</button
      >
    </div>
  </div>

  <!-- Unsaved changes warning -->
  {#if showUnsavedWarning}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      on:click|stopPropagation={() => (showUnsavedWarning = false)}
      on:keydown|stopPropagation={(e) => {
        if (e.key === "Escape") showUnsavedWarning = false;
      }}
      role="alertdialog"
      aria-label="Unsaved changes"
      tabindex="-1"
      style="
        position: absolute; inset: 0; border-radius: 12px;
        background: rgba(0,0,0,0.5);
        display: flex; align-items: center; justify-content: center;
      "
    >
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div
        on:click|stopPropagation
        on:keydown|stopPropagation
        role="document"
        style="
          background: {$theme.bg};
          border: 1px solid {$theme.border};
          border-radius: 8px; padding: 16px 20px;
          box-shadow: 0 4px 16px rgba(0,0,0,0.4);
          max-width: 320px;
        "
      >
        <div
          style="font-size: 13px; font-weight: 600; color: {$theme.fg}; margin-bottom: 8px;"
        >
          Unsaved Changes
        </div>
        <div
          style="font-size: 12px; color: {$theme.fgDim}; margin-bottom: 16px;"
        >
          You have unapplied changes. Discard them?
        </div>
        <div style="display: flex; gap: 8px; justify-content: flex-end;">
          <button
            on:click={() => (showUnsavedWarning = false)}
            style="
              padding: 5px 12px; border-radius: 6px; font-size: 12px;
              border: 1px solid {$theme.border}; cursor: pointer;
              background: {$theme.bgSurface}; color: {$theme.fg};
            "
          >
            Go Back
          </button>
          <button
            on:click={discardChanges}
            style="
              padding: 5px 12px; border-radius: 6px; font-size: 12px;
              border: none; cursor: pointer;
              background: {$theme.danger}; color: #fff;
            "
          >
            Discard
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>
