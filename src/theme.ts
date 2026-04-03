/**
 * GnarTerm color palette
 * GitHub Dark Default — NOT pure black
 */

export const theme = {
  // Base
  bg: "#161b22",           // main background (GitHub's actual canvas bg)
  bgSurface: "#1c2128",   // elevated surfaces
  bgFloat: "#2d333b",     // floating elements (menus, palette)
  bgHighlight: "#373e47",  // hover states
  bgActive: "#2d333b",    // active/selected

  // Borders
  border: "#444c56",
  borderActive: "#58a6ff",
  borderNotify: "#58a6ff",

  // Text
  fg: "#e6edf3",
  fgMuted: "#8b949e",
  fgDim: "#636e7b",

  // Accent
  accent: "#58a6ff",
  accentHover: "#79c0ff",
  notify: "#58a6ff",
  notifyGlow: "rgba(88, 166, 255, 0.25)",
  danger: "#f85149",
  success: "#3fb950",
  warning: "#d29922",

  // Terminal
  termBg: "#161b22",
  termFg: "#e6edf3",
  termCursor: "#e6edf3",
  termSelection: "#264f78",

  // Sidebar — darker but NOT black
  sidebarBg: "#0d1117",
  sidebarBorder: "#21262d",

  // Tab bar
  tabBarBg: "#1c2128",
  tabBarBorder: "#21262d",
};

/** xterm.js theme — GitHub dark ANSI colors */
export const xtermTheme = {
  background: theme.termBg,
  foreground: theme.termFg,
  cursor: theme.termCursor,
  cursorAccent: theme.termBg,
  selectionBackground: theme.termSelection,
  selectionForeground: theme.termFg,
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
};
