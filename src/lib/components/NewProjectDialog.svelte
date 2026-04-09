<script lang="ts">
  import { tick, onDestroy } from "svelte";
  import { theme } from "../stores/theme";
  import { newProjectDialog } from "../stores/ui";
  import { dialogStyles, browseDirectory } from "../dialog-utils";
  import Dialog from "./Dialog.svelte";

  let tab: "local" | "remote" = "local";
  let localPath = "";
  let remoteUrl = "";
  let inputEl: HTMLInputElement;

  const unsub = newProjectDialog.subscribe((val) => {
    if (val) {
      tab = "local";
      localPath = "";
      remoteUrl = "";
      tick().then(() => inputEl?.focus());
    }
  });
  onDestroy(unsub);

  /** Normalize any git reference to a cloneable URL.
   *  Accepts: user/repo, github.com/user/repo, https://..., git@..., ssh://... */
  function normalizeGitUrl(input: string): string {
    const trimmed = input.trim();
    // Already a full URL
    if (
      trimmed.startsWith("https://") ||
      trimmed.startsWith("http://") ||
      trimmed.startsWith("ssh://") ||
      trimmed.startsWith("git@")
    ) {
      return trimmed;
    }
    // Strip optional leading protocol-less domain: github.com/user/repo
    const withDomain = trimmed.replace(
      /^(github\.com|gitlab\.com|bitbucket\.org)\//,
      "",
    );
    // If it looks like user/repo (exactly two segments, no spaces)
    if (/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(withDomain)) {
      return `https://github.com/${withDomain}.git`;
    }
    // Fallback: return as-is, git clone will produce an error if invalid
    return trimmed;
  }

  function submit() {
    if (!$newProjectDialog) return;
    if (tab === "local" && localPath.trim()) {
      $newProjectDialog.resolve({ mode: "local", path: localPath.trim() });
    } else if (tab === "remote" && remoteUrl.trim()) {
      $newProjectDialog.resolve({
        mode: "remote",
        url: normalizeGitUrl(remoteUrl),
      });
    } else {
      return;
    }
    newProjectDialog.set(null);
  }

  function cancel() {
    if (!$newProjectDialog) return;
    $newProjectDialog.resolve(null);
    newProjectDialog.set(null);
  }

  async function browse() {
    const path = await browseDirectory("Select project directory");
    if (path) localPath = path;
  }

  $: styles = dialogStyles($theme);
</script>

<Dialog
  visible={!!$newProjectDialog}
  title="New Project"
  submitLabel={tab === "local" ? "Add Project" : "Clone"}
  onCancel={cancel}
  onSubmit={submit}
>
  <!-- Tabs -->
  <div style="display: flex; border-bottom: 1px solid {$theme.border};">
    <button
      style={styles.tab(tab === "local")}
      on:click={() => {
        tab = "local";
        tick().then(() => inputEl?.focus());
      }}>Local</button
    >
    <button
      style={styles.tab(tab === "remote")}
      on:click={() => {
        tab = "remote";
        tick().then(() => inputEl?.focus());
      }}>Remote</button
    >
  </div>

  {#if tab === "local"}
    <div style="display: flex; flex-direction: column; gap: 6px;">
      <label for="np-path" style={styles.label}>Project directory</label>
      <div style="display: flex; gap: 8px;">
        <input
          id="np-path"
          bind:this={inputEl}
          type="text"
          placeholder="/path/to/project"
          bind:value={localPath}
          style={styles.input}
        />
        <button on:click={browse} style={styles.browseBtn}>Browse</button>
      </div>
    </div>
  {:else}
    <div style="display: flex; flex-direction: column; gap: 6px;">
      <label for="np-url" style={styles.label}>Repository</label>
      <input
        id="np-url"
        bind:this={inputEl}
        type="text"
        placeholder="owner/repo"
        bind:value={remoteUrl}
        style={styles.input}
      />
      <span style="font-size: 11px; color: {$theme.fgDim};">
        {#if remoteUrl.trim() && normalizeGitUrl(remoteUrl) !== remoteUrl.trim()}
          Will clone: {normalizeGitUrl(remoteUrl)}
        {:else}
          Accepts: owner/repo, full URL, or git@... SSH path
        {/if}
      </span>
    </div>
  {/if}
</Dialog>
