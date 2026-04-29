/**
 * Shortcut matcher — parses keyboard-shortcut strings and matches them against
 * KeyboardEvents. Shared by the command registry and the workspace-action
 * registry so any surface with a `shortcut` field can be wired to keydown
 * identically.
 *
 * Supported formats (either, mixed freely):
 *   "⌘⇧P"        — Mac symbols: ⌘=meta, ⇧=shift, ⌥=alt, ⌃=ctrl
 *   "Ctrl+Shift+P" — word format; tokens "ctrl", "shift", "alt", "meta"/"cmd"
 */

interface KeyDescriptor {
  key: string;
  meta: boolean;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

function parseShortcut(shortcut: string): KeyDescriptor | null {
  if (!shortcut) return null;

  let meta = false;
  let ctrl = false;
  let shift = false;
  let alt = false;

  let s = shortcut;
  if (s.includes("⌘")) {
    meta = true;
    s = s.replaceAll("⌘", "");
  }
  if (s.includes("⇧")) {
    shift = true;
    s = s.replaceAll("⇧", "");
  }
  if (s.includes("⌥")) {
    alt = true;
    s = s.replaceAll("⌥", "");
  }
  if (s.includes("⌃")) {
    ctrl = true;
    s = s.replaceAll("⌃", "");
  }

  const parts = s
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
  for (let i = 0; i < parts.length - 1; i++) {
    const mod = parts[i]!.toLowerCase();
    if (mod === "ctrl") ctrl = true;
    else if (mod === "shift") shift = true;
    else if (mod === "alt") alt = true;
    else if (mod === "meta" || mod === "cmd") meta = true;
  }

  const key = parts[parts.length - 1];
  if (!key) return null;

  return { key: key.toLowerCase(), meta, ctrl, shift, alt };
}

export function matchesShortcut(shortcut: string, e: KeyboardEvent): boolean {
  const desc = parseShortcut(shortcut);
  if (!desc) return false;
  return (
    e.key.toLowerCase() === desc.key &&
    e.metaKey === desc.meta &&
    e.ctrlKey === desc.ctrl &&
    e.shiftKey === desc.shift &&
    e.altKey === desc.alt
  );
}
