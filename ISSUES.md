# GnarTerm Issues

## Bugs

### [B1] Theme selection not working reliably
Theme selection via command palette and View menu may not apply correctly. Need to verify terminal ANSI colors, sidebar, and tab bar all update.

### [B2] Close pane button not working
Pane close button (✕) may use stale refs. Verify with fresh ref lookup.

### [B3] Close tab not working reliably
Stale closure issue — handlers capture ws/pane at build time. Fixed with fresh ref lookup but needs verification.

## Enhancements

### [E1] Workspace save/restore
Auto-save workspace state on quit, restore on launch. Also named workspace profiles (save/load layouts from command palette).

### [E2] Markdown viewer: cmd+click on .md paths
cmd+clicking a .md file path in terminal should open it in the markdown viewer tab.

### [E3] Pane divider drag to resize
Split panes are always 50/50. Add draggable dividers between panes to resize.

### [E4] Find in terminal (⌘F)
Add find/find-next/find-prev using xterm.js SearchAddon.

### [E5] Clear scrollback (⌘K)
Call terminal.clear() on active terminal.

### [E6] Font size zoom (⌘+/⌘-/⌘0)
Adjust xterm.js fontSize and refit.

### [E7] Ctrl+Tab / Ctrl+Shift+Tab surface switching
Navigate between tabs in active pane.

### [E8] Bash/fish shell integration for CWD
Currently only zsh gets OSC 7 via ZDOTDIR. Add bash (PROMPT_COMMAND) and fish support.
