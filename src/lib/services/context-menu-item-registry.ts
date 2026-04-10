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
  handler: (filePath: string) => void;
}

// --- Registry ---

const registry = createRegistry<ExtensionContextMenuItem>();

export const contextMenuItemStore = registry.store;
export const registerContextMenuItem = registry.register;
export const unregisterContextMenuItem = registry.unregister;
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
    const exts = braceMatch[1].split(",").map((e) => e.trim().toLowerCase());
    return exts.some((ext) => lowerName.endsWith("." + ext));
  }

  // "*.md" → simple extension match
  const simpleMatch = pattern.match(/^\*\.(.+)$/);
  if (simpleMatch) {
    return lowerName.endsWith("." + simpleMatch[1].toLowerCase());
  }

  return false;
}
