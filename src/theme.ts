/**
 * GnarTerm color palette
 * Muted dark — inspired by cmux / macOS system dark mode
 * Quiet, professional, gets out of the way
 */

export const theme = {
  // Base — neutral grays, not navy or pure black
  bg: "#1c1c1e",          // system dark bg
  bgSurface: "#232326",   // panels, cards
  bgFloat: "#2c2c2e",     // floating elements (menus, palette)
  bgHighlight: "#38383a",  // hover states
  bgActive: "#3a3a3c",    // active/selected

  // Borders — subtle
  border: "#38383a",
  borderActive: "#0091ff",  // cmux blue accent
  borderNotify: "#0091ff",

  // Text — muted hierarchy
  fg: "#e5e5e7",           // primary
  fgMuted: "#98989d",      // secondary / labels
  fgDim: "#636366",        // disabled / very subtle

  // Accent — calm blue (matches cmux)
  accent: "#0091ff",
  accentHover: "#409cff",
  notify: "#0091ff",
  notifyGlow: "rgba(0, 145, 255, 0.25)",
  danger: "#ff453a",
  success: "#30d158",

  // Terminal — your ghostty/terminal theme takes over here
  termBg: "#1c1c1e",
  termFg: "#e5e5e7",
  termCursor: "#e5e5e7",
  termSelection: "#3a3a3c",

  // Sidebar — slightly darker than main bg
  sidebarBg: "#161618",
  sidebarBorder: "#2c2c2e",

  // Tab bar
  tabBarBg: "#161618",
  tabBarBorder: "#2c2c2e",
};

/** xterm.js theme — neutral, lets user's shell theme shine */
export const xtermTheme = {
  background: theme.termBg,
  foreground: theme.termFg,
  cursor: theme.termCursor,
  cursorAccent: theme.termBg,
  selectionBackground: theme.termSelection,
  selectionForeground: theme.termFg,
  // Standard ANSI — muted but readable
  black: "#1c1c1e",
  red: "#ff453a",
  green: "#30d158",
  yellow: "#ffd60a",
  blue: "#0a84ff",
  magenta: "#bf5af2",
  cyan: "#64d2ff",
  white: "#e5e5e7",
  brightBlack: "#636366",
  brightRed: "#ff6961",
  brightGreen: "#4cd964",
  brightYellow: "#ffe620",
  brightBlue: "#409cff",
  brightMagenta: "#da8fff",
  brightCyan: "#70d7ff",
  brightWhite: "#f5f5f7",
};
