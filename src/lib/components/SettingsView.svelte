<script lang="ts">
  import { theme } from "../stores/theme";
  import { themes } from "../theme-data";
  import { currentView, goHome } from "../stores/ui";
  import { getSettings, saveSettings } from "../settings";
  import { dialogStyles, browseDirectory } from "../dialog-utils";

  const fontFamilies = [
    "MesloLGS Nerd Font",
    "JetBrains Mono",
    "Fira Code",
    "SF Mono",
    "Menlo",
    "Monaco",
    "Cascadia Code",
    "Source Code Pro",
    "IBM Plex Mono",
    "Inconsolata",
    "Hack",
    "Ubuntu Mono",
  ];
  const fontSizes = [10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24];

  let themeVal = "";
  let fontSizeVal = 14;
  let fontFamilyVal = "";
  let projectsDirVal = "";
  let worktreePrefixVal = "";
  let defaultHarnessVal = "";
  let copyFilesVal = "";
  let setupVal = "";
  let initialized = false;

  $: if ($currentView === "settings" && !initialized) {
    const s = getSettings();
    themeVal = s.theme;
    fontSizeVal = s.fontSize;
    fontFamilyVal = s.fontFamily;
    projectsDirVal = s.projectsDir;
    worktreePrefixVal = s.worktreePrefix;
    defaultHarnessVal = s.defaultHarness;
    copyFilesVal = (s.copyFiles || []).join("\n");
    setupVal = s.setup || "";
    initialized = true;
  }

  $: if ($currentView !== "settings") {
    initialized = false;
  }

  async function autoSave() {
    await saveSettings({
      theme: themeVal,
      fontSize: fontSizeVal,
      fontFamily: fontFamilyVal,
      projectsDir: projectsDirVal,
      worktreePrefix: worktreePrefixVal,
      defaultHarness: defaultHarnessVal,
      copyFiles: copyFilesVal
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      setup: setupVal.trim(),
    });
  }

  // Auto-save when any value changes (after initialization)
  $: if (initialized && themeVal && fontFamilyVal) {
    autoSave();
  }

  async function browseProjects() {
    const path = await browseDirectory("Select projects directory");
    if (path) projectsDirVal = path;
  }
  $: styles = dialogStyles($theme);
</script>

{#if $currentView === "settings"}
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
      <!-- Breadcrumb + close button -->
      <div
        style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;"
      >
        <div
          style="display: flex; align-items: center; gap: 6px; font-size: 12px;"
        >
          <button
            class="breadcrumb-link"
            style="background: none; border: none; color: {$theme.fgMuted}; cursor: pointer; padding: 0; font-size: 12px;"
            on:click={goHome}>Dashboard</button
          >
          <span style="color: {$theme.fgDim};">/</span>
          <span style="color: {$theme.fg}; font-weight: 500;">Settings</span>
        </div>
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <span
          style="cursor: pointer; color: {$theme.fgMuted}; padding: 4px;"
          title="Close"
          on:click={goHome}
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
        Settings
      </h1>

      <div style="display: flex; flex-direction: column; gap: 20px;">
        <!-- Theme -->
        <div style="display: flex; flex-direction: column; gap: 4px;">
          <label for="set-theme" style={styles.label}>Theme</label>
          <select id="set-theme" bind:value={themeVal} style={styles.select}>
            {#each Object.entries(themes) as [key, t]}
              <option value={key}>{t.name}</option>
            {/each}
          </select>
        </div>

        <!-- Font Family + Size -->
        <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 12px;">
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <label for="set-fontfamily" style={styles.label}>Font Family</label>
            <select
              id="set-fontfamily"
              bind:value={fontFamilyVal}
              style={styles.select}
            >
              {#each fontFamilies as f}
                <option value={f}>{f}</option>
              {/each}
            </select>
          </div>
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <label for="set-fontsize" style={styles.label}>Font Size</label>
            <select
              id="set-fontsize"
              bind:value={fontSizeVal}
              style={styles.select}
            >
              {#each fontSizes as s}
                <option value={s}>{s}px</option>
              {/each}
            </select>
          </div>
        </div>

        <!-- Projects Dir -->
        <div style="display: flex; flex-direction: column; gap: 4px;">
          <label for="set-projdir" style={styles.label}
            >Projects Directory</label
          >
          <div style="display: flex; gap: 8px;">
            <input
              id="set-projdir"
              type="text"
              bind:value={projectsDirVal}
              placeholder="~/Projects"
              style={styles.input}
            />
            <button on:click={browseProjects} style={styles.browseBtn}
              >Browse</button
            >
          </div>
        </div>

        <!-- Worktree Prefix -->
        <div style="display: flex; flex-direction: column; gap: 4px;">
          <label for="set-wtprefix" style={styles.label}
            >Worktree Branch Prefix</label
          >
          <input
            id="set-wtprefix"
            type="text"
            bind:value={worktreePrefixVal}
            placeholder="e.g. gnar/"
            style={styles.input}
          />
        </div>

        <!-- Default Harness -->
        <div style="display: flex; flex-direction: column; gap: 4px;">
          <label for="set-harness" style={styles.label}>Default Harness</label>
          <select
            id="set-harness"
            bind:value={defaultHarnessVal}
            style={styles.select}
          >
            {#each getSettings().harnesses as h}
              <option value={h.id}>{h.name}</option>
            {/each}
          </select>
        </div>

        <!-- Copy Files -->
        <div style="display: flex; flex-direction: column; gap: 4px;">
          <label for="set-copyfiles" style={styles.label}
            >Copy Files (default)</label
          >
          <span style="font-size: 11px; color: {$theme.fgDim};"
            >Glob patterns of files to copy from main worktree into new
            worktrees (one per line)</span
          >
          <textarea
            id="set-copyfiles"
            bind:value={copyFilesVal}
            rows="3"
            placeholder=".env&#10;.env.local"
            style="{styles.input} resize: vertical; font-family: monospace; font-size: 12px;"
          ></textarea>
        </div>

        <!-- Setup Script -->
        <div style="display: flex; flex-direction: column; gap: 4px;">
          <label for="set-setup" style={styles.label}
            >Setup Script (default)</label
          >
          <span style="font-size: 11px; color: {$theme.fgDim};"
            >Shell command to run after worktree creation</span
          >
          <input
            id="set-setup"
            type="text"
            bind:value={setupVal}
            placeholder="bun install"
            style={styles.input}
          />
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
