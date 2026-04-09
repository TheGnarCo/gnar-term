<script lang="ts">
  import { theme } from "../stores/theme";
  import { themes } from "../theme-data";
  import { settingsDialogOpen, needsReload } from "../stores/ui";
  import { getSettings, saveSettings } from "../settings";
  import { dialogStyles, browseDirectory } from "../dialog-utils";
  import Dialog from "./Dialog.svelte";

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
  let worktreeBaseDirVal = "";
  let defaultHarnessVal = "";

  $: if ($settingsDialogOpen) {
    const s = getSettings();
    themeVal = s.theme;
    fontSizeVal = s.fontSize;
    fontFamilyVal = s.fontFamily;
    projectsDirVal = s.projectsDir;
    worktreePrefixVal = s.worktreePrefix;
    worktreeBaseDirVal = s.worktreeBaseDir;
    defaultHarnessVal = s.defaultHarness;
  }

  async function save() {
    const prev = getSettings();
    await saveSettings({
      theme: themeVal,
      fontSize: fontSizeVal,
      fontFamily: fontFamilyVal,
      projectsDir: projectsDirVal,
      worktreePrefix: worktreePrefixVal,
      worktreeBaseDir: worktreeBaseDirVal,
      defaultHarness: defaultHarnessVal,
    });
    settingsDialogOpen.set(false);
    const changed =
      prev.theme !== themeVal ||
      prev.fontSize !== fontSizeVal ||
      prev.fontFamily !== fontFamilyVal ||
      prev.projectsDir !== projectsDirVal ||
      prev.worktreePrefix !== worktreePrefixVal ||
      prev.worktreeBaseDir !== worktreeBaseDirVal ||
      prev.defaultHarness !== defaultHarnessVal;
    if (changed) needsReload.set(true);
  }

  function cancel() {
    settingsDialogOpen.set(false);
  }

  async function browseProjects() {
    const path = await browseDirectory("Select projects directory");
    if (path) projectsDirVal = path;
  }
  async function browseWorktrees() {
    const path = await browseDirectory("Select worktree base directory");
    if (path) worktreeBaseDirVal = path;
  }

  function handleKeydown(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      save();
    }
  }

  $: styles = dialogStyles($theme);
</script>

<Dialog
  visible={$settingsDialogOpen}
  title="Settings"
  width="520px"
  paddingTop="60px"
  submitLabel="Save"
  onCancel={cancel}
  onSubmit={save}
  onKeydown={handleKeydown}
>
  <!-- Theme -->
  <div style="display: flex; flex-direction: column;">
    <label for="set-theme" style={styles.label}>Theme</label>
    <select id="set-theme" bind:value={themeVal} style={styles.select}>
      {#each Object.entries(themes) as [key, t]}
        <option value={key}>{t.name}</option>
      {/each}
    </select>
  </div>

  <!-- Font Family + Size -->
  <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 12px;">
    <div style="display: flex; flex-direction: column;">
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
    <div style="display: flex; flex-direction: column;">
      <label for="set-fontsize" style={styles.label}>Font Size</label>
      <select id="set-fontsize" bind:value={fontSizeVal} style={styles.select}>
        {#each fontSizes as s}
          <option value={s}>{s}px</option>
        {/each}
      </select>
    </div>
  </div>

  <!-- Projects Dir -->
  <div style="display: flex; flex-direction: column;">
    <label for="set-projdir" style={styles.label}>Projects Directory</label>
    <div style="display: flex; gap: 8px;">
      <input
        id="set-projdir"
        type="text"
        bind:value={projectsDirVal}
        placeholder="~/Projects"
        style={styles.input}
      />
      <button on:click={browseProjects} style={styles.browseBtn}>Browse</button>
    </div>
  </div>

  <!-- Worktree Prefix -->
  <div style="display: flex; flex-direction: column;">
    <label for="set-wtprefix" style={styles.label}>Worktree Branch Prefix</label
    >
    <input
      id="set-wtprefix"
      type="text"
      bind:value={worktreePrefixVal}
      placeholder="e.g. gnar/"
      style={styles.input}
    />
  </div>

  <!-- Worktree Base Dir -->
  <div style="display: flex; flex-direction: column;">
    <label for="set-wtbasedir" style={styles.label}
      >Worktree Base Directory</label
    >
    <div style="display: flex; gap: 8px;">
      <input
        id="set-wtbasedir"
        type="text"
        bind:value={worktreeBaseDirVal}
        placeholder="/absolute/path/to/worktrees"
        style={styles.input}
      />
      <button on:click={browseWorktrees} style={styles.browseBtn}>Browse</button
      >
    </div>
  </div>

  <!-- Default Harness -->
  <div style="display: flex; flex-direction: column;">
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
</Dialog>
