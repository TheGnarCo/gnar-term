/**
 * Color system — three tiers, resolved in this order:
 *
 *   1. Semantic variants (status-colors.ts `VARIANT_COLORS`) — success /
 *      warning / error / muted. Fixed hex values; **immutable across
 *      themes** by design, so status affordances stay legible everywhere.
 *   2. Theme colors (`ThemeDef` below) — bg / fg / accent / ansi blocks.
 *      User-selectable via the theme picker; extensions may contribute
 *      new themes via `ExtensionAPI.registerTheme`.
 *   3. Group color slots (`GROUP_COLOR_SLOTS` in extensions/api.ts) —
 *      semantic names (red / mint / lavender / …) resolved through the
 *      active theme's ansi palette. Custom `#hex` strings pass through.
 *
 * Tier 1 never consults tiers 2/3. Tier 3 always resolves through tier 2.
 */
export interface ThemeDef {
  name: string;
  // UI chrome
  bg: string;
  bgSurface: string;
  bgFloat: string;
  bgHighlight: string;
  bgActive: string;
  border: string;
  borderActive: string;
  borderNotify: string;
  fg: string;
  fgMuted: string;
  fgDim: string;
  accent: string;
  accentHover: string;
  notify: string;
  notifyGlow: string;
  danger: string;
  success: string;
  warning: string;
  termBg: string;
  termFg: string;
  termCursor: string;
  termSelection: string;
  sidebarBg: string;
  sidebarBorder: string;
  tabBarBg: string;
  tabBarBorder: string;
  /**
   * Glyph used for dashboard rows in the sidebar. Either an icon name
   * (currently only `lucide:layout-dashboard` is recognized — the row
   * falls back to an inline SVG if the name is unknown) or a literal
   * emoji / single-grapheme string rendered as text.
   */
  dashboardIcon: string;
  // ANSI colors
  ansi: {
    black: string;
    red: string;
    green: string;
    yellow: string;
    blue: string;
    magenta: string;
    cyan: string;
    white: string;
    brightBlack: string;
    brightRed: string;
    brightGreen: string;
    brightYellow: string;
    brightBlue: string;
    brightMagenta: string;
    brightCyan: string;
    brightWhite: string;
  };
}

// --- Theme Presets ---

const githubDark: ThemeDef = {
  name: "GitHub Dark",
  bg: "#161b22",
  bgSurface: "#1c2128",
  bgFloat: "#2d333b",
  bgHighlight: "#373e47",
  bgActive: "#2d333b",
  border: "#444c56",
  borderActive: "#58a6ff",
  borderNotify: "#58a6ff",
  fg: "#e6edf3",
  fgMuted: "#8b949e",
  fgDim: "#636e7b",
  accent: "#58a6ff",
  accentHover: "#79c0ff",
  notify: "#58a6ff",
  notifyGlow: "rgba(88, 166, 255, 0.25)",
  danger: "#f85149",
  success: "#3fb950",
  warning: "#d29922",
  termBg: "#161b22",
  termFg: "#e6edf3",
  termCursor: "#e6edf3",
  termSelection: "#264f78",
  sidebarBg: "#0d1117",
  sidebarBorder: "#21262d",
  tabBarBg: "#1c2128",
  tabBarBorder: "#21262d",
  dashboardIcon: "lucide:layout-dashboard",
  ansi: {
    black: "#484f58",
    red: "#ff7b72",
    green: "#3fb950",
    yellow: "#d29922",
    blue: "#58a6ff",
    magenta: "#bc8cff",
    cyan: "#39c5cf",
    white: "#b1bac4",
    brightBlack: "#6e7681",
    brightRed: "#ffa198",
    brightGreen: "#56d364",
    brightYellow: "#e3b341",
    brightBlue: "#79c0ff",
    brightMagenta: "#d2a8ff",
    brightCyan: "#56d4dd",
    brightWhite: "#f0f6fc",
  },
};

const tokyoNight: ThemeDef = {
  name: "Tokyo Night",
  bg: "#1a1b26",
  bgSurface: "#1f2335",
  bgFloat: "#292e42",
  bgHighlight: "#33467c",
  bgActive: "#292e42",
  border: "#3b4261",
  borderActive: "#7aa2f7",
  borderNotify: "#7aa2f7",
  fg: "#c0caf5",
  fgMuted: "#9aa5ce",
  fgDim: "#565f89",
  accent: "#7aa2f7",
  accentHover: "#89b4fa",
  notify: "#7aa2f7",
  notifyGlow: "rgba(122, 162, 247, 0.25)",
  danger: "#f7768e",
  success: "#9ece6a",
  warning: "#e0af68",
  termBg: "#1a1b26",
  termFg: "#c0caf5",
  termCursor: "#c0caf5",
  termSelection: "#33467c",
  sidebarBg: "#16161e",
  sidebarBorder: "#1f2335",
  tabBarBg: "#1f2335",
  tabBarBorder: "#1f2335",
  dashboardIcon: "lucide:layout-dashboard",
  ansi: {
    black: "#414868",
    red: "#f7768e",
    green: "#9ece6a",
    yellow: "#e0af68",
    blue: "#7aa2f7",
    magenta: "#bb9af7",
    cyan: "#7dcfff",
    white: "#a9b1d6",
    brightBlack: "#565f89",
    brightRed: "#f7768e",
    brightGreen: "#9ece6a",
    brightYellow: "#e0af68",
    brightBlue: "#7aa2f7",
    brightMagenta: "#bb9af7",
    brightCyan: "#7dcfff",
    brightWhite: "#c0caf5",
  },
};

const catppuccinMocha: ThemeDef = {
  name: "Catppuccin Mocha",
  bg: "#1e1e2e",
  bgSurface: "#24243e",
  bgFloat: "#313244",
  bgHighlight: "#45475a",
  bgActive: "#313244",
  border: "#45475a",
  borderActive: "#89b4fa",
  borderNotify: "#89b4fa",
  fg: "#cdd6f4",
  fgMuted: "#a6adc8",
  fgDim: "#6c7086",
  accent: "#89b4fa",
  accentHover: "#b4d0fb",
  notify: "#89b4fa",
  notifyGlow: "rgba(137, 180, 250, 0.25)",
  danger: "#f38ba8",
  success: "#a6e3a1",
  warning: "#f9e2af",
  termBg: "#1e1e2e",
  termFg: "#cdd6f4",
  termCursor: "#f5e0dc",
  termSelection: "#45475a",
  sidebarBg: "#181825",
  sidebarBorder: "#1e1e2e",
  tabBarBg: "#24243e",
  tabBarBorder: "#1e1e2e",
  dashboardIcon: "lucide:layout-dashboard",
  ansi: {
    black: "#45475a",
    red: "#f38ba8",
    green: "#a6e3a1",
    yellow: "#f9e2af",
    blue: "#89b4fa",
    magenta: "#cba6f7",
    cyan: "#94e2d5",
    white: "#bac2de",
    brightBlack: "#585b70",
    brightRed: "#f38ba8",
    brightGreen: "#a6e3a1",
    brightYellow: "#f9e2af",
    brightBlue: "#89b4fa",
    brightMagenta: "#cba6f7",
    brightCyan: "#94e2d5",
    brightWhite: "#a6adc8",
  },
};

const draculaPro: ThemeDef = {
  name: "Dracula",
  bg: "#282a36",
  bgSurface: "#2d2f3d",
  bgFloat: "#383a4a",
  bgHighlight: "#44475a",
  bgActive: "#383a4a",
  border: "#44475a",
  borderActive: "#bd93f9",
  borderNotify: "#bd93f9",
  fg: "#f8f8f2",
  fgMuted: "#bfbfbf",
  fgDim: "#6272a4",
  accent: "#bd93f9",
  accentHover: "#caa9fa",
  notify: "#bd93f9",
  notifyGlow: "rgba(189, 147, 249, 0.25)",
  danger: "#ff5555",
  success: "#50fa7b",
  warning: "#f1fa8c",
  termBg: "#282a36",
  termFg: "#f8f8f2",
  termCursor: "#f8f8f2",
  termSelection: "#44475a",
  sidebarBg: "#21222c",
  sidebarBorder: "#282a36",
  tabBarBg: "#2d2f3d",
  tabBarBorder: "#282a36",
  dashboardIcon: "lucide:layout-dashboard",
  ansi: {
    black: "#44475a",
    red: "#ff5555",
    green: "#50fa7b",
    yellow: "#f1fa8c",
    blue: "#6272a4",
    magenta: "#ff79c6",
    cyan: "#8be9fd",
    white: "#f8f8f2",
    brightBlack: "#6272a4",
    brightRed: "#ff6e6e",
    brightGreen: "#69ff94",
    brightYellow: "#ffffa5",
    brightBlue: "#d6acff",
    brightMagenta: "#ff92df",
    brightCyan: "#a4ffff",
    brightWhite: "#ffffff",
  },
};

const solarizedDark: ThemeDef = {
  name: "Solarized Dark",
  bg: "#002b36",
  bgSurface: "#073642",
  bgFloat: "#0a4050",
  bgHighlight: "#1a5060",
  bgActive: "#073642",
  border: "#586e75",
  borderActive: "#268bd2",
  borderNotify: "#268bd2",
  fg: "#839496",
  fgMuted: "#657b83",
  fgDim: "#586e75",
  accent: "#268bd2",
  accentHover: "#2aa0e8",
  notify: "#268bd2",
  notifyGlow: "rgba(38, 139, 210, 0.25)",
  danger: "#dc322f",
  success: "#859900",
  warning: "#b58900",
  termBg: "#002b36",
  termFg: "#839496",
  termCursor: "#839496",
  termSelection: "#073642",
  sidebarBg: "#001e26",
  sidebarBorder: "#002b36",
  tabBarBg: "#073642",
  tabBarBorder: "#002b36",
  dashboardIcon: "lucide:layout-dashboard",
  ansi: {
    black: "#073642",
    red: "#dc322f",
    green: "#859900",
    yellow: "#b58900",
    blue: "#268bd2",
    magenta: "#d33682",
    cyan: "#2aa198",
    white: "#eee8d5",
    brightBlack: "#586e75",
    brightRed: "#cb4b16",
    brightGreen: "#859900",
    brightYellow: "#b58900",
    brightBlue: "#268bd2",
    brightMagenta: "#6c71c4",
    brightCyan: "#2aa198",
    brightWhite: "#fdf6e3",
  },
};

const oneDark: ThemeDef = {
  name: "One Dark",
  bg: "#282c34",
  bgSurface: "#2c313c",
  bgFloat: "#353b45",
  bgHighlight: "#3e4452",
  bgActive: "#353b45",
  border: "#3e4452",
  borderActive: "#61afef",
  borderNotify: "#61afef",
  fg: "#abb2bf",
  fgMuted: "#8b929e",
  fgDim: "#5c6370",
  accent: "#61afef",
  accentHover: "#74bef4",
  notify: "#61afef",
  notifyGlow: "rgba(97, 175, 239, 0.25)",
  danger: "#e06c75",
  success: "#98c379",
  warning: "#e5c07b",
  termBg: "#282c34",
  termFg: "#abb2bf",
  termCursor: "#528bff",
  termSelection: "#3e4452",
  sidebarBg: "#21252b",
  sidebarBorder: "#282c34",
  tabBarBg: "#2c313c",
  tabBarBorder: "#282c34",
  dashboardIcon: "lucide:layout-dashboard",
  ansi: {
    black: "#3e4452",
    red: "#e06c75",
    green: "#98c379",
    yellow: "#e5c07b",
    blue: "#61afef",
    magenta: "#c678dd",
    cyan: "#56b6c2",
    white: "#abb2bf",
    brightBlack: "#5c6370",
    brightRed: "#be5046",
    brightGreen: "#98c379",
    brightYellow: "#d19a66",
    brightBlue: "#61afef",
    brightMagenta: "#c678dd",
    brightCyan: "#56b6c2",
    brightWhite: "#ffffff",
  },
};

// --- Light Themes ---

const molly: ThemeDef = {
  name: "Molly",
  bg: "#faf8f5",
  bgSurface: "#f0ece6",
  bgFloat: "#e8e3db",
  bgHighlight: "#e0d9cf",
  bgActive: "#ebe5dc",
  border: "#d4cdc3",
  borderActive: "#c47d5a",
  borderNotify: "#c47d5a",
  fg: "#3b3228",
  fgMuted: "#7a7067",
  fgDim: "#a89f96",
  accent: "#c47d5a",
  accentHover: "#b06840",
  notify: "#c47d5a",
  notifyGlow: "rgba(196, 125, 90, 0.2)",
  danger: "#c4453a",
  success: "#5a8a3c",
  warning: "#b8860b",
  termBg: "#faf8f5",
  termFg: "#3b3228",
  termCursor: "#c47d5a",
  termSelection: "#e0d5c8",
  sidebarBg: "#f4f0ea",
  sidebarBorder: "#e0d9cf",
  tabBarBg: "#f0ece6",
  tabBarBorder: "#e0d9cf",
  dashboardIcon: "lucide:layout-dashboard",
  ansi: {
    black: "#3b3228",
    red: "#c4453a",
    green: "#5a8a3c",
    yellow: "#b8860b",
    blue: "#4a6fa5",
    magenta: "#945e80",
    cyan: "#4e8a7c",
    white: "#f0ece6",
    brightBlack: "#7a7067",
    brightRed: "#d4574c",
    brightGreen: "#6a9a4c",
    brightYellow: "#c89620",
    brightBlue: "#5a7fb5",
    brightMagenta: "#a46e90",
    brightCyan: "#5e9a8c",
    brightWhite: "#faf8f5",
  },
};

const githubLight: ThemeDef = {
  name: "GitHub Light",
  bg: "#ffffff",
  bgSurface: "#f6f8fa",
  bgFloat: "#eaeef2",
  bgHighlight: "#d0d7de",
  bgActive: "#ddf4ff",
  border: "#d0d7de",
  borderActive: "#0969da",
  borderNotify: "#0969da",
  fg: "#1f2328",
  fgMuted: "#656d76",
  fgDim: "#8b949e",
  accent: "#0969da",
  accentHover: "#0550ae",
  notify: "#0969da",
  notifyGlow: "rgba(9, 105, 218, 0.15)",
  danger: "#cf222e",
  success: "#1a7f37",
  warning: "#9a6700",
  termBg: "#ffffff",
  termFg: "#1f2328",
  termCursor: "#0969da",
  termSelection: "#ddf4ff",
  sidebarBg: "#f6f8fa",
  sidebarBorder: "#d0d7de",
  tabBarBg: "#f6f8fa",
  tabBarBorder: "#d0d7de",
  dashboardIcon: "lucide:layout-dashboard",
  ansi: {
    black: "#24292f",
    red: "#cf222e",
    green: "#1a7f37",
    yellow: "#9a6700",
    blue: "#0969da",
    magenta: "#8250df",
    cyan: "#1b7c83",
    white: "#6e7781",
    brightBlack: "#57606a",
    brightRed: "#a40e26",
    brightGreen: "#2da44e",
    brightYellow: "#bf8700",
    brightBlue: "#218bff",
    brightMagenta: "#a475f9",
    brightCyan: "#3192aa",
    brightWhite: "#8c959f",
  },
};

const solarizedLight: ThemeDef = {
  name: "Solarized Light",
  bg: "#fdf6e3",
  bgSurface: "#eee8d5",
  bgFloat: "#e6dfcb",
  bgHighlight: "#d6cdb7",
  bgActive: "#eee8d5",
  border: "#d3cbb7",
  borderActive: "#268bd2",
  borderNotify: "#268bd2",
  fg: "#657b83",
  fgMuted: "#93a1a1",
  fgDim: "#b0bfbf",
  accent: "#268bd2",
  accentHover: "#2aa0e8",
  notify: "#268bd2",
  notifyGlow: "rgba(38, 139, 210, 0.15)",
  danger: "#dc322f",
  success: "#859900",
  warning: "#b58900",
  termBg: "#fdf6e3",
  termFg: "#657b83",
  termCursor: "#657b83",
  termSelection: "#eee8d5",
  sidebarBg: "#eee8d5",
  sidebarBorder: "#d3cbb7",
  tabBarBg: "#eee8d5",
  tabBarBorder: "#d3cbb7",
  dashboardIcon: "lucide:layout-dashboard",
  ansi: {
    black: "#073642",
    red: "#dc322f",
    green: "#859900",
    yellow: "#b58900",
    blue: "#268bd2",
    magenta: "#d33682",
    cyan: "#2aa198",
    white: "#eee8d5",
    brightBlack: "#586e75",
    brightRed: "#cb4b16",
    brightGreen: "#859900",
    brightYellow: "#b58900",
    brightBlue: "#268bd2",
    brightMagenta: "#6c71c4",
    brightCyan: "#2aa198",
    brightWhite: "#fdf6e3",
  },
};

const catppuccinLatte: ThemeDef = {
  name: "Catppuccin Latte",
  bg: "#eff1f5",
  bgSurface: "#e6e9ef",
  bgFloat: "#dce0e8",
  bgHighlight: "#ccd0da",
  bgActive: "#dce0e8",
  border: "#bcc0cc",
  borderActive: "#1e66f5",
  borderNotify: "#1e66f5",
  fg: "#4c4f69",
  fgMuted: "#6c6f85",
  fgDim: "#9ca0b0",
  accent: "#1e66f5",
  accentHover: "#2a6ff7",
  notify: "#1e66f5",
  notifyGlow: "rgba(30, 102, 245, 0.15)",
  danger: "#d20f39",
  success: "#40a02b",
  warning: "#df8e1d",
  termBg: "#eff1f5",
  termFg: "#4c4f69",
  termCursor: "#dc8a78",
  termSelection: "#dce0e8",
  sidebarBg: "#e6e9ef",
  sidebarBorder: "#ccd0da",
  tabBarBg: "#e6e9ef",
  tabBarBorder: "#ccd0da",
  dashboardIcon: "lucide:layout-dashboard",
  ansi: {
    black: "#5c5f77",
    red: "#d20f39",
    green: "#40a02b",
    yellow: "#df8e1d",
    blue: "#1e66f5",
    magenta: "#8839ef",
    cyan: "#179299",
    white: "#acb0be",
    brightBlack: "#6c6f85",
    brightRed: "#d20f39",
    brightGreen: "#40a02b",
    brightYellow: "#df8e1d",
    brightBlue: "#1e66f5",
    brightMagenta: "#8839ef",
    brightCyan: "#179299",
    brightWhite: "#bcc0cc",
  },
};

const mollyDisco: ThemeDef = {
  name: "Molly Disco",
  // Lisa Frank-inspired: vibrant purples, hot pinks, teals, neon on light lavender
  bg: "#faf5ff",
  bgSurface: "#f0e6ff",
  bgFloat: "#e8d5ff",
  bgHighlight: "#e0c8ff",
  bgActive: "#edd8ff",
  border: "#d4b0f0",
  borderActive: "#c026d3",
  borderNotify: "#e040fb",
  fg: "#2d1b4e",
  fgMuted: "#6b4d8a",
  fgDim: "#a88bc7",
  accent: "#c026d3",
  accentHover: "#a020b0",
  notify: "#e040fb",
  notifyGlow: "rgba(224, 64, 251, 0.25)",
  danger: "#e91e63",
  success: "#00bfa5",
  warning: "#ff9100",
  termBg: "#faf5ff",
  termFg: "#2d1b4e",
  termCursor: "#c026d3",
  termSelection: "#e0c8ff",
  sidebarBg: "#f3e8ff",
  sidebarBorder: "#d4b0f0",
  tabBarBg: "#f0e6ff",
  tabBarBorder: "#d4b0f0",
  dashboardIcon: "🪩",
  ansi: {
    black: "#2d1b4e", // deep purple
    red: "#e91e63", // hot pink
    green: "#00bfa5", // teal
    yellow: "#ff9100", // bright orange
    blue: "#2979ff", // electric blue
    magenta: "#c026d3", // fuchsia
    cyan: "#00b8d4", // bright cyan
    white: "#f0e6ff", // light purple
    brightBlack: "#6b4d8a", // muted purple
    brightRed: "#ff4081", // neon pink
    brightGreen: "#1de9b6", // neon teal
    brightYellow: "#ffab40", // bright amber
    brightBlue: "#448aff", // bright blue
    brightMagenta: "#e040fb", // electric purple
    brightCyan: "#18ffff", // neon cyan
    brightWhite: "#faf5ff", // white lavender
  },
};

// --- All themes ---
// Group-color slot helpers live in ../extensions/api.ts (to keep
// extensions self-contained). Re-export from here so core callers and
// tests can reach them through the theme-data module.
export {
  GROUP_COLOR_SLOTS,
  type WorkspaceColorSlot,
  type WorkspaceColorTheme,
  getWorkspaceColors,
  resolveWorkspaceColor,
} from "../extensions/api";

export const themes: Record<string, ThemeDef> = {
  // Dark
  "github-dark": githubDark,
  "tokyo-night": tokyoNight,
  "catppuccin-mocha": catppuccinMocha,
  dracula: draculaPro,
  "solarized-dark": solarizedDark,
  "one-dark": oneDark,
  // Light
  molly: molly,
  "molly-disco": mollyDisco,
  "github-light": githubLight,
  "solarized-light": solarizedLight,
  "catppuccin-latte": catppuccinLatte,
};
