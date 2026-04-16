<h1 align="center">🤙 gnar-term</h1>
<p align="center">A cross-platform terminal workspace manager with built-in file previews, themes, and cmux-compatible config</p>

<p align="center">
  <a href="https://github.com/TheGnarCo/gnar-term/releases/latest"><img src="https://img.shields.io/badge/Download-Latest%20Release-blue?style=for-the-badge" alt="Download" /></a>
</p>

<p align="center">
  <a href="https://github.com/TheGnarCo/gnar-term"><img src="https://img.shields.io/github/stars/TheGnarCo/gnar-term?style=flat&logo=github&label=stars" alt="GitHub stars" /></a>
  <a href="https://github.com/TheGnarCo/gnar-term/actions"><img src="https://img.shields.io/github/actions/workflow/status/TheGnarCo/gnar-term/ci.yml?label=CI" alt="CI" /></a>
  <img src="https://img.shields.io/badge/platforms-macOS%20%7C%20Linux-green" alt="Platforms" />
</p>

<p align="center">
  <img src="./docs/screenshot.png" alt="gnar-term screenshot" width="900" />
</p>

## Why gnar-term?

I love [cmux](https://github.com/manaflow-ai/cmux). It's currently my favorite terminal multiplexer for working with AI coding agents. But there were a few things I wanted:

- **Cross-platform** — cmux is macOS-only (Swift/AppKit). I needed something that runs on Linux too. gnar-term is built with Tauri, so it runs on macOS and Linux.
- **Built-in file previews** — Click a file path in the terminal and preview it right there. Markdown renders with GitHub styling, PDFs page through, CSVs become tables, images and videos display inline. No context switching to Finder or another app. (Provided by the built-in Preview extension — can be disabled in Settings > Extensions.)
- **Command palette** — `⌘P` to fuzzy-search commands, switch workspaces, change themes, and load saved layouts. One keystroke to do anything.
- **Themes** — 11 built-in themes (6 dark, 5 light) that switch instantly and persist across restarts.
- **cmux-compatible config** — Your `cmux.json` workspace definitions work in gnar-term. Copy it over and go.

gnar-term isn't trying to replace cmux. If you're on macOS and want native Metal performance with Ghostty rendering, cmux is incredible. gnar-term is for when you want those workflows on any platform, plus file previews and a command palette baked in.

## Features

<table>
<tr>
<td width="40%" valign="middle">
<h3>Workspace management</h3>
Vertical sidebar tabs with drag-to-reorder, inline rename, and workspace close on hover. Save and load workspace layouts from the command palette. Autoload workspaces on startup.
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
Split horizontally (<code>⌘D</code>) and vertically (<code>⇧⌘D</code>). Each split has its own independent direction using a binary tree layout. Tabs within each pane. Pane zoom (<code>⇧⌘Enter</code>) for focus mode.
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
Click any file path in the terminal to preview it in a new tab. Handles bare filenames, relative paths, and quoted paths with spaces. Live-reloads when the file changes on disk. Preview is provided by the built-in Preview extension and can be disabled in Settings > Extensions.
</td>
<td width="60%">

**Supported formats:**

- 📝 Markdown (GitHub-style rendering via `github-markdown-css`)
- 📄 PDF (page-by-page canvas rendering via `pdf.js`)
- 📊 CSV / TSV (table with sticky headers and row highlighting)
- 🖼️ Images (PNG, JPG, GIF, WebP, HEIC, AVIF, TIFF, SVG)
- 🎥 Video (MP4, WebM, MOV, AVI, MKV)
- 📋 JSON / JSONC (syntax highlighted)
- ⚙️ YAML / TOML (syntax highlighted)
- 📄 Text / Log / Config files (with line numbers)

</td>
</tr>
<tr>
<td width="40%" valign="middle">
<h3>11 built-in themes</h3>
Switch themes instantly from the command palette (<code>⌘P</code>) or the native <b>View → Theme</b> menu. Persists to <code>settings.json</code> across restarts.
</td>
<td width="60%">

**Dark:**

- GitHub Dark (default)
- Tokyo Night
- Catppuccin Mocha
- Dracula
- Solarized Dark
- One Dark

**Light:**

- Molly (warm ivory + rose gold)
- Molly Disco (Lisa Frank-inspired vibrant purples + neon)
- GitHub Light
- Solarized Light
- Catppuccin Latte

</td>
</tr>
<tr>
<td width="40%" valign="middle">
<h3>cmux-compatible config</h3>
Define workspace layouts and custom commands in <code>settings.json</code>. Copy your <code>cmux.json</code> and it just works. Autoload workspaces on startup.
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
            {
              "pane": {
                "surfaces": [{ "type": "terminal", "command": "npm run dev" }]
              }
            },
            { "pane": { "surfaces": [{ "type": "terminal" }] } }
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
<h3>CWD tracking & inheritance</h3>
New tabs and splits inherit the working directory of the active terminal. Automatic OSC 7 shell integration for zsh via ZDOTDIR — no manual config needed.
</td>
<td width="60%">

Tab titles show the current directory or running process name. `cd ~/projects/foo` then `⌘T` opens a new tab already in `foo/`.

</td>
</tr>
<tr>
<td width="40%" valign="middle">
<h3>Context menu</h3>
Right-click in the terminal for contextual actions. File-specific actions appear automatically when you right-click on text that looks like a file path.
</td>
<td width="60%">

- **Copy** / **Paste**
- **Copy Path** (when text looks like a file path)
- **Preview** (for supported file types)
- **Show in File Manager** (cross-platform)
- **Open with Default App**
- **Clear Scrollback**
- **Split Right** / **Split Down**

</td>
</tr>
</table>

### Also includes

- **Command palette** (`⌘P`) — fuzzy search across all commands, workspaces, and themes
- **GPU-accelerated rendering** — WebGL terminal renderer for smooth scrolling and fast TUI apps
- **Bundled Nerd Font** — JetBrainsMono Nerd Font Mono included, powerline glyphs work out of the box
- **Flow control** — PTY backpressure prevents the terminal from choking on fast output
- **Process cleanup** — closing a tab kills the child process tree (no zombie processes)
- **Ctrl+Tab / Ctrl+Shift+Tab** — cycle through tabs in the active pane
- **Extension system** — extensible architecture for sidebar tabs, surface types, commands, and context menus ([build your first extension](docs/extension-getting-started.md))
- **Cross-platform** — macOS and Linux via Tauri v2

### Shell integration

GnarTerm automatically installs shell integration for CWD tracking — no manual config needed.

- **zsh:** On startup, GnarTerm writes a `.zshenv` to `~/.config/gnar-term/shell/` and sets `ZDOTDIR` to that directory. The integration file sources your original `.zshenv` (via `GNARTERM_ORIG_ZDOTDIR`), restores `ZDOTDIR`, and hooks into `precmd`/`chpwd` to report the current directory via OSC 7.
- **bash:** GnarTerm writes `bash-integration.sh` to `~/.config/gnar-term/shell/` and sets `GNARTERM_SHELL_INTEGRATION` to that path. Add `[ -n "$GNARTERM_SHELL_INTEGRATION" ] && source "$GNARTERM_SHELL_INTEGRATION"` to your `.bashrc` to enable CWD tracking.

This is how `api.getActiveCwd()`, tab title updates, and directory inheritance for new tabs/splits work under the hood.

## CLI Usage

```bash
gnar-term [PATH]                     # open with working directory
gnar-term -e <COMMAND>               # run a command in the terminal
gnar-term -d <DIR>                   # explicit working directory flag
gnar-term --title <TITLE>            # set window/workspace title
gnar-term -w <NAME>                  # load a named workspace from config
gnar-term -c <FILE>                  # use a specific config file
gnar-term --help                     # show all options
gnar-term --version                  # print version
```

**Examples:**

```bash
# Open in a project directory (workspace named after the folder)
gnar-term ~/projects/myapp

# Open and run a dev server
gnar-term ~/projects/myapp -e "npm run dev"

# Load a saved workspace layout
gnar-term -w Dev

# Custom window title
gnar-term --title "API Server" ~/projects/api
```

When launched without arguments, gnar-term loads workspaces from config (if `autoload` is set) or opens a default workspace.

## Install

### Homebrew (macOS)

```bash
brew tap TheGnarCo/tap
brew install --cask gnar-term
```

### Download

Grab the latest release for your platform:

**[GitHub Releases](https://github.com/TheGnarCo/gnar-term/releases/latest)**

- **macOS** — `.dmg` (Apple Silicon + Intel, signed and notarized)
- **Linux** — `.AppImage` / `.deb` / `.rpm`

### Build from source

**Prerequisites:** Node.js 20+, Rust stable toolchain. macOS and Linux only (Windows is not a build target).

On Linux you also need WebKitGTK and related libraries:

```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
```

```bash
git clone https://github.com/TheGnarCo/gnar-term.git
cd gnar-term
npm install
npm run build
```

The built app will be in `src-tauri/target/release/bundle/`.

### Development

```bash
npm install                 # installs deps + lefthook git hooks
npm run dev                 # start Tauri dev server with hot reload
npm test                    # run unit tests (vitest)
npm run typecheck           # tsc --noEmit
npm run check               # svelte-check
npm run lint                # eslint
npm run format              # prettier --write
npm run vite:build          # frontend-only build (no Rust toolchain needed)
npm run build               # full Tauri build (frontend + Rust)
```

## Keyboard shortcuts

### Workspaces

| Shortcut  | Action                 |
| --------- | ---------------------- |
| `⌘N`      | New workspace          |
| `⌘1`–`⌘8` | Jump to workspace 1–8  |
| `⌘9`      | Jump to last workspace |
| `⌃⌘]`     | Next workspace         |
| `⌃⌘[`     | Previous workspace     |
| `⇧⌘W`     | Close workspace        |
| `⇧⌘R`     | Rename workspace       |
| `⌘B`      | Toggle sidebar         |

### Surfaces (tabs)

| Shortcut | Action       |
| -------- | ------------ |
| `⌘T`     | New tab      |
| `⇧⌘]`    | Next tab     |
| `⇧⌘[`    | Previous tab |
| `⌃Tab`   | Next tab     |
| `⌃⇧Tab`  | Previous tab |
| `⌘W`     | Close tab    |

### Split panes

| Shortcut  | Action                   |
| --------- | ------------------------ |
| `⌘D`      | Split right              |
| `⇧⌘D`     | Split down               |
| `⌥⌘←→↑↓`  | Focus pane directionally |
| `⇧⌘Enter` | Toggle pane zoom         |
| `⇧⌘H`     | Flash focused panel      |

### General

| Shortcut | Action           |
| -------- | ---------------- |
| `⌘P`     | Command palette  |
| `⌘K`     | Clear scrollback |

## Config

gnar-term reads configuration from:

1. `./settings.json` (per-project)
2. `./gnar-term.json` (legacy per-project)
3. `./cmux.json` (per-project cmux compat)
4. `~/.config/gnar-term/settings.json` (global)
5. `~/.config/cmux/cmux.json` (global cmux compat)

The config format is a superset of [cmux.json](https://cmux.com/docs/custom-commands). Any valid `cmux.json` works as a `settings.json`.

### gnar-term extensions

| Key                                             | Type         | Description                                                  |
| ----------------------------------------------- | ------------ | ------------------------------------------------------------ |
| `theme`                                         | string       | Theme ID (e.g. `"tokyo-night"`, `"molly"`, `"github-light"`) |
| `autoload`                                      | string[]     | Workspace command names to launch on startup                 |
| `commands[].workspace.layout...surfaces[].type` | `"markdown"` | Markdown preview surface (in addition to `"terminal"`)       |

### Available theme IDs

`github-dark`, `tokyo-night`, `catppuccin-mocha`, `dracula`, `solarized-dark`, `one-dark`, `molly`, `molly-disco`, `github-light`, `solarized-light`, `catppuccin-latte`

## Extensions

GnarTerm has an extension system for adding sidebar tabs, surface types, commands, context menu items, overlays, workspace actions, and settings pages. The built-in preview system, file browser, GitHub integration, and project management are all implemented as extensions.

Extensions are standalone directories that can live anywhere — in the GnarTerm repo, in a separate project, or in their own git repository.

| Resource                                                 | Description                                               |
| -------------------------------------------------------- | --------------------------------------------------------- |
| **[Getting Started](docs/extension-getting-started.md)** | Build your first extension in 10 minutes                  |
| **[EXTENSIONS.md](EXTENSIONS.md)**                       | Full API reference (manifest, methods, events, commands)  |
| **[Extension Cookbook](docs/extension-cookbook.md)**     | Step-by-step recipes for common patterns                  |
| **[Development Guide](docs/extension-development.md)**   | Project setup, building, testing, debugging, distribution |

## MCP integration (agent orchestration)

Gnar Term ships an optional MCP (Model Context Protocol) server that lets
an AI agent — Claude Code, Cursor, or anything else that speaks MCP over
stdio — drive **real, visible gnar-term panes**. The agent calls tools
like `spawn_agent`, `send_prompt`, and `read_output`; each call creates
or acts on a live pane the user can see in gnar-term.

**Gnar Term is a terminal first.** The MCP module is a strictly optional
feature: if you never install Claude Code, you will never see or pay any
cost for the MCP plumbing. There is no sidecar to build, no extra
process, and no configuration required unless you want to disable it.

### Settings

A single field in `gnar-term.json` controls the module:

```json
{ "mcp": "auto" }
```

- **`auto`** (default) — enable if Claude Code is detected (`claude` on
  PATH or `~/.claude.json` exists). Otherwise completely dormant: no
  Unix socket bound, no files outside gnar-term's own config touched,
  no extra threads.
- **`on`** — always enable the module.
- **`off`** — hard opt-out. The module never starts and `~/.claude.json`
  is never read or written.

### Architecture

```
                              gnar-term (single binary)
                              ───────────────────────
[Claude Code]  --stdio-->  [gnar-term --mcp-stdio]   byte
                              (shim, ~30 LOC Rust)   pipe
                                       │
                                    UDS (chmod 600)
                                       │
                              [Rust UDS bridge]  ──events──>  [Webview MCP server]
                              (no protocol parsing)            (JSON-RPC + 19 tools
                                                                in ~500 LOC TypeScript)
```

There is no sidecar package. Claude Code spawns `gnar-term --mcp-stdio`
as a subprocess; that mode is a pure byte pipe that connects stdin/stdout
to the Unix domain socket exposed by the running gnar-term GUI. The Rust
bridge forwards raw bytes; the MCP protocol and all tool handlers live in
TypeScript inside the webview. **Adding a new tool is a pure TypeScript
change in `src/lib/services/mcp-server.ts`.**

Security: the socket is chmod'd 600 so only the owning user can connect.
There is no network listening port, no HTTP, no auth token, and no
DNS-rebinding attack surface. Same-user trust boundary.

### Automatic registration

On first launch when MCP is enabled, gnar-term registers itself with
Claude Code by shelling out to `claude mcp add-json -s user gnar-term ...`
with a pointer to its own binary. If the CLI isn't available, it falls
back to an atomic write of `~/.claude.json`. After registration you only
need to restart Claude Code once; no manual `claude mcp add` is needed.

### The 19 tools

| Category | Tools |
|---|---|
| Session management | `spawn_agent`, `list_sessions`, `get_session_info`, `kill_session` |
| Interaction | `send_prompt`, `send_keys`, `read_output` |
| Orchestration | `dispatch_tasks` |
| UI writes | `render_sidebar`, `remove_sidebar_section`, `create_preview` |
| UI introspection | `get_active_workspace`, `list_workspaces`, `get_active_pane`, `list_panes` |
| Lifecycle events | `poll_events` |
| Filesystem | `list_dir`, `read_file`, `file_exists` |

See the Spacebase spec (doc id `jzvBxDRrkevx`) for full argument schemas
and the wire-level contract, or read `src/lib/services/mcp-server.ts` for
the authoritative TypeScript definitions.

### Integration test harness

A Node script at `tests/mcp-integration.mjs` speaks JSON-RPC 2.0 over the
UDS to a running gnar-term instance. Useful for smoke-testing a real
build end-to-end:

```bash
# Start gnar-term (with mcp: "on" or mcp: "auto" + Claude Code installed)
node tests/mcp-integration.mjs
```

The harness exercises `initialize`, `tools/list`, `list_workspaces`,
`poll_events`, and `render_sidebar`/`remove_sidebar_section`.

## Architecture

Built with:

- **[Tauri v2](https://tauri.app)** — native app shell, Rust backend
- **[xterm.js](https://xtermjs.org)** — terminal emulation with WebGL GPU rendering
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
