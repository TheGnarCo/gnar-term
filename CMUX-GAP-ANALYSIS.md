# cmux Gap Analysis — GnarTerm vs cmux

Based on cmux docs: https://cmux.com/docs

## CRITICAL BUGS (broken right now)

### 1. ⇧⌘R Rename workspace — uses `prompt()` which doesn't work in Tauri webview
- **File:** `main.ts:161`, `sidebar.ts:140`
- **Fix:** Replace `prompt()` with inline contentEditable on the workspace name span. On ⇧⌘R or context menu "Rename", make the name span editable, focus it, select all, commit on Enter/blur, cancel on Escape.

### 2. Workspace reorder — not implemented
- **File:** `sidebar.ts` 
- **Fix:** Add HTML5 drag-and-drop on workspace items. Set `draggable=true` on the item div. On `dragstart`, store the source index. On `dragover`/`drop`, reorder `termManager.workspaces` array and re-render. Visual: show a 2px line indicator between items during drag.

### 3. Last surface close behavior — cmux docs are contradictory
- The splits-and-panes page says: "The last pane in a workspace cannot be closed (cmux creates a new terminal automatically)"
- But user says closing last tab closes the workspace
- **Current code:** closes the workspace. User confirmed this is what they want.
- **Status:** CORRECT per user instruction.

### 4. Closing last workspace should still keep one alive
- If user closes the only workspace, need to spawn a fresh one
- **Status:** Already implemented in removePane. But `closeActiveWorkspace()` also needs this check.

## MISSING FEATURES (cmux has, we don't)

### 5. ⌃Tab / ⌃⇧Tab — next/prev surface
- **File:** `main.ts` — NOT handled
- **Fix:** Add handlers for Ctrl+Tab and Ctrl+Shift+Tab to call nextSurface/prevSurface

### 6. ⌘R — Rename surface (tab)
- **Not implemented.** cmux has this.
- **Fix:** Similar to workspace rename — inline editable on tab name

### 7. ⌘F — Find in terminal
- **Not implemented.** cmux has find/find next/find prev.
- **Fix:** Use xterm.js SearchAddon

### 8. ⌘K — Clear scrollback
- **Not implemented.**
- **Fix:** Call `terminal.clear()` on active terminal

### 9. ⌘+/⌘-/⌘0 — Font size zoom
- **Not implemented.**
- **Fix:** Adjust xterm.js fontSize option and refit

### 10. Divider drag to resize panes
- **Not implemented.** Split ratio is always 50/50.
- **Fix:** Add a drag handle element between split children. On mousedown, track mousemove to update flex ratios.

### 11. ⌘⇧P — Command palette (different shortcut from our ⌘P)
- **We use ⌘P.** cmux uses ⌘⇧P. Both should work.
- **Fix:** Add ⌘⇧P as alias

## NICE TO HAVE (lower priority)

### 12. Working directory tracking (OSC 7)
- cmux detects `cd` via shell integration and shows cwd in sidebar
- Would need to parse OSC 7 sequences from pty output

### 13. Git branch detection
- cmux shows git branch in sidebar
- Would need periodic `git rev-parse` calls per workspace

### 14. Notification badges / rings
- Blue ring on pane border, badge on sidebar tab
- We have basic unread dot but not the ring effect

### 15. Session restore on relaunch
- Save workspace layout, scroll history, working dirs
- Restore on next `npm run tauri dev`

### 16. Drag tabs between panes
- cmux allows dragging surface tabs from one pane to another

### 17. Pinned workspaces
- Stay at top of sidebar regardless of notifications
