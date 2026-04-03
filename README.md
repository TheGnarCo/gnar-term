<h1 align="center">🤙 gnar-term</h1>
<p align="center">A cross-platform terminal workspace manager with built-in file previews, themes, and cmux-compatible config</p>

<p align="center">
  <a href="https://github.com/TheGnarCo/gnar-term/releases/latest"><img src="https://img.shields.io/badge/Download-Latest%20Release-blue?style=for-the-badge" alt="Download" /></a>
</p>

<p align="center">
  <a href="https://github.com/TheGnarCo/gnar-term"><img src="https://img.shields.io/github/stars/TheGnarCo/gnar-term?style=flat&logo=github&label=stars" alt="GitHub stars" /></a>
  <a href="https://github.com/TheGnarCo/gnar-term/actions"><img src="https://img.shields.io/github/actions/workflow/status/TheGnarCo/gnar-term/ci.yml?label=CI" alt="CI" /></a>
  <img src="https://img.shields.io/badge/platforms-macOS%20%7C%20Linux%20%7C%20Windows-green" alt="Platforms" />
</p>

<p align="center">
  <img src="./docs/screenshot.png" alt="gnar-term screenshot" width="900" />
</p>

> **Note:** Screenshot shows gnar-term running with Tokyo Night theme. The app supports 10 themes (6 dark + 4 light) and runs on macOS, Linux, and Windows.

## Features

<table>
<tr>
<td width="40%" valign="middle">
<h3>Workspace management</h3>
Vertical sidebar tabs with drag-to-reorder, inline rename, and workspace close on hover. Save workspace layouts to <code>gnar-term.json</code> and reload them from the command palette.
</td>
<td width="60%">

```
┌──────────┬─────────────────────────┐
│ Sidebar  │  Terminal Pane 1        │
│          │                         │
│ > Dev  × │  ~/projects/myapp $ _   │
│   API    ├─────────────────────────┤
│   Docs   │  Terminal Pane 2        │
│          │                         │
│   [+]    │  ~/projects/myapp $     │
└──────────┴─────────────────────────┘
```

</td>
</tr>
<tr>
<td width="40%" valign="middle">
<h3>Split panes</h3>
Split horizontally (<code>⌘D</code>) and vertically (<code>⇧⌘D</code>). Each split has its own independent direction — no flat list limitations. Tabs within each pane. Pane zoom (<code>⇧⌘Enter</code>) for focus mode.
</td>
<td width="60%">

```
┌───────────────┬──────────────┐
│               │              │
│   Terminal    │   Terminal   │
│               │              │
├───────────────┤              │
│               │              │
│   Terminal    │              │
│               │              │
└───────────────┴──────────────┘
```

</td>
</tr>
<tr>
<td width="40%" valign="middle">
<h3>File previews</h3>
Click any file path in the terminal to preview it in a new tab. Supports Markdown, PDF, JSON, CSV, YAML, images (including HEIC), video, and text files. Live-reloads when the file changes on disk.
</td>
<td width="60%">

**Supported formats:**
- 📝 Markdown (GitHub-style rendering)
- 📄 PDF (page-by-page canvas rendering)
- 📊 CSV / TSV (sortable table with row highlighting)
- 🖼️ Images (PNG, JPG, GIF, WebP, HEIC, SVG)
- 🎥 Video (MP4, WebM, MOV)
- 📋 JSON (syntax highlighted)
- ⚙️ YAML / TOML (syntax highlighted)
- 📄 Text files with line numbers

</td>
</tr>
<tr>
<td width="40%" valign="middle">
<h3>6 built-in themes</h3>
Switch themes instantly from the command palette (<code>⌘P</code>) or the native <b>View → Theme</b> menu. Your choice persists across restarts.
</td>
<td width="60%">

- **GitHub Dark** (default)
- **Tokyo Night**
- **Catppuccin Mocha**
- **Dracula**
- **Solarized Dark**
- **One Dark**

</td>
</tr>
<tr>
<td width="40%" valign="middle">
<h3>cmux-compatible config</h3>
Define workspace layouts and custom commands in <code>gnar-term.json</code>. Copy your <code>cmux.json</code> and it just works. Autoload workspaces on startup.
</td>
<td width="60%">

```json
{
  "theme": "tokyo-night",
  "autoload": ["Dev"],
  "commands": [
    {
      "name": "Dev",
      "workspace": {
        "name": "Dev",
        "cwd": "~/projects/myapp",
        "layout": {
          "direction": "horizontal",
          "split": 0.6,
          "children": [
            { "pane": { "surfaces": [
              { "type": "terminal", "command": "npm run dev" }
            ]}},
            { "pane": { "surfaces": [
              { "type": "terminal" }
            ]}}
          ]
        }
      }
    }
  ]
}
```

</td>
</tr>
<tr>
<td width="40%" valign="middle">
<h3>CWD tracking</h3>
New tabs and splits inherit the working directory of the active terminal. Automatic OSC 7 shell integration for zsh — no config needed.
</td>
<td width="60%">

Tab titles show the current directory or running process. `cd ~/projects/foo` then `⌘T` opens a new tab already in `foo/`.

</td>
</tr>
</table>

### Also includes

- **Command palette** (`⌘P`) — fuzzy search across all commands, workspaces, and themes
- **Context menu** — right-click in terminal for copy, paste, file actions, split options
- **Bundled Nerd Font** — JetBrainsMono Nerd Font Mono included, powerline glyphs work out of the box
- **Flow control** — PTY backpressure prevents the terminal from choking on fast output
- **Cross-platform** — macOS, Linux, and Windows via Tauri v2

## Install

### Download

Grab the latest release for your platform:

👉 **[GitHub Releases](https://github.com/TheGnarCo/gnar-term/releases/latest)**

### Build from source

```bash
git clone https://github.com/TheGnarCo/gnar-term.git
cd gnar-term
npm install
npm run build
```

The built app will be in `src-tauri/target/release/bundle/`.

### Development

```bash
npm install
npm run dev
```

## Keyboard shortcuts

### Workspaces

| Shortcut | Action |
|----------|--------|
| `⌘N` | New workspace |
| `⌘1`–`⌘8` | Jump to workspace 1–8 |
| `⌘9` | Jump to last workspace |
| `⌃⌘]` | Next workspace |
| `⌃⌘[` | Previous workspace |
| `⇧⌘W` | Close workspace |
| `⇧⌘R` | Rename workspace |
| `⌘B` | Toggle sidebar |

### Surfaces (tabs)

| Shortcut | Action |
|----------|--------|
| `⌘T` | New tab |
| `⇧⌘]` | Next tab |
| `⇧⌘[` | Previous tab |
| `⌘W` | Close tab |

### Split panes

| Shortcut | Action |
|----------|--------|
| `⌘D` | Split right |
| `⇧⌘D` | Split down |
| `⌥⌘←→↑↓` | Focus pane directionally |
| `⇧⌘Enter` | Toggle pane zoom |
| `⇧⌘H` | Flash focused panel |

### General

| Shortcut | Action |
|----------|--------|
| `⌘P` | Command palette |
| `⌘K` | Clear scrollback |

## Config

gnar-term reads configuration from:

1. `./gnar-term.json` (per-project, highest priority)
2. `~/.config/gnar-term/gnar-term.json` (global)
3. `./cmux.json` (per-project, cmux compatibility)
4. `~/.config/cmux/cmux.json` (global, cmux compatibility)

The config format is a superset of [cmux.json](https://cmux.com/docs/custom-commands). Any valid `cmux.json` works as a `gnar-term.json`.

### gnar-term extensions

| Key | Type | Description |
|-----|------|-------------|
| `theme` | string | Active theme ID |
| `autoload` | string[] | Workspace command names to launch on startup |
| `commands[].workspace.layout.children[].pane.surfaces[].type` | `"markdown"` | Markdown preview surface (in addition to `"terminal"` and `"browser"`) |

## Architecture

Built with:

- **[Tauri v2](https://tauri.app)** — native app shell, Rust backend
- **[xterm.js](https://xtermjs.org)** — terminal emulation with WebGL rendering
- **[portable-pty](https://docs.rs/portable-pty)** — cross-platform PTY spawning
- **[marked](https://marked.js.org)** + **[github-markdown-css](https://github.com/sindresorhus/github-markdown-css)** — Markdown rendering
- **[pdf.js](https://mozilla.github.io/pdf.js/)** — PDF rendering

## Contributing

```bash
git clone https://github.com/TheGnarCo/gnar-term.git
cd gnar-term
npm install
npm run dev
```

PRs welcome. Check [ISSUES.md](./ISSUES.md) for known issues and planned enhancements.

## License

MIT
