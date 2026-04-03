# GnarTerm Workplan

## Blockers (must be fixed before any testing)

### 1. Font Detection is Broken
- [ ] Add logging to `detect_font` Rust command so we can see what it tries and finds
- [ ] Test `detect_font` on gnimo's Mac — run `cargo test` or print output to console
- [ ] Verify: what font does gnimo actually use? Check iTerm2/Ghostty/Terminal.app prefs
- [ ] If detection fails, fall back to querying `fc-list` (Linux) or scanning `~/Library/Fonts` (Mac) for any Nerd Font Mono variant
- [ ] **Verify: open GnarTerm, open dev console (Cmd+Option+I), confirm log shows detected font name**
- [ ] **Verify: powerline glyphs (arrows, branch icons) render correctly in the terminal**

### 2. Color Theme is Wrong
- [ ] Background is still `#000000` somewhere — find and kill it
- [ ] Verify `index.html` body background matches theme (`#0d1117` GitHub dark)
- [ ] Verify xterm.js terminal background matches theme
- [ ] Verify sidebar and tab bar backgrounds are `#010409`
- [ ] **Verify: no pure black anywhere. Everything is GitHub Dark Default palette.**

### 3. Pane Management Controls Missing
cmux has visible UI controls, not just keyboard shortcuts:
- [ ] **Split buttons** — visible in each pane's title area (split right / split down icons)
- [ ] **Close pane button** — visible X on each pane
- [ ] **New surface (+) button** — visible in each pane's tab bar (only shows with >0 surfaces, always present)
- [ ] **New workspace (+) button** — visible in sidebar header
- [ ] Right-click context menu on pane → Split Right, Split Down, Close
- [ ] Right-click context menu on workspace → Rename, Close, Close Others
- [ ] **Verify: user can split, close, and create without knowing any keyboard shortcuts**

## After Blockers

### 4. Keyboard Shortcuts (cmux-exact)
- [ ] Cmd+N → new workspace
- [ ] Cmd+T → new surface in focused pane
- [ ] Cmd+D → split right
- [ ] Cmd+Shift+D → split down
- [ ] Cmd+W → close surface
- [ ] Cmd+Shift+W → close workspace
- [ ] Cmd+1-9 → switch workspace
- [ ] Ctrl+1-9 → switch surface in pane
- [ ] Cmd+Shift+]/[ → next/prev surface
- [ ] Ctrl+Cmd+]/[ → next/prev workspace
- [ ] Opt+Cmd+Arrows → focus pane directionally
- [ ] Cmd+Shift+Enter → toggle pane zoom
- [ ] Cmd+B → toggle sidebar
- [ ] Cmd+Shift+H → flash focused pane
- [ ] Cmd+Shift+R → rename workspace
- [ ] **Verify: each shortcut works in the running app**

### 5. Terminal Must Work
- [ ] `exit` closes the surface/pane correctly
- [ ] Shell prompt renders with full powerline styling
- [ ] Colors (ls output, git status, etc.) render correctly
- [ ] Scrollback works
- [ ] Copy/paste works (Cmd+C with selection, Cmd+V)
- [ ] **Verify: run `ls --color`, `git status`, `vim` — all render correctly**

## Verification Protocol
Every item above must be tested in the actual running Tauri app before marking done.
No blind pushes. Build locally, verify, then push.
