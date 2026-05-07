<script lang="ts">
  import { inputStyle } from "../../utils/section-styles";

  export let settings: Record<string, unknown>;
  export let onChange: (key: string, value: unknown) => void;
  export let theme: { fg: string; fgDim: string; bg: string; border: string };

  type Filesystem = { allowWrite?: string[] };
  type SandboxConfig = {
    allowUnsandboxedCommands?: boolean;
    excludedCommands?: string[];
    filesystem?: Filesystem;
  };

  $: sandbox = (settings["sandbox"] as SandboxConfig | undefined) ?? {};
  $: excluded = sandbox.excludedCommands ?? [];
  $: allowWrite = sandbox.filesystem?.allowWrite ?? [];

  let newExcluded = "";
  let newAllowWrite = "";

  function update(patch: Partial<SandboxConfig>) {
    onChange("sandbox", { ...sandbox, ...patch });
  }

  function addExcluded() {
    const v = newExcluded.trim();
    if (!v || excluded.includes(v)) return;
    update({ excludedCommands: [...excluded, v] });
    newExcluded = "";
  }

  function removeExcluded(v: string) {
    update({ excludedCommands: excluded.filter((x) => x !== v) });
  }

  function addAllowWrite() {
    const v = newAllowWrite.trim();
    if (!v || allowWrite.includes(v)) return;
    update({
      filesystem: { ...sandbox.filesystem, allowWrite: [...allowWrite, v] },
    });
    newAllowWrite = "";
  }

  function removeAllowWrite(v: string) {
    update({
      filesystem: {
        ...sandbox.filesystem,
        allowWrite: allowWrite.filter((x) => x !== v),
      },
    });
  }

  $: getInputStyle = inputStyle(theme);
</script>

<div class="sandbox-section">
  <label class="toggle-row" style="color: {theme.fg};">
    <input
      type="checkbox"
      checked={Boolean(sandbox.allowUnsandboxedCommands)}
      on:change={(e) =>
        update({ allowUnsandboxedCommands: e.currentTarget.checked })}
    />
    <div>
      <div style="font-size: 12px; font-weight: 500;">
        Allow unsandboxed commands
      </div>
      <div style="font-size: 11px; color: {theme.fgDim};">
        Run shell commands outside the sandbox without prompting.
      </div>
    </div>
  </label>

  <div class="list-block">
    <div style="font-size: 12px; font-weight: 500; color: {theme.fg};">
      Excluded commands
    </div>
    <div style="font-size: 11px; color: {theme.fgDim};">
      Commands that bypass the sandbox (e.g. git, gh).
    </div>
    {#each excluded as cmd}
      <div class="entry-row">
        <code class="entry-text" style="color: {theme.fg};">{cmd}</code>
        <button
          class="remove-btn"
          style="color: {theme.fgDim};"
          on:click={() => removeExcluded(cmd)}
          aria-label="Remove {cmd}">×</button
        >
      </div>
    {/each}
    <div class="add-row">
      <input
        aria-label="New excluded command"
        bind:value={newExcluded}
        placeholder="git"
        style={getInputStyle("flex: 1;")}
        on:keydown={(e) => e.key === "Enter" && addExcluded()}
      />
      <button
        class="add-btn"
        style="color: {theme.fg}; background: {theme.border};"
        on:click={addExcluded}>Add</button
      >
    </div>
  </div>

  <div class="list-block">
    <div style="font-size: 12px; font-weight: 500; color: {theme.fg};">
      Filesystem write allowlist
    </div>
    <div style="font-size: 11px; color: {theme.fgDim};">
      Paths the sandbox may write to. Absolute paths, ~ expansion, and globs.
    </div>
    {#each allowWrite as path}
      <div class="entry-row">
        <code class="entry-text" style="color: {theme.fg};">{path}</code>
        <button
          class="remove-btn"
          style="color: {theme.fgDim};"
          on:click={() => removeAllowWrite(path)}
          aria-label="Remove {path}">×</button
        >
      </div>
    {/each}
    <div class="add-row">
      <input
        aria-label="New filesystem write path"
        bind:value={newAllowWrite}
        placeholder="/tmp/claude"
        style={getInputStyle("flex: 1;")}
        on:keydown={(e) => e.key === "Enter" && addAllowWrite()}
      />
      <button
        class="add-btn"
        style="color: {theme.fg}; background: {theme.border};"
        on:click={addAllowWrite}>Add</button
      >
    </div>
  </div>
</div>

<style>
  .sandbox-section {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .toggle-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    cursor: pointer;
  }
  .list-block {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .entry-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .entry-text {
    font-size: 11px;
    flex: 1;
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
    border: none;
    border-radius: 4px;
    padding: 3px 10px;
    font-size: 12px;
    cursor: pointer;
  }
</style>
