<script lang="ts">
  import { theme } from "../stores/theme";
  import { extensionStore } from "../services/extension-loader";

  export let effectiveEnabled: Record<string, boolean>;
  export let installError: string;
  export let activePage: string;

  export let onToggleExtension: (extId: string, enabled: boolean) => void;
  export let onInstallFromPath: () => void;
  export let onUninstall: (extId: string) => void;
  export let onNavigateToExtSettings: (extId: string) => void;
</script>

<div data-page="extensions">
  <h3 style="margin: 0 0 16px; font-size: 14px; color: {$theme.fg};">
    Extensions
  </h3>

  <div style="display: flex; gap: 8px; margin-bottom: 12px;">
    <button
      data-action="install-from-path"
      on:click={onInstallFromPath}
      style="
      padding: 6px 12px; border-radius: 6px; font-size: 11px;
      border: 1px solid {$theme.border}; cursor: pointer;
      background: {$theme.bgSurface}; color: {$theme.fg};
    ">Install from path...</button
    >
  </div>

  {#if installError}
    <div
      style="
    padding: 8px 12px; border-radius: 6px; margin-bottom: 12px;
    background: rgba(255,0,0,0.1); border: 1px solid {$theme.danger};
    color: {$theme.danger}; font-size: 11px;
  "
    >
      {installError}
    </div>
  {/if}

  {#if $extensionStore.length === 0}
    <p style="font-size: 12px; color: {$theme.fgDim};">
      No extensions installed
    </p>
  {:else}
    <div style="display: flex; flex-direction: column; gap: 8px;">
      {#each $extensionStore as ext}
        <div
          style="
        display: flex; align-items: center; gap: 12px;
        padding: 10px 12px; border-radius: 8px;
        background: {$theme.bgSurface};
        border: 1px solid {$theme.border};
      "
        >
          <div style="flex: 1; min-width: 0;">
            <div style="font-size: 12px; font-weight: 500; color: {$theme.fg};">
              {ext.manifest.name}
            </div>
            {#if ext.manifest.description}
              <div
                style="font-size: 11px; color: {$theme.fgDim}; margin-top: 2px;"
              >
                {ext.manifest.description}
              </div>
            {/if}
            <div
              style="font-size: 10px; color: {$theme.fgDim}; margin-top: 2px;"
            >
              v{ext.manifest.version}
            </div>
          </div>

          <div style="display: flex; gap: 4px; align-items: center;">
            <button
              data-ext-toggle={ext.manifest.id}
              on:click={() =>
                onToggleExtension(
                  ext.manifest.id,
                  !effectiveEnabled[ext.manifest.id],
                )}
              style="
              padding: 4px 10px; border-radius: 4px; font-size: 11px;
              border: 1px solid {$theme.border}; cursor: pointer;
              background: {effectiveEnabled[ext.manifest.id]
                ? $theme.accent
                : $theme.bgSurface};
              color: {effectiveEnabled[ext.manifest.id]
                ? '#fff'
                : $theme.fgDim};
            "
              >{effectiveEnabled[ext.manifest.id]
                ? "Enabled"
                : "Disabled"}</button
            >

            {#if ext.manifest.contributes?.settings}
              <button
                data-ext-settings={ext.manifest.id}
                on:click={() => onNavigateToExtSettings(ext.manifest.id)}
                style="
                padding: 4px 8px; border-radius: 4px; font-size: 11px;
                border: 1px solid {$theme.border}; cursor: pointer;
                background: {activePage === `ext:${ext.manifest.id}`
                  ? $theme.bgHighlight
                  : $theme.bgSurface};
                color: {$theme.fgDim};
              "
                title="Extension settings"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <circle cx="12" cy="12" r="3" />
                  <path
                    d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"
                  />
                </svg>
              </button>
            {/if}

            {#if !ext.manifest.included}
              <button
                data-ext-uninstall={ext.manifest.id}
                on:click={() => onUninstall(ext.manifest.id)}
                style="
                padding: 4px 8px; border-radius: 4px; font-size: 11px;
                border: 1px solid {$theme.danger}; cursor: pointer;
                background: none; color: {$theme.danger};
              ">Remove</button
              >
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
