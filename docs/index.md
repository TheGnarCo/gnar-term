---
title: Home
layout: home
nav_order: 1
---

# gnar-term

{: .fs-9 }

A cross-platform terminal workspace manager with built-in file previews, themes, and cmux-compatible config.
{: .fs-6 .fw-300 }

[Download Latest Release](https://github.com/TheGnarCo/gnar-term/releases/latest){: .btn .btn-primary .fs-5 .mb-4 .mb-md-0 .mr-2 }
[View on GitHub](https://github.com/TheGnarCo/gnar-term){: .btn .fs-5 .mb-4 .mb-md-0 }

---

![gnar-term screenshot](screenshot.png)

## Why gnar-term?

I love [cmux](https://github.com/manaflow-ai/cmux). It's currently my favorite terminal multiplexer for working with AI coding agents. But there were a few things I wanted:

- **Cross-platform** --- cmux is macOS-only (Swift/AppKit). gnar-term runs on macOS and Linux via Tauri.
- **Built-in file previews** --- Click a file path in the terminal and preview it right there. Markdown, PDFs, CSVs, images, video, and more.
- **Command palette** --- `Cmd+P` to fuzzy-search commands, switch workspaces, change themes, and load saved layouts.
- **Themes** --- 11 built-in themes (6 dark, 5 light) that switch instantly and persist across restarts.
- **cmux-compatible config** --- Your `cmux.json` workspace definitions work in gnar-term. Copy it over and go.
- **Extension system** --- Sidebar tabs, surface types, commands, and context menus are all extensible.

## Install

### Homebrew (macOS)

```bash
brew tap TheGnarCo/tap
brew install --cask gnar-term
```

### Direct download

Grab the latest release for your platform from [GitHub Releases](https://github.com/TheGnarCo/gnar-term/releases/latest):

- **macOS** --- `.dmg` (Apple Silicon + Intel, signed and notarized)
- **Linux** --- `.AppImage` / `.deb` / `.rpm`

### Build from source

**Prerequisites:** Node.js 20+, Rust stable toolchain. macOS and Linux only.

```bash
git clone https://github.com/TheGnarCo/gnar-term.git
cd gnar-term
npm install
npm run build
```

## Features

| Feature                    | Description                                                                             |
| :------------------------- | :-------------------------------------------------------------------------------------- |
| **Workspace management**   | Vertical sidebar tabs with drag-to-reorder, inline rename, and workspace close on hover |
| **Split panes**            | Horizontal (`Cmd+D`) and vertical (`Shift+Cmd+D`) splits with binary tree layout        |
| **File previews**          | Markdown, PDF, CSV, images, video, JSON, YAML, TOML, and plain text                     |
| **11 built-in themes**     | GitHub Dark, Tokyo Night, Catppuccin Mocha, Dracula, Solarized, Molly, and more         |
| **cmux-compatible config** | Drop in your `cmux.json` and it just works                                              |
| **Command palette**        | `Cmd+P` for fuzzy search across all commands, workspaces, and themes                    |
| **GPU rendering**          | WebGL terminal renderer for smooth scrolling                                            |
| **Extension system**       | Add sidebar tabs, surface types, commands, and context menus                            |
| **CWD tracking**           | New tabs inherit the working directory. Automatic OSC 7 shell integration               |
| **Cross-platform**         | macOS and Linux via Tauri v2                                                            |

## Quick links

- [Keyboard Shortcuts](keyboard-shortcuts)
- [CLI Usage](cli-usage)
- [Configuration](configuration)
- [Build your first extension](extension-getting-started)
- [Extension API Reference](extension-api-reference)
