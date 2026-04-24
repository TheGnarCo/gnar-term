<script lang="ts">
  export let settings: Record<string, unknown>;
  export let onChange: (key: string, value: unknown) => void;
  export let theme: {
    fg: string;
    fgDim: string;
    bg: string;
    border: string;
    accent: string;
  };

  type Permissions = {
    allow?: string[];
    deny?: string[];
    defaultMode?: string;
  };

  $: perms = (settings["permissions"] as Permissions | undefined) ?? {};
  $: allowList = perms.allow ?? [];
  $: denyList = perms.deny ?? [];
  $: defaultMode = perms.defaultMode ?? "default";

  let newAllow = "";
  let newDeny = "";

  const MODES = [
    "default",
    "acceptEdits",
    "plan",
    "auto",
    "dontAsk",
    "bypassPermissions",
  ];

  function updatePerms(patch: Partial<Permissions>) {
    onChange("permissions", { ...perms, ...patch });
  }

  function addAllow() {
    const v = newAllow.trim();
    if (!v) return;
    updatePerms({ allow: [...allowList, v] });
    newAllow = "";
  }

  function removeAllow(entry: string) {
    updatePerms({ allow: allowList.filter((e) => e !== entry) });
  }

  function addDeny() {
    const v = newDeny.trim();
    if (!v) return;
    updatePerms({ deny: [...denyList, v] });
    newDeny = "";
  }

  function removeDeny(entry: string) {
    updatePerms({ deny: denyList.filter((e) => e !== entry) });
  }

  const inputStyle = (extra = "") =>
    `background: ${theme.bg}; color: ${theme.fg}; border: 1px solid ${theme.border}; border-radius: 4px; padding: 3px 8px; font-size: 12px; font-family: monospace; ${extra}`;
</script>

<div class="perms-section">
  <div class="perm-row">
    <label
      for="perm-default-mode"
      style="color: {theme.fg}; font-size: 12px; font-weight: 500; min-width: 120px;"
    >
      Default mode
    </label>
    <select
      id="perm-default-mode"
      value={defaultMode}
      style={inputStyle()}
      on:change={(e) => updatePerms({ defaultMode: e.currentTarget.value })}
    >
      {#each MODES as m}
        <option value={m}>{m}</option>
      {/each}
    </select>
  </div>

  <div class="list-block">
    <div class="list-label" style="color: {theme.fg};">Allow list</div>
    <div class="entries">
      {#each allowList as entry}
        <div class="entry">
          <code style="color: {theme.fg}; font-size: 11px;">{entry}</code>
          <button
            class="remove-btn"
            style="color: {theme.fgDim};"
            on:click={() => removeAllow(entry)}
            aria-label="Remove {entry}">×</button
          >
        </div>
      {/each}
    </div>
    <div class="add-row">
      <input
        bind:value={newAllow}
        placeholder="Bash(npm *) or Read(~/src/**)"
        style={inputStyle("flex: 1;")}
        on:keydown={(e) => e.key === "Enter" && addAllow()}
      />
      <button
        class="add-btn"
        style="background: {theme.accent ??
          theme.border}; color: {theme.fg}; border: none; border-radius: 4px; padding: 3px 10px; font-size: 12px; cursor: pointer;"
        on:click={addAllow}>Add</button
      >
    </div>
  </div>

  <div class="list-block">
    <div class="list-label" style="color: {theme.fg};">Deny list</div>
    <div class="entries">
      {#each denyList as entry}
        <div class="entry">
          <code style="color: {theme.fg}; font-size: 11px;">{entry}</code>
          <button
            class="remove-btn"
            style="color: {theme.fgDim};"
            on:click={() => removeDeny(entry)}
            aria-label="Remove {entry}">×</button
          >
        </div>
      {/each}
    </div>
    <div class="add-row">
      <input
        bind:value={newDeny}
        placeholder="Bash(curl *) or Read(./.env)"
        style={inputStyle("flex: 1;")}
        on:keydown={(e) => e.key === "Enter" && addDeny()}
      />
      <button
        class="add-btn"
        style="background: {theme.accent ??
          theme.border}; color: {theme.fg}; border: none; border-radius: 4px; padding: 3px 10px; font-size: 12px; cursor: pointer;"
        on:click={addDeny}>Add</button
      >
    </div>
  </div>
</div>

<style>
  .perms-section {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .perm-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .list-block {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .list-label {
    font-size: 12px;
    font-weight: 500;
    margin-bottom: 2px;
  }
  .entries {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .entry {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 3px 8px;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.04);
  }
  .remove-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 14px;
    padding: 0 2px;
    line-height: 1;
  }
  .add-row {
    display: flex;
    gap: 6px;
  }
</style>
