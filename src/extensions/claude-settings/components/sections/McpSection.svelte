<script lang="ts">
  export let settings: Record<string, unknown>;
  export let onChange: (key: string, value: unknown) => void;
  export let theme: { fg: string; fgDim: string; bg: string; border: string };

  $: enableAll = Boolean(settings["enableAllProjectMcpServers"]);
  $: enabledList =
    (settings["enabledMcpjsonServers"] as string[] | undefined) ?? [];
  $: disabledList =
    (settings["disabledMcpjsonServers"] as string[] | undefined) ?? [];

  let newEnabled = "";
  let newDisabled = "";

  function addEnabled() {
    const v = newEnabled.trim();
    if (!v) return;
    onChange("enabledMcpjsonServers", [...enabledList, v]);
    newEnabled = "";
  }

  function removeEnabled(name: string) {
    onChange(
      "enabledMcpjsonServers",
      enabledList.filter((n) => n !== name),
    );
  }

  function addDisabled() {
    const v = newDisabled.trim();
    if (!v) return;
    onChange("disabledMcpjsonServers", [...disabledList, v]);
    newDisabled = "";
  }

  function removeDisabled(name: string) {
    onChange(
      "disabledMcpjsonServers",
      disabledList.filter((n) => n !== name),
    );
  }

  const inputStyle = (extra = "") =>
    `background: ${theme.bg}; color: ${theme.fg}; border: 1px solid ${theme.border}; border-radius: 4px; padding: 3px 8px; font-size: 12px; font-family: monospace; ${extra}`;
</script>

<div class="mcp-section">
  <label class="toggle-row" style="color: {theme.fg};">
    <input
      type="checkbox"
      checked={enableAll}
      on:change={(e) =>
        onChange("enableAllProjectMcpServers", e.currentTarget.checked)}
    />
    <span style="font-size: 12px;">Enable all project MCP servers</span>
  </label>

  <div class="list-block">
    <div class="list-label" style="color: {theme.fg};">Enabled servers</div>
    {#each enabledList as name}
      <div class="entry">
        <code style="font-size: 12px; color: {theme.fg};">{name}</code>
        <button
          class="remove-btn"
          style="color: {theme.fgDim};"
          on:click={() => removeEnabled(name)}>×</button
        >
      </div>
    {/each}
    <div class="add-row">
      <input
        bind:value={newEnabled}
        placeholder="server-name"
        style={inputStyle("flex: 1;")}
        on:keydown={(e) => e.key === "Enter" && addEnabled()}
      />
      <button
        style="background: {theme.border}; color: {theme.fg}; border: none; border-radius: 4px; padding: 3px 8px; font-size: 12px; cursor: pointer;"
        on:click={addEnabled}>Add</button
      >
    </div>
  </div>

  <div class="list-block">
    <div class="list-label" style="color: {theme.fg};">Disabled servers</div>
    {#each disabledList as name}
      <div class="entry">
        <code style="font-size: 12px; color: {theme.fg};">{name}</code>
        <button
          class="remove-btn"
          style="color: {theme.fgDim};"
          on:click={() => removeDisabled(name)}>×</button
        >
      </div>
    {/each}
    <div class="add-row">
      <input
        bind:value={newDisabled}
        placeholder="server-name"
        style={inputStyle("flex: 1;")}
        on:keydown={(e) => e.key === "Enter" && addDisabled()}
      />
      <button
        style="background: {theme.border}; color: {theme.fg}; border: none; border-radius: 4px; padding: 3px 8px; font-size: 12px; cursor: pointer;"
        on:click={addDisabled}>Add</button
      >
    </div>
  </div>
</div>

<style>
  .mcp-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .toggle-row {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }
  .list-block {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .list-label {
    font-size: 12px;
    font-weight: 500;
  }
  .entry {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 2px 6px;
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
  }
</style>
