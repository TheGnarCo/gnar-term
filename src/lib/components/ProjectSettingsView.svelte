<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { theme } from "../stores/theme";
  import { currentView, currentProjectId, goToProject } from "../stores/ui";
  import { projects } from "../stores/project";
  import { getSettings } from "../settings";
  import type { ProjectSettingsOverride } from "../settings";
  import { dialogStyles } from "../dialog-utils";

  let copyFilesVal = "";
  let setupVal = "";
  let defaultHarnessVal = "";
  let worktreePrefixVal = "";
  let autoSpawnVal = "";
  let initialized = false;
  let saveStatus = "";

  $: project = $projects.find((p) => p.id === $currentProjectId) || null;
  $: settingsPath = project ? `${project.path}/.gnar/settings.json` : "";

  $: if ($currentView === "project-settings" && project && !initialized) {
    loadProjectConfig();
  }

  $: if ($currentView !== "project-settings") {
    initialized = false;
  }

  async function loadProjectConfig() {
    if (!project) return;
    try {
      const content = await invoke<string>("read_file", {
        path: settingsPath,
      });
      const overrides: ProjectSettingsOverride = JSON.parse(content);
      copyFilesVal = (overrides.copyFiles || []).join("\n");
      setupVal = overrides.setup || "";
      defaultHarnessVal = overrides.defaultHarness || "";
      worktreePrefixVal = overrides.worktreePrefix || "";
      autoSpawnVal = (overrides.autoSpawnHarnesses || []).join("\n");
    } catch {
      // No project settings file yet — start blank
      copyFilesVal = "";
      setupVal = "";
      defaultHarnessVal = "";
      worktreePrefixVal = "";
      autoSpawnVal = "";
    }
    initialized = true;
  }

  async function save() {
    if (!project) return;
    const overrides: ProjectSettingsOverride = {};
    const cf = copyFilesVal
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (cf.length > 0) overrides.copyFiles = cf;
    if (setupVal.trim()) overrides.setup = setupVal.trim();
    if (defaultHarnessVal) overrides.defaultHarness = defaultHarnessVal;
    if (worktreePrefixVal) overrides.worktreePrefix = worktreePrefixVal;
    const asp = autoSpawnVal
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (asp.length > 0) overrides.autoSpawnHarnesses = asp;

    try {
      await invoke("ensure_dir", { path: `${project.path}/.gnar` });
      await invoke("write_file", {
        path: settingsPath,
        content: JSON.stringify(overrides, null, 2),
      });
      saveStatus = "Saved";
      setTimeout(() => {
        saveStatus = "";
      }, 2000);
    } catch (err) {
      saveStatus = `Save failed: ${err}`;
    }
  }

  function close() {
    if (project) goToProject(project.id);
  }

  $: styles = dialogStyles($theme);
</script>

{#if $currentView === "project-settings" && project}
  <div
    style="
      flex: 1; display: flex; flex-direction: column;
      background: {$theme.sidebarBg}; color: {$theme.fg};
      overflow: hidden;
    "
  >
    <div
      style="flex: 1; overflow-y: auto; padding: 24px 32px; max-width: 640px; margin: 0 auto; width: 100%;"
    >
      <!-- Header with close button -->
      <div
        style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;"
      >
        <div
          style="display: flex; align-items: center; gap: 6px; font-size: 12px;"
        >
          <button
            class="breadcrumb-link"
            style="background: none; border: none; color: {$theme.fgMuted}; cursor: pointer; padding: 0; font-size: 12px;"
            on:click={close}>{project.name}</button
          >
          <span style="color: {$theme.fgDim};">/</span>
          <span style="color: {$theme.fg}; font-weight: 500;">Settings</span>
        </div>
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <span
          style="cursor: pointer; color: {$theme.fgMuted}; padding: 4px;"
          title="Close"
          on:click={close}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            ><line x1="3" y1="3" x2="11" y2="11" /><line
              x1="11"
              y1="3"
              x2="3"
              y2="11"
            /></svg
          >
        </span>
      </div>

      <h1 style="font-size: 20px; font-weight: 600; margin: 0 0 24px;">
        {project.name} Settings
      </h1>

      <div style="display: flex; flex-direction: column; gap: 20px;">
        <!-- Copy Files -->
        <div style="display: flex; flex-direction: column; gap: 4px;">
          <label for="ps-copyfiles" style={styles.label}>Copy Files</label>
          <span style="font-size: 11px; color: {$theme.fgDim};"
            >Glob patterns of files to copy from main worktree into new
            worktrees (one per line)</span
          >
          <textarea
            id="ps-copyfiles"
            bind:value={copyFilesVal}
            rows="3"
            placeholder={".env\n.env.local"}
            style="{styles.input} resize: vertical; font-family: monospace; font-size: 12px;"
          ></textarea>
        </div>

        <!-- Setup Script -->
        <div style="display: flex; flex-direction: column; gap: 4px;">
          <label for="ps-setup" style={styles.label}>Setup Script</label>
          <span style="font-size: 11px; color: {$theme.fgDim};"
            >Shell command to run after worktree creation</span
          >
          <input
            id="ps-setup"
            type="text"
            bind:value={setupVal}
            placeholder="bun install"
            style={styles.input}
          />
        </div>

        <!-- Default Harness -->
        <div style="display: flex; flex-direction: column; gap: 4px;">
          <label for="ps-harness" style={styles.label}>Default Harness</label>
          <select
            id="ps-harness"
            bind:value={defaultHarnessVal}
            style={styles.select}
          >
            <option value="">Use global default</option>
            {#each getSettings().harnesses as h}
              <option value={h.id}>{h.name}</option>
            {/each}
          </select>
        </div>

        <!-- Worktree Prefix -->
        <div style="display: flex; flex-direction: column; gap: 4px;">
          <label for="ps-wtprefix" style={styles.label}
            >Worktree Branch Prefix</label
          >
          <input
            id="ps-wtprefix"
            type="text"
            bind:value={worktreePrefixVal}
            placeholder="Use global default"
            style={styles.input}
          />
        </div>

        <!-- Auto-Spawn Harnesses -->
        <div style="display: flex; flex-direction: column; gap: 4px;">
          <label for="ps-autospawn" style={styles.label}
            >Auto-Spawn Harnesses</label
          >
          <span style="font-size: 11px; color: {$theme.fgDim};"
            >Preset IDs to spawn on workspace creation (one per line, falls back
            to default harness)</span
          >
          <textarea
            id="ps-autospawn"
            bind:value={autoSpawnVal}
            rows="2"
            placeholder="claude"
            style="{styles.input} resize: vertical; font-family: monospace; font-size: 12px;"
          ></textarea>
        </div>

        <!-- Save button -->
        <div style="display: flex; align-items: center; gap: 12px;">
          <button
            on:click={save}
            style="
              font-size: 12px; padding: 6px 16px; border-radius: 4px;
              border: none; background: {$theme.accent}; color: white;
              cursor: pointer;
            ">Save</button
          >
          {#if saveStatus}
            <span
              style="font-size: 11px; color: {saveStatus.startsWith(
                'Save failed',
              )
                ? $theme.danger
                : $theme.success};">{saveStatus}</span
            >
          {/if}
        </div>

        <div style="font-size: 10px; color: {$theme.fgDim}; padding-top: 8px;">
          Settings saved to {settingsPath}
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .breadcrumb-link:hover {
    text-decoration: underline;
  }
</style>
