<script lang="ts">
  /**
   * Settings → Themes tab. Lists user-imported themes from
   * `config.userThemes`, lets the user import new ones from
   * `.itermcolors` / base16 YAML files, and delete entries they no
   * longer want.
   *
   * Imports flow through `services/theme-importer.ts`, are saved to
   * config, and are registered with the theme-registry under
   * source="user" so they show up in the picker immediately. Deletes
   * tear down all "user" registrations and re-register the survivors —
   * the registry's `unregisterBySource` API is wholesale, but "user"
   * is reserved for this feature so the rebuild is cheap and clear.
   */
  import { theme } from "../stores/theme";
  import { configStore, getConfig, saveConfig } from "../config";
  import {
    registerTheme,
    unregisterThemesBySource,
  } from "../services/theme-registry";
  import {
    parseItermColors,
    parseBase16Yaml,
  } from "../services/theme-importer";
  import { showInputPrompt } from "../stores/ui";
  import type { ThemeDef } from "../theme-data";
  import { themes as builtInThemes } from "../theme-data";
  import { get } from "svelte/store";

  let importError = "";
  let fileInput: HTMLInputElement;

  $: userThemes = $configStore.userThemes ?? {};
  $: userThemeEntries = Object.entries(userThemes);

  function slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function pickUniqueId(base: string): string {
    if (!base) return `user-theme-${Date.now()}`;
    const cfg = getConfig();
    const existing = new Set([
      ...Object.keys(builtInThemes),
      ...Object.keys(cfg.userThemes ?? {}),
    ]);
    if (!existing.has(base)) return base;
    let n = 2;
    while (existing.has(`${base}-${n}`)) n++;
    return `${base}-${n}`;
  }

  function readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error("read failed"));
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.readAsText(file);
    });
  }

  function detectFormat(file: File, text: string): "iterm" | "base16" {
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".itermcolors")) return "iterm";
    if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "base16";
    // Content sniff fallback for files without recognized extensions.
    if (/<plist\b/i.test(text)) return "iterm";
    return "base16";
  }

  async function handleFilePicked(event: Event) {
    importError = "";
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    // Reset so picking the same file twice still fires `change`.
    input.value = "";
    if (!file) return;

    let text: string;
    try {
      text = await readFileAsText(file);
    } catch (err) {
      importError = `Failed to read file: ${err instanceof Error ? err.message : String(err)}`;
      return;
    }

    let parsed: ThemeDef;
    try {
      const fmt = detectFormat(file, text);
      parsed = fmt === "iterm" ? parseItermColors(text) : parseBase16Yaml(text);
    } catch (err) {
      importError = `Failed to parse theme: ${err instanceof Error ? err.message : String(err)}`;
      return;
    }

    const defaultName =
      parsed.name && parsed.name.startsWith("Imported ")
        ? file.name.replace(/\.[^.]+$/, "")
        : parsed.name;
    const name = await showInputPrompt("Theme name", defaultName);
    if (!name || !name.trim()) return;

    const finalName = name.trim();
    const baseSlug = slugify(finalName);
    if (!baseSlug) {
      importError = `Theme name "${finalName}" produces an empty id`;
      return;
    }
    const id = pickUniqueId(baseSlug);
    const themeWithName: ThemeDef = { ...parsed, name: finalName };

    try {
      registerTheme("user", id, themeWithName);
    } catch (err) {
      importError = `Theme failed validation: ${err instanceof Error ? err.message : String(err)}`;
      return;
    }

    const next = { ...(getConfig().userThemes ?? {}), [id]: themeWithName };
    await saveConfig({ userThemes: next });
  }

  async function handleDelete(id: string) {
    const cfg = getConfig();
    const next = { ...(cfg.userThemes ?? {}) };
    delete next[id];

    // Wholesale tear-down + rebuild — the registry only exposes a
    // by-source unregister, and "user" is reserved for this feature
    // so this stays scoped.
    unregisterThemesBySource("user");
    for (const [otherId, t] of Object.entries(next)) {
      try {
        registerTheme("user", otherId, t);
      } catch {
        // Already-stored themes were validated on import; ignore stragglers.
      }
    }

    // If the deleted theme was active, fall back to the default so
    // the chrome doesn't suddenly desaturate to an undefined state.
    // Reference equality works here because boot-time `registerTheme`
    // passes the same object stored in `config.userThemes[id]`, and
    // `theme.set(id)` resolves through that same registry entry.
    const live = get(theme);
    if (cfg.userThemes?.[id] && live === cfg.userThemes[id]) {
      theme.set("github-dark");
      await saveConfig({ userThemes: next, theme: "github-dark" });
    } else {
      await saveConfig({ userThemes: next });
    }
  }

  function triggerFilePicker() {
    importError = "";
    fileInput?.click();
  }
</script>

<div data-page="themes">
  <h3 style="margin: 0 0 16px; font-size: 14px; color: {$theme.fg};">Themes</h3>

  <p style="font-size: 11px; color: {$theme.fgDim}; margin: 0 0 12px;">
    Import <code>.itermcolors</code> or base16 YAML files. The importer derives
    sidebar/border tones from the bg/fg pair and reuses the ansi palette for
    accent and status colors. Hand-edit
    <code>userThemes</code> in settings.json for fine-tuning.
  </p>

  <div style="display: flex; gap: 8px; margin-bottom: 12px;">
    <button
      data-action="import-theme"
      on:click={triggerFilePicker}
      style="
        padding: 6px 12px; border-radius: 6px; font-size: 11px;
        border: 1px solid {$theme.border}; cursor: pointer;
        background: {$theme.bgSurface}; color: {$theme.fg};
      ">Import theme...</button
    >
    <input
      bind:this={fileInput}
      type="file"
      accept=".itermcolors,.yaml,.yml"
      on:change={handleFilePicked}
      style="display: none;"
    />
  </div>

  {#if importError}
    <div
      data-error="import"
      style="
        padding: 8px 12px; border-radius: 6px; margin-bottom: 12px;
        background: rgba(255,0,0,0.1); border: 1px solid {$theme.danger};
        color: {$theme.danger}; font-size: 11px;
      "
    >
      {importError}
    </div>
  {/if}

  {#if userThemeEntries.length === 0}
    <p style="font-size: 12px; color: {$theme.fgDim};">
      No imported themes yet
    </p>
  {:else}
    <div style="display: flex; flex-direction: column; gap: 8px;">
      {#each userThemeEntries as [id, t] (id)}
        <div
          style="
            display: flex; align-items: center; gap: 12px;
            padding: 10px 12px; border-radius: 8px;
            background: {$theme.bgSurface};
            border: 1px solid {$theme.border};
          "
        >
          <div
            aria-hidden="true"
            style="
              width: 28px; height: 28px; border-radius: 6px;
              border: 1px solid {$theme.border};
              background: linear-gradient(135deg, {t.bg} 50%, {t.accent} 50%);
            "
          ></div>
          <div style="flex: 1; min-width: 0;">
            <div style="font-size: 12px; font-weight: 500; color: {$theme.fg};">
              {t.name}
            </div>
            <div
              style="font-size: 10px; color: {$theme.fgDim}; margin-top: 2px;"
            >
              {id}
            </div>
          </div>
          <button
            data-theme-delete={id}
            on:click={() => handleDelete(id)}
            style="
              padding: 4px 10px; border-radius: 6px; font-size: 11px;
              border: 1px solid {$theme.border}; cursor: pointer;
              background: transparent; color: {$theme.danger};
            ">Delete</button
          >
        </div>
      {/each}
    </div>
  {/if}
</div>
