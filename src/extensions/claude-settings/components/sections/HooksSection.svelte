<script lang="ts">
  export let settings: Record<string, unknown>;
  export let onChange: (key: string, value: unknown) => void;
  export let theme: { fg: string; fgDim: string; bg: string; border: string };

  type HookEntry = {
    type: string;
    command?: string;
    url?: string;
    timeout?: number;
  };
  type HookGroup = { matcher?: string; hooks: HookEntry[] };
  type HooksMap = Record<string, HookGroup[]>;

  const HOOK_EVENTS = [
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "Stop",
    "PreCompact",
    "PostCompact",
    "FileChanged",
    "CwdChanged",
  ];

  $: hooksMap = (settings["hooks"] as HooksMap | undefined) ?? {};
  $: expandedEvents = new Set<string>();

  function toggleEvent(event: string) {
    if (expandedEvents.has(event)) {
      expandedEvents.delete(event);
    } else {
      expandedEvents.add(event);
    }
    expandedEvents = expandedEvents;
  }

  function addHook(event: string, command: string) {
    if (!command.trim()) return;
    const existing = hooksMap[event] ?? [];
    const updated: HooksMap = {
      ...hooksMap,
      [event]: [
        ...existing,
        { matcher: "", hooks: [{ type: "command", command: command.trim() }] },
      ],
    };
    onChange("hooks", updated);
  }

  function removeGroup(event: string, idx: number) {
    const existing = [...(hooksMap[event] ?? [])];
    existing.splice(idx, 1);
    const updated: HooksMap = { ...hooksMap };
    if (existing.length === 0) {
      delete updated[event];
    } else {
      updated[event] = existing;
    }
    onChange("hooks", updated);
  }

  let newCommands: Record<string, string> = {};

  const inputStyle = (extra = "") =>
    `background: ${theme.bg}; color: ${theme.fg}; border: 1px solid ${theme.border}; border-radius: 4px; padding: 3px 8px; font-size: 11px; font-family: monospace; ${extra}`;
</script>

<div class="hooks-section">
  {#each HOOK_EVENTS as event}
    {@const groups = hooksMap[event] ?? []}
    <div class="event-block">
      <button
        class="event-header"
        style="color: {theme.fg}; background: none; border: none; cursor: pointer; display: flex; align-items: center; gap: 6px; padding: 4px 0; width: 100%; text-align: left;"
        on:click={() => toggleEvent(event)}
      >
        <span style="font-size: 11px; color: {theme.fgDim};"
          >{expandedEvents.has(event) ? "▾" : "▸"}</span
        >
        <span style="font-size: 12px; font-weight: 500;">{event}</span>
        {#if groups.length > 0}
          <span style="font-size: 10px; color: {theme.fgDim};"
            >({groups.length})</span
          >
        {/if}
      </button>

      {#if expandedEvents.has(event)}
        <div class="event-body" style="padding-left: 18px;">
          {#each groups as group, idx}
            <div
              class="hook-group"
              style="border-left: 2px solid {theme.border}; padding-left: 8px; margin-bottom: 6px;"
            >
              {#if group.matcher}
                <div style="font-size: 10px; color: {theme.fgDim};">
                  matcher: {group.matcher}
                </div>
              {/if}
              {#each group.hooks as hook}
                <code
                  style="font-size: 10px; color: {theme.fg}; display: block;"
                >
                  {hook.type}{hook.command ? `: ${hook.command}` : ""}{hook.url
                    ? `: ${hook.url}`
                    : ""}
                </code>
              {/each}
              <button
                style="font-size: 10px; color: {theme.fgDim}; background: none; border: none; cursor: pointer; padding: 0;"
                on:click={() => removeGroup(event, idx)}>Remove</button
              >
            </div>
          {/each}

          <div
            class="add-hook-row"
            style="display: flex; gap: 6px; margin-top: 4px;"
          >
            <input
              bind:value={newCommands[event]}
              aria-label={`Command for ${event} hook`}
              placeholder="command to run"
              style={inputStyle("flex: 1;")}
              on:keydown={(e) => {
                if (e.key === "Enter") {
                  addHook(event, newCommands[event] ?? "");
                  newCommands[event] = "";
                }
              }}
            />
            <button
              style="color: {theme.fg}; background: {theme.border}; border: none; border-radius: 4px; padding: 3px 8px; font-size: 11px; cursor: pointer;"
              on:click={() => {
                addHook(event, newCommands[event] ?? "");
                newCommands[event] = "";
              }}>Add command</button
            >
          </div>
        </div>
      {/if}
    </div>
  {/each}
</div>

<style>
  .hooks-section {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .event-block {
    border-radius: 4px;
  }
</style>
