# ClawTab 🦀

Terminal workspace manager for AI coding agents. A lean, cross-platform alternative to cmux built with Tauri v2.

## Architecture

- **Frontend:** TypeScript + xterm.js (WebGL renderer) + Vite
- **Backend:** Rust + Tauri v2 + portable-pty
- **Platforms:** Linux + macOS

## Features (POC)

- Vertical sidebar with workspace tabs
- Split panes (horizontal + vertical)
- GPU-accelerated terminal rendering (xterm.js WebGL)
- Notification badges (OSC 9/99/777 terminal sequences)
- Keyboard-driven (Cmd+N, Cmd+D, Cmd+1-9, etc.)

## Development

```bash
# Prerequisites: Rust, Node.js

# Install frontend deps
npm install

# Run in dev mode
npm run tauri dev

# Build
npm run tauri build
```

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| Cmd+N | New workspace |
| Cmd+1-9 | Jump to workspace |
| Cmd+D | Split right |
| Cmd+Shift+D | Split down |
| Cmd+W | Close pane |
| Cmd+Shift+W | Close workspace |
| Cmd+B | Toggle sidebar |

## Roadmap

- [ ] Git branch display in sidebar
- [ ] Agent-aware notifications (Claude Code, OpenCode hooks)
- [ ] Workspace persistence / session restore
- [ ] SSH remote workspaces
- [ ] Configurable themes (read Ghostty config)
- [ ] Face recognition / tagging (who's on camera?)
