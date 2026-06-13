/**
 * Path resolution and font detection helpers.
 *
 * Leaf module — no dependencies on other terminal/* modules so it can be
 * imported freely without risking circular references.
 */
import { invoke } from "@tauri-apps/api/core";

/** Resolve a link path to an absolute filesystem path. Expands ~ and prepends cwd for relative paths. */
export async function resolveFilePath(linkText: string, cwd: string | undefined): Promise<string> {
  if (linkText.startsWith("/")) return linkText;
  if (linkText.startsWith("~/")) {
    try {
      const home = await invoke<string>("get_home");
      return home + linkText.slice(1);
    } catch {
      return linkText;
    }
  }
  if (cwd) {
    const base = cwd.endsWith("/") ? cwd.slice(0, -1) : cwd;
    return `${base}/${linkText}`;
  }
  return linkText;
}

// --- Font Detection ---

const BUNDLED_FONT = '"JetBrainsMono Nerd Font Mono"';
const SYSTEM_FALLBACK = 'Menlo, "DejaVu Sans Mono", monospace';
export let resolvedFontFamily = `${BUNDLED_FONT}, ${SYSTEM_FALLBACK}`;

async function detectFont(): Promise<string> {
  try {
    const font = await invoke<string>("detect_font");
    if (font) {
      return `"${font}", ${BUNDLED_FONT}, ${SYSTEM_FALLBACK}`;
    }
  } catch (_) {
    // Font detection not available — use bundled font
  }
  return `${BUNDLED_FONT}, ${SYSTEM_FALLBACK}`;
}

export const fontReady = detectFont().then((f) => { resolvedFontFamily = f; });
