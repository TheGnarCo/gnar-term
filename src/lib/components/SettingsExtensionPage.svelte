<script lang="ts">
  import { theme } from "../stores/theme";
  import type { ExtensionSettingsField } from "../extension-types";

  export let extId: string;
  export let extName: string;
  export let extDescription: string | undefined;
  export let fields: Record<string, ExtensionSettingsField>;
  export let activePage: string;

  export let getSettingValue: (
    extId: string,
    key: string,
    field: ExtensionSettingsField,
  ) => unknown;
  export let onSettingChange: (
    extId: string,
    key: string,
    value: unknown,
  ) => void;
</script>

<div data-page={activePage}>
  <h3 style="margin: 0 0 4px; font-size: 14px; color: {$theme.fg};">
    {extName}
  </h3>
  {#if extDescription}
    <div style="font-size: 11px; color: {$theme.fgDim}; margin-bottom: 16px;">
      {extDescription}
    </div>
  {:else}
    <div style="margin-bottom: 16px;"></div>
  {/if}

  <div style="display: flex; flex-direction: column; gap: 14px;">
    {#each Object.entries(fields) as [key, field]}
      <label style="display: flex; flex-direction: column; gap: 3px;">
        <span style="font-size: 11px; color: {$theme.fg}; font-weight: 500;"
          >{field.title}</span
        >
        {#if field.description}
          <span style="font-size: 10px; color: {$theme.fgDim};"
            >{field.description}</span
          >
        {/if}

        {#if field.type === "boolean"}
          <input
            type="checkbox"
            checked={!!getSettingValue(extId, key, field)}
            on:change={(e) =>
              onSettingChange(extId, key, e.currentTarget.checked)}
            style="width: 16px; height: 16px;"
          />
        {:else if field.type === "select" && field.options}
          <select
            value={getSettingValue(extId, key, field) ?? ""}
            on:change={(e) =>
              onSettingChange(extId, key, e.currentTarget.value)}
            style="
                padding: 6px 8px; border-radius: 6px;
                background: {$theme.bg}; color: {$theme.fg};
                border: 1px solid {$theme.border}; font-size: 12px;
              "
          >
            {#each field.options as opt}
              <option value={opt.value}>{opt.label}</option>
            {/each}
          </select>
        {:else if field.type === "number"}
          <input
            type="number"
            value={getSettingValue(extId, key, field) ?? ""}
            on:change={(e) =>
              onSettingChange(extId, key, parseFloat(e.currentTarget.value))}
            style="
                padding: 6px 8px; border-radius: 6px; width: 100px;
                background: {$theme.bg}; color: {$theme.fg};
                border: 1px solid {$theme.border}; font-size: 12px;
              "
          />
        {:else}
          <input
            type="text"
            value={getSettingValue(extId, key, field) ?? ""}
            on:change={(e) =>
              onSettingChange(extId, key, e.currentTarget.value)}
            style="
                padding: 6px 8px; border-radius: 6px; width: 240px;
                background: {$theme.bg}; color: {$theme.fg};
                border: 1px solid {$theme.border}; font-size: 12px;
              "
          />
        {/if}
      </label>
    {/each}
  </div>
</div>
