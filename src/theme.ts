/**
 * GnarTerm color palette
 * Inspired by Tokyo Night / Catppuccin — warm dark, not pure black
 */

export const theme = {
  // Base
  bg: "#1a1b26",         // deep navy, not pure black
  bgSurface: "#1f2030",  // slightly lighter for panels
  bgFloat: "#24283b",    // floating elements (menus, palette)
  bgHighlight: "#2a2e42", // hover / selection bg
  bgActive: "#33374d",   // active tab / selected item

  // Borders
  border: "#2f3349",
  borderActive: "#e0964c", // orange accent for active elements
  borderNotify: "#7aa2f7", // blue for notifications

  // Text
  fg: "#c0caf5",          // primary text
  fgMuted: "#7982a9",     // secondary / metadata text
  fgDim: "#545c7e",       // disabled / very subtle text

  // Accent
  accent: "#e0964c",      // orange — GnarTerm signature color (🤙 vibes)
  accentHover: "#e8a862",
  notify: "#7aa2f7",      // blue notification ring
  notifyGlow: "rgba(122, 162, 247, 0.3)",
  danger: "#f7768e",      // destructive actions
  success: "#9ece6a",     // green for success states

  // Terminal
  termBg: "#1a1b26",
  termFg: "#c0caf5",
  termCursor: "#c0caf5",
  termSelection: "#2e3c64",

  // Sidebar
  sidebarBg: "#16161e",
  sidebarBorder: "#1f2030",

  // Tab bar
  tabBarBg: "#16161e",
  tabBarBorder: "#1f2030",
};

/** xterm.js theme object */
export const xtermTheme = {
  background: theme.termBg,
  foreground: theme.termFg,
  cursor: theme.termCursor,
  cursorAccent: theme.termBg,
  selectionBackground: theme.termSelection,
  selectionForeground: theme.termFg,
  // ANSI colors (Tokyo Night inspired)
  black: "#15161e",
  red: "#f7768e",
  green: "#9ece6a",
  yellow: "#e0af68",
  blue: "#7aa2f7",
  magenta: "#bb9af7",
  cyan: "#7dcfff",
  white: "#a9b1d6",
  brightBlack: "#414868",
  brightRed: "#f7768e",
  brightGreen: "#9ece6a",
  brightYellow: "#e0af68",
  brightBlue: "#7aa2f7",
  brightMagenta: "#bb9af7",
  brightCyan: "#7dcfff",
  brightWhite: "#c0caf5",
};
