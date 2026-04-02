# GnarTerm Feature Spec

Informed by cmux's design. Not a 1:1 clone — taking what it does right and making it work cross-platform.

## Layout (cmux model)

```
┌──────────────────────────────────────────────────────┐
│  Sidebar (left)  │  Tab Bar (top)     │              │
│                  ├────────────────────┤              │
│  Workspace 1  ●  │  Shell 1 │ Shell 2 │ +           │
│  Workspace 2     ├────────────────────┤              │
│  Workspace 3     │                    │              │
│                  │   Terminal Pane(s)  │              │
│                  │                    │              │
│                  │   (split h/v)      │              │
│                  │                    │              │
└──────────────────────────────────────────────────────┘
```

- **Sidebar** = workspace list (vertical tabs). Each workspace shows metadata below its name.
- **Tab Bar** = surfaces/panes within the active workspace (horizontal tabs).
- **Terminal Area** = one or more terminal panes, splittable horizontally and vertically.

---

## ✅ Implemented

- [x] Sidebar with workspace list
- [x] Tab bar with pane tabs
- [x] Split panes (right / down)
- [x] PTY spawn/write/resize/kill via Rust backend
- [x] PTY exit detection (close pane on `exit`)
- [x] xterm.js with WebGL renderer
- [x] Keyboard shortcuts (Cmd+N/D/W/B/1-9, Ctrl+Tab, Alt+Cmd+Arrow)
- [x] Context menus (right-click workspace, right-click pane)
- [x] Command palette (Cmd+P)
- [x] Notification dot on panes/workspaces (OSC parsing in Rust)
- [x] Active pane highlight (orange border)
- [x] Nerd Font / Powerline font detection

---

## 🔲 Phase 1: Core UX

### Sidebar Metadata (per workspace)
cmux shows rich metadata under each workspace name:
- **Git branch** — detect from cwd via `git rev-parse --abbrev-ref HEAD`
- **Working directory** — shortened path (~/Projects/foo)
- **Listening ports** — scan for open ports from the workspace's shell processes
- **PR status** — linked GitHub PR number + CI status (green/red/pending)
- **Latest notification** — preview text of last agent notification

### Workspace Features
- [ ] **Rename workspace** — double-click name in sidebar, or context menu (done via prompt, needs inline edit)
- [ ] **Workspace color** — set a color per workspace (context menu → color picker)
- [ ] **Drag to reorder** — drag workspaces up/down in sidebar
- [ ] **Pin workspaces** — pinned workspaces stay at top of sidebar
- [ ] **Auto-reorder on notification** — workspace with new notification moves up (setting, default on)
- [ ] **New workspace placement** — setting: top / after current / end (default: after current)
- [ ] **Close workspace confirmation** — prompt if workspace has running processes

### Pane Features
- [ ] **Pane notification ring** — blue glowing border when a pane has an unread notification (cmux's signature look)
- [ ] **Flash focused pane** — Cmd+Shift+H briefly flashes the active pane border
- [ ] **Drag pane tabs** to reorder within the tab bar
- [ ] **Pane zoom** — Cmd+Shift+Enter to temporarily maximize a pane (toggle)

---

## 🔲 Phase 2: Notifications

cmux's notification system is its killer feature for AI agents.

### Notification Sources
- [ ] **OSC 9** (iTerm2 protocol) — `\e]9;message\a`
- [ ] **OSC 99** (Kitty protocol) — rich notifications with title/subtitle/body and notification IDs
- [ ] **OSC 777** (RXVT protocol) — `\e]777;notify;title;body\a`
- [ ] **CLI** — `gnar-term notify --title "Done" --body "Build finished"`

### Notification Panel
- [ ] **Cmd+Shift+I** — slide-out panel listing all notifications
- [ ] Each notification shows: workspace name, title, body, timestamp
- [ ] Click notification → jump to that workspace/pane
- [ ] Clear individual notifications or clear all

### Notification Behavior
- [ ] **Jump to latest unread** — Cmd+Shift+U
- [ ] **Desktop notifications** — native OS notifications via Tauri API
- [ ] **Suppression** — no desktop alert when the app is focused and the workspace is active
- [ ] **Notification sound** — configurable: system sounds, custom file, or none
- [ ] **Notification command** — run a shell command on notification (env vars: TITLE, BODY, SUBTITLE)
- [ ] **Cooldown** — suppress duplicate notifications within N seconds

### Agent Integration Hooks
- [ ] **Claude Code hooks** — `~/.claude/hooks/gnar-term-notify.sh` template
- [ ] **OpenClaw hooks** — `gnar-term notify` on agent completion
- [ ] **Generic** — any process can send OSC 777 or call the CLI

---

## 🔲 Phase 3: Configuration

### Config File
`~/.config/gnar-term/config.toml`
```toml
[font]
family = "JetBrainsMono Nerd Font Mono"
size = 14

[theme]
background = "#0a0a0a"
foreground = "#e0e0e0"
cursor = "#e0e0e0"
selection = "#264f78"

[notifications]
sound = "default"  # "default" | "none" | path to .aiff/.wav
command = ""       # shell command to run on notification
cooldown_ms = 5000

[workspace]
new_placement = "after_current"  # "top" | "after_current" | "end"
auto_reorder_on_notification = true
close_on_last_pane_exit = true

[sidebar]
show_git_branch = true
show_working_directory = true
show_ports = true
show_notification_preview = true
width = 220
```

### Custom Commands (cmux.json equivalent)
`gnar-term.json` in project root or `~/.config/gnar-term/`:
```json
{
  "commands": [
    {
      "name": "Dev Environment",
      "workspace": {
        "name": "Dev",
        "layout": {
          "direction": "horizontal",
          "split": 0.5,
          "children": [
            { "pane": { "command": "npm run dev", "name": "Frontend" } },
            { "pane": { "command": "cargo watch -x run", "name": "Backend" } }
          ]
        }
      }
    },
    {
      "name": "Run Tests",
      "command": "npm test",
      "confirm": true
    }
  ]
}
```

---

## 🔲 Phase 4: Power Features

- [ ] **CLI + Unix socket API** — `gnar-term list-workspaces`, `gnar-term notify`, `gnar-term send-keys`
- [ ] **SSH workspaces** — `gnar-term ssh user@host` creates a remote workspace
- [ ] **Session restore** — save/restore workspace layout, cwd, scrollback on relaunch
- [ ] **Find in terminal** — Cmd+F search within scrollback
- [ ] **Image rendering** — inline image protocol (iTerm2/Kitty)
- [ ] **Configurable keyboard shortcuts** — remap any shortcut
- [ ] **Auto-updates** — check for new versions, update in-place

---

## Non-Goals (for now)

- In-app browser (cmux has this — too much scope for v1)
- tmux integration/detection (cmux does this — nice but not essential)
- Claude Code Teams mode (cmux-specific)
- PostHog analytics (cmux has this — we don't track users)
