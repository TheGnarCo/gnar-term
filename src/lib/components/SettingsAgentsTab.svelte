<script lang="ts">
  import { theme } from "../stores/theme";
  import type { AgentPreset } from "../agents-config";

  export let presets: AgentPreset[];
  export let onChange: (next: AgentPreset[]) => void;

  const INTENDED_AGENT_OPTIONS: Array<{ value: string; label: string }> = [
    { value: "", label: "Custom (no detection)" },
    { value: "claude", label: "Claude (claude-code)" },
    { value: "codex", label: "Codex" },
    { value: "aider", label: "Aider" },
  ];

  function update(i: number, patch: Partial<AgentPreset>) {
    const next = presets.map((p, idx) => (idx === i ? { ...p, ...patch } : p));
    onChange(next);
  }

  function remove(i: number) {
    onChange(presets.filter((_, idx) => idx !== i));
  }

  function add() {
    const next: AgentPreset = {
      name: nextDefaultName(presets),
      command: "",
    };
    onChange([...presets, next]);
  }

  function nextDefaultName(list: AgentPreset[]): string {
    const base = "New Preset";
    if (!list.some((p) => p.name === base)) return base;
    let n = 2;
    while (list.some((p) => p.name === `${base} ${n}`)) n++;
    return `${base} ${n}`;
  }

  function envEntries(
    env: Record<string, string> | undefined,
  ): [string, string][] {
    return env ? Object.entries(env) : [];
  }

  function currentEnv(i: number): Record<string, string> {
    return { ...(presets[i]?.env ?? {}) };
  }

  function setEnvKey(i: number, oldKey: string, newKey: string) {
    const env = currentEnv(i);
    const value = env[oldKey] ?? "";
    delete env[oldKey];
    if (newKey) env[newKey] = value;
    update(i, { env: Object.keys(env).length > 0 ? env : undefined });
  }

  function setEnvValue(i: number, key: string, value: string) {
    const env = currentEnv(i);
    env[key] = value;
    update(i, { env });
  }

  function removeEnv(i: number, key: string) {
    const env = currentEnv(i);
    delete env[key];
    update(i, { env: Object.keys(env).length > 0 ? env : undefined });
  }

  function addEnv(i: number) {
    const env = currentEnv(i);
    let key = "VAR";
    let n = 1;
    while (key in env) {
      key = `VAR_${n++}`;
    }
    env[key] = "";
    update(i, { env });
  }
</script>

<div data-page="agents">
  <h3 style="margin: 0 0 4px; font-size: 14px; color: {$theme.fg};">
    Agent Presets
  </h3>
  <p
    style="margin: 0 0 16px; font-size: 11px; color: {$theme.fgDim}; line-height: 1.5;"
  >
    Launchable agent configurations used by the command palette, the spawn
    helpers, and the auto-spawn hook on new branch workspaces. The first preset
    with <code>autoSpawn</code> enabled wins.
  </p>

  <div style="display: flex; flex-direction: column; gap: 12px;">
    {#each presets as preset, i (i)}
      <div
        data-preset-row
        data-preset-name={preset.name}
        style="
          border: 1px solid {$theme.border}; border-radius: 8px;
          padding: 12px; background: {$theme.bgSurface};
          display: flex; flex-direction: column; gap: 10px;
        "
      >
        <!-- Header row: name + autoSpawn + delete -->
        <div style="display: flex; gap: 8px; align-items: center;">
          <input
            data-field="name"
            type="text"
            placeholder="Preset name"
            value={preset.name}
            on:input={(e) => update(i, { name: e.currentTarget.value })}
            style="
              flex: 1; padding: 6px 8px; border-radius: 6px;
              background: {$theme.bg}; color: {$theme.fg};
              border: 1px solid {$theme.border}; font-size: 12px;
              font-weight: 600;
            "
          />
          <label
            style="display: flex; align-items: center; gap: 6px; font-size: 11px; color: {$theme.fgDim}; cursor: pointer;"
          >
            <input
              data-field="autoSpawn"
              type="checkbox"
              checked={preset.autoSpawn === true}
              on:change={(e) =>
                update(i, {
                  autoSpawn: e.currentTarget.checked ? true : undefined,
                })}
            />
            autoSpawn
          </label>
          <button
            data-action="delete-preset"
            on:click={() => remove(i)}
            style="
              padding: 5px 10px; border-radius: 6px; font-size: 11px;
              border: 1px solid {$theme.border}; cursor: pointer;
              background: transparent; color: {$theme.danger};
            ">Delete</button
          >
        </div>

        <!-- Command -->
        <label style="display: flex; flex-direction: column; gap: 4px;">
          <span style="font-size: 11px; color: {$theme.fgDim};">Command</span>
          <input
            data-field="command"
            type="text"
            placeholder="claude --model opus"
            value={preset.command}
            on:input={(e) => update(i, { command: e.currentTarget.value })}
            style="
              padding: 6px 8px; border-radius: 6px;
              background: {$theme.bg}; color: {$theme.fg};
              border: 1px solid {$theme.border}; font-size: 12px;
              font-family: monospace;
            "
          />
        </label>

        <!-- intendedAgent + defaultCwd row -->
        <div style="display: flex; gap: 10px;">
          <label
            style="display: flex; flex-direction: column; gap: 4px; flex: 1;"
          >
            <span style="font-size: 11px; color: {$theme.fgDim};">
              Detection (intendedAgent)
            </span>
            <select
              data-field="intendedAgent"
              value={preset.intendedAgent ?? ""}
              on:change={(e) =>
                update(i, {
                  intendedAgent: e.currentTarget.value || undefined,
                })}
              style="
                padding: 6px 8px; border-radius: 6px;
                background: {$theme.bg}; color: {$theme.fg};
                border: 1px solid {$theme.border}; font-size: 12px;
              "
            >
              {#each INTENDED_AGENT_OPTIONS as opt}
                <option value={opt.value}>{opt.label}</option>
              {/each}
            </select>
          </label>

          <label
            style="display: flex; flex-direction: column; gap: 4px; flex: 1;"
          >
            <span style="font-size: 11px; color: {$theme.fgDim};">
              Default cwd (optional)
            </span>
            <input
              data-field="defaultCwd"
              type="text"
              placeholder="~/Code/some-repo"
              value={preset.defaultCwd ?? ""}
              on:input={(e) =>
                update(i, {
                  defaultCwd: e.currentTarget.value || undefined,
                })}
              style="
                padding: 6px 8px; border-radius: 6px;
                background: {$theme.bg}; color: {$theme.fg};
                border: 1px solid {$theme.border}; font-size: 12px;
                font-family: monospace;
              "
            />
          </label>
        </div>

        <!-- initialPrompt -->
        <label style="display: flex; flex-direction: column; gap: 4px;">
          <span style="font-size: 11px; color: {$theme.fgDim};">
            Initial prompt (optional)
          </span>
          <textarea
            data-field="initialPrompt"
            rows="2"
            placeholder="First message passed to the agent on spawn"
            value={preset.initialPrompt ?? ""}
            on:input={(e) =>
              update(i, {
                initialPrompt: e.currentTarget.value || undefined,
              })}
            style="
              padding: 6px 8px; border-radius: 6px; resize: vertical;
              background: {$theme.bg}; color: {$theme.fg};
              border: 1px solid {$theme.border}; font-size: 12px;
              font-family: monospace;
            "
          ></textarea>
        </label>

        <!-- env editor -->
        <div style="display: flex; flex-direction: column; gap: 6px;">
          <div
            style="display: flex; justify-content: space-between; align-items: center;"
          >
            <span style="font-size: 11px; color: {$theme.fgDim};">
              Environment variables
            </span>
            <button
              data-action="add-env"
              on:click={() => addEnv(i)}
              style="
                padding: 3px 8px; border-radius: 4px; font-size: 11px;
                border: 1px solid {$theme.border}; cursor: pointer;
                background: transparent; color: {$theme.fgDim};
              ">+ Add</button
            >
          </div>
          {#each envEntries(preset.env) as [k, v] (k)}
            <div
              data-env-row
              style="display: flex; gap: 6px; align-items: center;"
            >
              <input
                data-field="env-key"
                type="text"
                placeholder="KEY"
                value={k}
                on:change={(e) => setEnvKey(i, k, e.currentTarget.value)}
                style="
                  flex: 1; padding: 4px 6px; border-radius: 4px;
                  background: {$theme.bg}; color: {$theme.fg};
                  border: 1px solid {$theme.border}; font-size: 11px;
                  font-family: monospace;
                "
              />
              <input
                data-field="env-value"
                type="text"
                placeholder="value"
                value={v}
                on:input={(e) => setEnvValue(i, k, e.currentTarget.value)}
                style="
                  flex: 2; padding: 4px 6px; border-radius: 4px;
                  background: {$theme.bg}; color: {$theme.fg};
                  border: 1px solid {$theme.border}; font-size: 11px;
                  font-family: monospace;
                "
              />
              <button
                data-action="remove-env"
                on:click={() => removeEnv(i, k)}
                aria-label="Remove {k}"
                style="
                  padding: 2px 8px; border-radius: 4px; font-size: 11px;
                  border: 1px solid {$theme.border}; cursor: pointer;
                  background: transparent; color: {$theme.fgDim};
                ">×</button
              >
            </div>
          {/each}
        </div>
      </div>
    {/each}

    {#if presets.length === 0}
      <div
        style="
          padding: 16px; border: 1px dashed {$theme.border}; border-radius: 8px;
          font-size: 12px; color: {$theme.fgDim}; text-align: center;
        "
      >
        No agent presets yet. Add one to enable spawn-from-palette and the
        auto-spawn hook on new branch workspaces.
      </div>
    {/if}

    <button
      data-action="add-preset"
      on:click={add}
      style="
        align-self: flex-start; padding: 6px 12px; border-radius: 6px;
        font-size: 12px; border: 1px solid {$theme.border}; cursor: pointer;
        background: {$theme.bgSurface}; color: {$theme.fg};
      ">+ Add Preset</button
    >
  </div>
</div>
