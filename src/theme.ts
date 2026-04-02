/**
 * GnarTerm color palette
 * GitHub Dark Default — clean, familiar, muted
 */

export const theme = {
  // Base — GitHub dark mode grays
  bg: "#0d1117",          // main background
  bgSurface: "#161b22",   // sidebar, cards, elevated surfaces
  bgFloat: "#1c2128",     // floating elements (menus, palette, tooltips)
  bgHighlight: "#30363d",  // hover states
  bgActive: "#388bfd26",   // active/selected (blue tint, translucent)

  // Borders
  border: "#30363d",
  borderActive: "#58a6ff",  // blue accent
  borderNotify: "#58a6ff",

  // Text
  fg: "#e6edf3",           // primary text
  fgMuted: "#8b949e",      // secondary / labels
  fgDim: "#484f58",        // disabled / very subtle

  // Accent — GitHub blue
  accent: "#58a6ff",
  accentHover: "#79c0ff",
  notify: "#58a6ff",
  notifyGlow: "rgba(88, 166, 255, 0.25)",
  danger: "#f85149",
  success: "#3fb950",
  warning: "#d29922",

  // Terminal
  termBg: "#0d1117",
  termFg: "#e6edf3",
  termCursor: "#e6edf3",
  termSelection: "#264f78",

  // Sidebar
  sidebarBg: "#010409",     // darkest layer
  sidebarBorder: "#21262d",

  // Tab bar
  tabBarBg: "#010409",
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
