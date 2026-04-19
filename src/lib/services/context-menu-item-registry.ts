/**
 * Extension Context Menu Item Registry — store-based registration of
 * context menu items contributed by extensions.
 *
 * Extensions register items with a "when" pattern (file extension glob)
 * and a handler. When a context menu is triggered (e.g., right-click on
 * a file), the registry resolves which items match the given file path.
 *
 * Supported "when" patterns:
 *   "*"              — matches all files
 *   "*.md"           — matches files ending in .md
 *   "*.{png,jpg,gif}" — matches files ending in png, jpg, or gif
 */
import { get } from "svelte/store";
import { createRegistry, type RegistryItem } from "./create-registry";

// --- Types ---

export interface ExtensionContextMenuItem extends RegistryItem {
  label: string;
  when: string; // glob pattern: "*", "*.md", "*.{png,jpg}", "directory"
  handler: (filePath: string) => void | Promise<void>;
}

// --- Registry ---

const registry = createRegistry<ExtensionContextMenuItem>();

export const contextMenuItemStore = registry.store;
export const registerContextMenuItem = registry.register;
export const unregisterContextMenuItemsBySource = registry.unregisterBySource;
export const resetContextMenuItems = registry.reset;

// --- Matching ---

/**
 * Get all registered context menu items that match a given file path.
 */
export function getContextMenuItemsForFile(
  filePath: string,
): ExtensionContextMenuItem[] {
  const items = get(registry.store);
  const fileName = filePath.split("/").pop() || filePath;
  return items.filter(
    (item) => item.when !== "directory" && matchesWhen(fileName, item.when),
  );
}

/**
 * Get all registered context menu items that match a directory.
 */
export function getContextMenuItemsForDir(
  _dirPath: string,
): ExtensionContextMenuItem[] {
  const items = get(registry.store);
  return items.filter((item) => item.when === "directory");
}

/**
 * Test if a filename matches a "when" glob pattern.
 * Supports: "*" (all), "*.ext", "*.{ext1,ext2,ext3}"
 */
function matchesWhen(fileName: string, pattern: string): boolean {
  if (pattern === "*") return true;

  const lowerName = fileName.toLowerCase();

  // "*.{png,jpg,gif}" → expand to list of extensions
  const braceMatch = pattern.match(/^\*\.\{(.+)\}$/);
  if (braceMatch) {
    const exts = braceMatch[1]!.split(",").map((e) => e.trim().toLowerCase());
    return exts.some((ext) => lowerName.endsWith("." + ext));
  }

  // "*.md" → simple extension match
  const simpleMatch = pattern.match(/^\*\.(.+)$/);
  if (simpleMatch) {
    return lowerName.endsWith("." + simpleMatch[1]!.toLowerCase());
  }

  return false;
}

/**
 * Validate a `when` glob pattern.
 * Returns null when valid, an error message otherwise.
 * Surfaced at registration time in extension-api-ui so authors hear about
 * typos (`*.{md,}`, `**.md`) instead of silently registering dead items.
 */
export function validateWhenPattern(pattern: string): string | null {
  if (pattern === "*" || pattern === "directory") return null;

  const braceMatch = pattern.match(/^\*\.\{(.+)\}$/);
  if (braceMatch) {
    const exts = braceMatch[1]!.split(",").map((e) => e.trim());
    if (exts.length === 0 || exts.some((e) => e.length === 0)) {
      return `Invalid brace-extension pattern "${pattern}": empty extension in list`;
    }
    return null;
  }

  if (/^\*\.[^*{}\s]+$/.test(pattern)) return null;

  return `Unsupported "when" pattern "${pattern}": use "*", "*.ext", "*.{ext1,ext2}", or "directory"`;
}

/**
 * Return the deduped, lowercased union of file extensions referenced by all
 * registered context-menu items. Derived from `when` patterns of the form
 * `*.ext` or `*.{ext1,ext2,...}`; `*` and `directory` patterns contribute
 * nothing.
 *
 * Used by terminal-service to build its link-detection regex without needing
 * to know which extensions contributed which file types.
 */
export function getRegisteredFileExtensions(): string[] {
  const items = get(registry.store);
  const seen = new Set<string>();
  for (const item of items) {
    const p = item.when;
    if (p === "*" || p === "directory") continue;
    const brace = p.match(/^\*\.\{(.+)\}$/);
    if (brace) {
      for (const ext of brace[1]!.split(",")) {
        const trimmed = ext.trim().toLowerCase();
        if (trimmed) seen.add(trimmed);
      }
      continue;
    }
    const simple = p.match(/^\*\.(.+)$/);
    if (simple) {
      seen.add(simple[1]!.toLowerCase());
    }
  }
  return [...seen];
}
