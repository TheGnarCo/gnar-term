/**
 * Theme importer — parses two community theme formats into the chrome-
 * complete ThemeDef shape that GnarTerm's theme registry validates and
 * renders.
 *
 * Supported inputs:
 *   - `.itermcolors` — Apple plist XML with `Background Color`,
 *     `Foreground Color`, `Cursor Color`, `Selection Color`,
 *     `Ansi 0`–`Ansi 15 Color` dicts. Each dict carries
 *     `Red Component` / `Green Component` / `Blue Component` floats
 *     in `[0, 1]`.
 *   - `base16-builder` YAML — `base00`..`base0F` hex strings (with or
 *     without quotes), plus an optional `scheme:` name.
 *
 * Both formats only carry terminal colors; the rest of the GnarTerm
 * chrome (sidebars, borders, accents, etc.) is derived deterministically
 * via `deriveChrome` so an imported theme renders end-to-end without
 * authoring effort. The mapping is opinionated but consistent:
 *   - bg/fg pass through
 *   - sidebars / surfaces / floats: bg lifted slightly toward fg
 *   - accents (accent / borderActive / notify): ansi.blue
 *   - status colors (danger / success / warning): ansi.red / green / yellow
 *
 * Both parsers throw on malformed input and on missing required colors;
 * the result is then independently re-checked by `validateTheme()` at
 * register-time so authoring mistakes surface as readable errors.
 */
import type { ThemeDef } from "../theme-data";

/**
 * iTerm `Ansi N Color` index (0–15) → ThemeDef ansi key.
 */
const ANSI_INDEX_TO_KEY: ReadonlyArray<keyof ThemeDef["ansi"]> = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
];

// --- Color helpers ---

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function toHexByte(n: number): string {
  const v = Math.round(clamp01(n) * 255);
  return v.toString(16).padStart(2, "0");
}

function rgbFloatToHex(r: number, g: number, b: number): string {
  return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
}

function parseHex(hex: string): [number, number, number] {
  const cleaned = hex.replace(/^#/, "").trim().toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(cleaned)) {
    throw new Error(`invalid hex color: "${hex}"`);
  }
  return [
    parseInt(cleaned.slice(0, 2), 16),
    parseInt(cleaned.slice(2, 4), 16),
    parseInt(cleaned.slice(4, 6), 16),
  ];
}

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Linearly blend two hex colors. `t=0` returns `a`, `t=1` returns `b`.
 * Used to lift surface tones from bg toward fg without requiring the
 * source format to specify them.
 */
function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  return toHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// --- Chrome derivation ---

interface ChromeInputs {
  name: string;
  bg: string;
  fg: string;
  termCursor: string;
  termSelection: string;
  ansi: ThemeDef["ansi"];
}

/**
 * Builds a complete ThemeDef from the few fields a community theme
 * format actually provides. The strategy is intentionally simple: one
 * `mix(bg, fg, t)` curve drives all surface/border tones, and the
 * accent/status hues come straight from the ansi palette. Fine-tuning
 * is left to the user (they can always hand-edit `userThemes` in
 * settings.json).
 */
function deriveChrome(inputs: ChromeInputs): ThemeDef {
  const { name, bg, fg, termCursor, termSelection, ansi } = inputs;

  const bgSurface = mix(bg, fg, 0.06);
  const bgFloat = mix(bg, fg, 0.12);
  const bgHighlight = mix(bg, fg, 0.2);
  const bgActive = mix(bg, fg, 0.12);
  const border = mix(bg, fg, 0.25);
  const sidebarBg = mix(bg, fg, 0.03);
  const sidebarBorder = mix(bg, fg, 0.1);
  const tabBarBg = bgSurface;
  const tabBarBorder = sidebarBorder;
  const fgMuted = mix(fg, bg, 0.35);
  const fgDim = mix(fg, bg, 0.55);

  return {
    name,
    bg,
    bgSurface,
    bgFloat,
    bgHighlight,
    bgActive,
    border,
    borderActive: ansi.blue,
    borderNotify: ansi.blue,
    fg,
    fgMuted,
    fgDim,
    accent: ansi.blue,
    accentHover: ansi.brightBlue,
    notify: ansi.blue,
    notifyGlow: rgba(ansi.blue, 0.25),
    danger: ansi.red,
    success: ansi.green,
    warning: ansi.yellow,
    termBg: bg,
    termFg: fg,
    termCursor,
    termSelection,
    sidebarBg,
    sidebarBorder,
    tabBarBg,
    tabBarBorder,
    dashboardIcon: "lucide:layout-dashboard",
    ansi,
  };
}

// --- .itermcolors (XML plist) ---

/**
 * Walks an iTerm plist `<dict>` whose top-level keys are color names
 * pointing at `<dict>` children with `Red/Green/Blue Component` reals.
 * Returns a flat `{ "Background Color": "#rrggbb", ... }` map.
 */
function readPlistColorMap(xml: string): Record<string, string> {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const parserError = doc.querySelector("parsererror");
  if (parserError) {
    throw new Error(
      `malformed XML: ${parserError.textContent ?? "parse error"}`,
    );
  }
  const root = doc.querySelector("plist > dict");
  if (!root) {
    throw new Error("plist must contain a top-level <dict>");
  }

  const out: Record<string, string> = {};
  const children = Array.from(root.children);
  for (let i = 0; i < children.length; i += 2) {
    const keyEl = children[i];
    const valEl = children[i + 1];
    if (!keyEl || !valEl) break;
    if (keyEl.tagName.toLowerCase() !== "key") continue;
    if (valEl.tagName.toLowerCase() !== "dict") continue;
    const name = keyEl.textContent?.trim() ?? "";
    if (!name) continue;

    let r = NaN;
    let g = NaN;
    let b = NaN;
    const dictChildren = Array.from(valEl.children);
    for (let j = 0; j < dictChildren.length; j += 2) {
      const k = dictChildren[j];
      const v = dictChildren[j + 1];
      if (!k || !v) break;
      const compName = k.textContent?.trim() ?? "";
      const compVal = parseFloat(v.textContent ?? "");
      if (compName === "Red Component") r = compVal;
      else if (compName === "Green Component") g = compVal;
      else if (compName === "Blue Component") b = compVal;
    }
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) continue;
    out[name] = rgbFloatToHex(r, g, b);
  }
  return out;
}

/**
 * Parses an iTerm `.itermcolors` XML plist into a complete ThemeDef.
 * Throws when required keys are missing so the importer surface can
 * show a clear error rather than registering a half-baked theme.
 *
 * The returned theme's `name` is a placeholder — the UI prompts the
 * user for a display name and overwrites it before persisting.
 */
export function parseItermColors(xmlText: string): ThemeDef {
  const colors = readPlistColorMap(xmlText);

  const bg = colors["Background Color"];
  const fg = colors["Foreground Color"];
  if (!bg) throw new Error("Background Color is required");
  if (!fg) throw new Error("Foreground Color is required");

  const ansi: Partial<ThemeDef["ansi"]> = {};
  for (let i = 0; i < 16; i++) {
    const key = `Ansi ${i} Color`;
    const val = colors[key];
    if (!val) throw new Error(`${key} is required`);
    const ansiKey = ANSI_INDEX_TO_KEY[i];
    if (!ansiKey) throw new Error(`unexpected ansi index ${i}`);
    ansi[ansiKey] = val;
  }

  const termCursor = colors["Cursor Color"] ?? fg;
  const termSelection = colors["Selection Color"] ?? mix(bg, fg, 0.25);

  return deriveChrome({
    name: "Imported iTerm Theme",
    bg,
    fg,
    termCursor,
    termSelection,
    ansi: ansi as ThemeDef["ansi"],
  });
}

// --- base16 YAML ---

function parseBase16Map(yamlText: string): {
  scheme?: string;
  bases: Record<string, string>;
} {
  const bases: Record<string, string> = {};
  let scheme: string | undefined;
  // Two-pass parse per line: split key/value at the first ":", then
  // strip a comment tail and optional surrounding quotes on the value.
  // This avoids the backtracking regex form ESLint's
  // security/detect-unsafe-regex flags.
  for (const raw of yamlText.split(/\r?\n/)) {
    const trimmed = raw.trimStart();
    const colonAt = trimmed.indexOf(":");
    if (colonAt <= 0) continue;
    const key = trimmed.slice(0, colonAt).trim();
    if (!/^[A-Za-z0-9_-]+$/.test(key)) continue;
    let val = trimmed.slice(colonAt + 1);
    // Drop comment tail.
    const hashAt = val.indexOf("#");
    if (hashAt !== -1) val = val.slice(0, hashAt);
    val = val.trim();
    // Strip a single surrounding pair of double quotes if present.
    if (val.length >= 2 && val.startsWith('"') && val.endsWith('"')) {
      val = val.slice(1, -1);
    }
    if (!val) continue;
    if (key === "scheme" || key === "name") {
      scheme = val;
    } else if (/^base0[0-9A-Fa-f]$/.test(key)) {
      bases[key.toLowerCase()] = val;
    }
  }
  return { scheme, bases };
}

function ensureBase(bases: Record<string, string>, key: string): string {
  const v = bases[key.toLowerCase()];
  if (!v) throw new Error(`${key} is required`);
  return `#${v.replace(/^#/, "").toLowerCase()}`;
}

/**
 * Parses a base16-builder YAML scheme into a complete ThemeDef.
 *
 * base16 spec mapping (community convention):
 *   base00 → bg / termBg
 *   base01..base04 → grayscale ramp (used internally for derived chrome)
 *   base05 → fg / termFg
 *   base08 → red, base09 → orange, base0A → yellow, base0B → green,
 *   base0C → cyan, base0D → blue, base0E → magenta, base0F → brown
 *
 * Bright variants reuse the same hues — most base16 schemes don't
 * supply distinct brights, and reuse is what every base16 terminal
 * template ships with.
 */
export function parseBase16Yaml(yamlText: string): ThemeDef {
  const { scheme, bases } = parseBase16Map(yamlText);

  const bg = ensureBase(bases, "base00");
  const fg = ensureBase(bases, "base05");
  const base02 = ensureBase(bases, "base02");
  const red = ensureBase(bases, "base08");
  const yellow = ensureBase(bases, "base0a");
  const green = ensureBase(bases, "base0b");
  const cyan = ensureBase(bases, "base0c");
  const blue = ensureBase(bases, "base0d");
  const magenta = ensureBase(bases, "base0e");
  // Required by the spec — ensures the file is actually a base16 scheme
  // rather than a partial fragment.
  ensureBase(bases, "base09");
  ensureBase(bases, "base0f");

  const ansi: ThemeDef["ansi"] = {
    black: ensureBase(bases, "base01"),
    red,
    green,
    yellow,
    blue,
    magenta,
    cyan,
    white: fg,
    brightBlack: base02,
    brightRed: red,
    brightGreen: green,
    brightYellow: yellow,
    brightBlue: blue,
    brightMagenta: magenta,
    brightCyan: cyan,
    brightWhite: ensureBase(bases, "base07"),
  };

  return deriveChrome({
    name: scheme ?? "Imported base16 Theme",
    bg,
    fg,
    termCursor: fg,
    termSelection: base02,
    ansi,
  });
}
