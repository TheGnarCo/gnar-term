<script lang="ts">
  export let settings: Record<string, unknown>;
  export let onChange: (key: string, value: unknown) => void;
  export let theme: { fg: string; fgDim: string; bg: string; border: string };

  $: enabledPlugins =
    (settings["enabledPlugins"] as Record<string, boolean> | undefined) ?? {};
  $: pluginEntries = Object.entries(enabledPlugins);

  let newPlugin = "";

  function togglePlugin(key: string, enabled: boolean) {
    onChange("enabledPlugins", { ...enabledPlugins, [key]: enabled });
  }

  function addPlugin() {
    const k = newPlugin.trim();
    if (!k) return;
    onChange("enabledPlugins", { ...enabledPlugins, [k]: true });
    newPlugin = "";
  }

  function removePlugin(key: string) {
    const next = { ...enabledPlugins };
    delete next[key];
    onChange("enabledPlugins", next);
  }
</script>

<div class="plugins-section">
  {#if pluginEntries.length === 0}
    <p style="color: {theme.fgDim}; font-size: 12px; margin: 0;">
      No plugins configured. Add a plugin below.
    </p>
  {/if}

  {#each pluginEntries as [key, enabled]}
    <div class="plugin-row">
      <input
        type="checkbox"
        checked={enabled}
        on:change={(e) => togglePlugin(key, e.currentTarget.checked)}
      />
      <code style="font-size: 12px; color: {theme.fg}; flex: 1;">{key}</code>
      <button
        class="remove-btn"
        style="color: {theme.fgDim};"
        on:click={() => removePlugin(key)}
        aria-label="Remove {key}">×</button
      >
    </div>
  {/each}

  <div class="add-row">
    <input
      bind:value={newPlugin}
      placeholder="plugin-name@marketplace"
      style="background: {theme.bg}; color: {theme.fg}; border: 1px solid {theme.border}; border-radius: 4px; padding: 3px 8px; font-size: 12px; font-family: monospace; flex: 1;"
      on:keydown={(e) => e.key === "Enter" && addPlugin()}
    />
    <button
      style="background: {theme.border}; color: {theme.fg}; border: none; border-radius: 4px; padding: 3px 10px; font-size: 12px; cursor: pointer;"
      on:click={addPlugin}>Add</button
    >
  </div>
</div>

<style>
  .plugins-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .plugin-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .remove-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 14px;
    padding: 0 2px;
  }
  .add-row {
    display: flex;
    gap: 6px;
    margin-top: 4px;
  }
</style>
