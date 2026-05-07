<script lang="ts">
  import { inputStyle } from "../../utils/section-styles";

  export let settings: Record<string, unknown>;
  export let onChange: (key: string, value: unknown) => void;
  export let theme: { fg: string; fgDim: string; bg: string; border: string };

  $: envMap = (settings["env"] as Record<string, string> | undefined) ?? {};
  $: entries = Object.entries(envMap);

  let newKey = "";
  let newVal = "";

  function addEntry() {
    const k = newKey.trim();
    if (!k) return;
    onChange("env", { ...envMap, [k]: newVal });
    newKey = "";
    newVal = "";
  }

  function removeEntry(key: string) {
    const next = { ...envMap };
    delete next[key];
    onChange("env", next);
  }

  function updateValue(key: string, val: string) {
    onChange("env", { ...envMap, [key]: val });
  }

  $: getInputStyle = inputStyle(theme);
</script>

<div class="env-section">
  {#each entries as [key, val]}
    <div class="env-row">
      <code class="env-key" style="color: {theme.fg};">{key}</code>
      <input
        aria-label={`Value for ${key}`}
        value={val}
        style={getInputStyle("flex: 1;")}
        on:change={(e) => updateValue(key, e.currentTarget.value)}
      />
      <button
        class="remove-btn"
        style="color: {theme.fgDim};"
        on:click={() => removeEntry(key)}
        aria-label="Remove {key}">×</button
      >
    </div>
  {/each}

  <div class="add-row">
    <input
      aria-label="New environment variable key"
      bind:value={newKey}
      placeholder="KEY"
      style={getInputStyle("width: 140px;")}
      on:keydown={(e) => e.key === "Enter" && addEntry()}
    />
    <input
      aria-label="New environment variable value"
      bind:value={newVal}
      placeholder="value"
      style={getInputStyle("flex: 1;")}
      on:keydown={(e) => e.key === "Enter" && addEntry()}
    />
    <button
      class="add-btn"
      style="color: {theme.fg}; background: {theme.border}; border: none; border-radius: 4px; padding: 3px 10px; font-size: 12px; cursor: pointer;"
      on:click={addEntry}>Add</button
    >
  </div>
</div>

<style>
  .env-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .env-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .env-key {
    font-size: 11px;
    min-width: 140px;
    flex-shrink: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .remove-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 14px;
    padding: 0 2px;
    flex-shrink: 0;
  }
  .add-row {
    display: flex;
    gap: 6px;
    margin-top: 4px;
  }
  .add-btn {
    flex-shrink: 0;
  }
</style>
