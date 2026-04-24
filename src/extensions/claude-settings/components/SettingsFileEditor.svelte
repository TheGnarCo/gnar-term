<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { getContext } from "svelte";
  import { EXTENSION_API_KEY, type ExtensionAPI } from "../../api";
  import {
    readClaudeFile,
    writeClaudeFile,
    watchClaudeFile,
    parseClaudeSettings,
    serializeClaudeSettings,
  } from "../lib/claude-settings-service";
  import { SETTINGS_SECTIONS } from "../lib/settings-schema";
  import ModelSection from "./sections/ModelSection.svelte";
  import PermissionsSection from "./sections/PermissionsSection.svelte";
  import EnvSection from "./sections/EnvSection.svelte";
  import HooksSection from "./sections/HooksSection.svelte";
  import PluginsSection from "./sections/PluginsSection.svelte";
  import McpSection from "./sections/McpSection.svelte";
  import DirListingSection from "./sections/DirListingSection.svelte";
  import SandboxSection from "./sections/SandboxSection.svelte";
  import OtherSection from "./sections/OtherSection.svelte";

  export let filePath: string;
  export let label: string = "";
  /** Base directory for dir-listing sections (skills, agents). Defaults to dirname of filePath. */
  export let baseDir: string = "";

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const themeStore = api.theme;

  $: t = {
    fg: $themeStore.fg,
    fgDim: $themeStore.fgDim,
    bg: $themeStore.bg,
    border: $themeStore.border,
    accent:
      ($themeStore as unknown as Record<string, string>).accent ??
      $themeStore.border,
  };

  let settings: Record<string, unknown> = {};
  let dirty = false;
  let saving = false;
  let error = "";
  let externalChange = false;
  let unlisten: (() => void) | null = null;
  let expandedSections: Set<string> = new Set(["model", "permissions"]);

  $: claudeDir = baseDir || filePath.replace(/\/[^/]+$/, "");
  $: skillsDir = claudeDir.replace(/\/?$/, "/skills");
  $: agentsDir = claudeDir.replace(/\/?$/, "/agents");

  async function load() {
    error = "";
    try {
      const raw = await readClaudeFile(filePath);
      settings = parseClaudeSettings(raw);
    } catch {
      settings = {};
    }
    dirty = false;
  }

  async function save() {
    saving = true;
    error = "";
    try {
      await writeClaudeFile(filePath, serializeClaudeSettings(settings));
      dirty = false;
      externalChange = false;
    } catch (e) {
      error = String(e);
    } finally {
      saving = false;
    }
  }

  function handleChange(key: string, value: unknown) {
    const dotIdx = key.indexOf(".");
    if (dotIdx !== -1) {
      const top = key.slice(0, dotIdx);
      const rest = key.slice(dotIdx + 1);
      const sub = (settings[top] as Record<string, unknown> | undefined) ?? {};
      settings = { ...settings, [top]: { ...sub, [rest]: value } };
    } else {
      settings = { ...settings, [key]: value };
    }
    dirty = true;
  }

  function toggleSection(id: string) {
    if (expandedSections.has(id)) {
      expandedSections.delete(id);
    } else {
      expandedSections.add(id);
    }
    expandedSections = expandedSections;
  }

  onMount(async () => {
    await load();
    try {
      unlisten = await watchClaudeFile(filePath, () => {
        if (!dirty) {
          void load();
        } else {
          externalChange = true;
        }
      });
    } catch {
      // File watching unavailable — silently ignore
    }
  });

  onDestroy(() => {
    unlisten?.();
  });
</script>

<div class="settings-editor" style="background: {t.bg}; color: {t.fg};">
  <!-- Header -->
  <div class="editor-header" style="border-bottom: 1px solid {t.border};">
    {#if label}
      <span class="editor-label" style="color: {t.fg};">{label}</span>
    {/if}
    <code class="file-path" style="color: {t.fgDim};">{filePath}</code>
    <div class="header-actions">
      {#if externalChange}
        <span style="color: {t.fgDim}; font-size: 11px;"
          >File changed externally</span
        >
        <button
          class="action-btn"
          style="color: {t.fg}; border-color: {t.border};"
          on:click={load}
        >
          Reload
        </button>
      {/if}
      {#if error}
        <span class="error-msg" style="color: #e06c75;">{error}</span>
      {/if}
      <button
        class="save-btn"
        disabled={!dirty || saving}
        style="background: {dirty ? t.fg : t.border}; color: {t.bg};"
        on:click={save}
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  </div>

  <!-- Sections -->
  <div class="sections-list">
    {#each SETTINGS_SECTIONS as section}
      <div class="section-block" style="border-bottom: 1px solid {t.border};">
        <button
          class="section-header"
          style="color: {t.fg};"
          on:click={() => toggleSection(section.id)}
        >
          <span class="chevron" style="color: {t.fgDim};">
            {expandedSections.has(section.id) ? "▾" : "▸"}
          </span>
          <span class="section-label">{section.label}</span>
        </button>

        {#if expandedSections.has(section.id)}
          <div class="section-body">
            {#if section.id === "model"}
              <ModelSection
                {section}
                {settings}
                onChange={handleChange}
                theme={t}
              />
            {:else if section.id === "permissions"}
              <PermissionsSection
                {settings}
                onChange={handleChange}
                theme={t}
              />
            {:else if section.id === "env"}
              <EnvSection {settings} onChange={handleChange} theme={t} />
            {:else if section.id === "hooks"}
              <HooksSection {settings} onChange={handleChange} theme={t} />
            {:else if section.id === "plugins"}
              <PluginsSection {settings} onChange={handleChange} theme={t} />
            {:else if section.id === "mcp"}
              <McpSection {settings} onChange={handleChange} theme={t} />
            {:else if section.id === "skills"}
              <DirListingSection dirPath={skillsDir} label="Skills" theme={t} />
            {:else if section.id === "agents"}
              <DirListingSection dirPath={agentsDir} label="Agents" theme={t} />
            {:else if section.id === "sandbox"}
              <SandboxSection {settings} onChange={handleChange} theme={t} />
            {/if}
          </div>
        {/if}
      </div>
    {/each}

    <!-- Other (catch-all for unknown keys) -->
    <div class="section-block">
      <button
        class="section-header"
        style="color: {t.fg};"
        on:click={() => toggleSection("__other__")}
      >
        <span class="chevron" style="color: {t.fgDim};">
          {expandedSections.has("__other__") ? "▾" : "▸"}
        </span>
        <span class="section-label">Other</span>
      </button>
      {#if expandedSections.has("__other__")}
        <div class="section-body">
          <OtherSection {settings} onChange={handleChange} theme={t} />
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .settings-editor {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    font-size: 13px;
  }
  .editor-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    flex-shrink: 0;
  }
  .editor-label {
    font-size: 12px;
    font-weight: 600;
  }
  .file-path {
    font-size: 10px;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .header-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }
  .error-msg {
    font-size: 11px;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .action-btn {
    background: none;
    border: 1px solid;
    border-radius: 4px;
    cursor: pointer;
    padding: 2px 8px;
    font-size: 11px;
  }
  .save-btn {
    border: none;
    border-radius: 4px;
    cursor: pointer;
    padding: 3px 12px;
    font-size: 12px;
    font-weight: 500;
    transition: opacity 0.1s;
  }
  .save-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .sections-list {
    flex: 1;
    overflow-y: auto;
  }
  .section-block {
    padding: 0;
  }
  .section-header {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
  }
  .section-header:hover {
    background: rgba(255, 255, 255, 0.04);
  }
  .chevron {
    font-size: 10px;
    width: 12px;
    flex-shrink: 0;
  }
  .section-label {
    font-size: 12px;
    font-weight: 600;
  }
  .section-body {
    padding: 8px 14px 14px 34px;
  }
</style>
