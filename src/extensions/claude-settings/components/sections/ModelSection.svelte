<script lang="ts">
  import type { SchemaSection } from "../../lib/settings-schema";

  export let section: SchemaSection;
  export let settings: Record<string, unknown>;
  export let onChange: (key: string, value: unknown) => void;
  export let theme: { fg: string; fgDim: string; bg: string; border: string };

  function get(key: string): unknown {
    return settings[key] ?? section.fields.find((f) => f.key === key)?.default;
  }
</script>

<div class="section-fields">
  {#each section.fields as field}
    <div class="field-row">
      <div class="field-label" style="color: {theme.fg};">{field.label}</div>
      <div class="field-desc" style="color: {theme.fgDim};">
        {field.description}
      </div>
      <div class="field-control">
        {#if field.type === "enum" && field.options}
          <select
            value={String(get(field.key) ?? "")}
            style="background: {theme.bg}; color: {theme.fg}; border: 1px solid {theme.border}; border-radius: 4px; padding: 2px 6px; font-size: 12px;"
            on:change={(e) => onChange(field.key, e.currentTarget.value)}
          >
            {#each field.options as opt}
              <option value={opt}>{opt}</option>
            {/each}
          </select>
        {:else if field.type === "boolean"}
          <input
            type="checkbox"
            checked={Boolean(get(field.key))}
            on:change={(e) => onChange(field.key, e.currentTarget.checked)}
          />
        {:else}
          <input
            type="text"
            value={String(get(field.key) ?? "")}
            style="background: {theme.bg}; color: {theme.fg}; border: 1px solid {theme.border}; border-radius: 4px; padding: 2px 6px; font-size: 12px; width: 180px;"
            on:change={(e) => onChange(field.key, e.currentTarget.value)}
          />
        {/if}
      </div>
    </div>
  {/each}
</div>

<style>
  .section-fields {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .field-row {
    display: grid;
    grid-template-columns: 160px 1fr auto;
    align-items: center;
    gap: 8px;
  }
  .field-label {
    font-size: 12px;
    font-weight: 500;
  }
  .field-desc {
    font-size: 11px;
    line-height: 1.4;
  }
  .field-control {
    flex-shrink: 0;
  }
</style>
