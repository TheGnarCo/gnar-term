# GnarTerm Issues

## Bugs

### ~~[B1] Theme selection not working reliably~~ ✅ FIXED
Root cause: mouseenter on palette rows called render() which destroyed the click target DOM element.

### ~~[B2] Close pane button not working~~ ✅ FIXED
Root cause: safeFocus/safeDispose were infinitely recursive + stale closure refs.

### ~~[B3] Close tab not working reliably~~ ✅ FIXED
Same root cause as B2.

## Enhancements

### ~~[E1] Workspace save/restore~~ ✅ DONE
Config system with `gnar-term.json` (cmux-compatible). Save via ⌘P, autoload on startup, manual load from palette.

### ~~[E2] Markdown viewer / file preview~~ ✅ DONE
Modular preview system with markdown (github-markdown-css), JSON (syntax highlighted), image preview. Cmd+click on file paths in terminal. Live-reload on file change.

### [E3] Pane divider drag to resize
Split panes are always 50/50. Add draggable dividers between panes to resize.

### [E4] Find in terminal (⌘F)
Add find/find-next/find-prev using xterm.js SearchAddon.

### [E5] Clear scrollback (⌘K)
Call terminal.clear() on active terminal.

### [E6] Font size zoom (⌘+/⌘-/⌘0)
Adjust xterm.js fontSize and refit.

### ~~[E7] Ctrl+Tab / Ctrl+Shift+Tab surface switching~~ ✅ DONE
Ctrl+Tab next tab, Ctrl+Shift+Tab previous tab.

### [E8] Bash/fish shell integration for CWD
Currently only zsh gets OSC 7 via ZDOTDIR. Add bash (PROMPT_COMMAND) and fish support.
