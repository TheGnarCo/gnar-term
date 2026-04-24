<script lang="ts">
  export let settings: Record<string, unknown>;
  export let onChange: (key: string, value: unknown) => void;
  export let theme: { fg: string; fgDim: string; bg: string; border: string };

  type SandboxConfig = { enabled?: boolean; failIfUnavailable?: boolean };
  $: sandbox = (settings["sandbox"] as SandboxConfig | undefined) ?? {};

  function update(patch: Partial<SandboxConfig>) {
    onChange("sandbox", { ...sandbox, ...patch });
  }
</script>

<div class="sandbox-section">
  <label class="toggle-row" style="color: {theme.fg};">
    <input
      type="checkbox"
      checked={Boolean(sandbox.enabled)}
      on:change={(e) => update({ enabled: e.currentTarget.checked })}
    />
    <div>
      <div style="font-size: 12px; font-weight: 500;">Sandbox enabled</div>
      <div style="font-size: 11px; color: {theme.fgDim};">
        Run commands inside a security sandbox.
      </div>
    </div>
  </label>

  <label class="toggle-row" style="color: {theme.fg};">
    <input
      type="checkbox"
      checked={Boolean(sandbox.failIfUnavailable)}
      on:change={(e) => update({ failIfUnavailable: e.currentTarget.checked })}
    />
    <div>
      <div style="font-size: 12px; font-weight: 500;">
        Fail if sandbox unavailable
      </div>
      <div style="font-size: 11px; color: {theme.fgDim};">
        Error instead of falling back when sandbox is not available.
      </div>
    </div>
  </label>
</div>

<style>
  .sandbox-section {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .toggle-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    cursor: pointer;
  }
</style>
