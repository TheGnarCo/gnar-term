---
title: CLI Usage
nav_order: 3
---

# CLI Usage

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

## Examples

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

## Shell integration

GnarTerm automatically installs shell integration for CWD tracking --- no manual config needed.

- **zsh:** On startup, GnarTerm writes a `.zshenv` to `~/.config/gnar-term/shell/` and sets `ZDOTDIR` to that directory. The integration file sources your original `.zshenv` (via `GNARTERM_ORIG_ZDOTDIR`), restores `ZDOTDIR`, and hooks into `precmd`/`chpwd` to report the current directory via OSC 7.
- **bash:** GnarTerm writes `bash-integration.sh` to `~/.config/gnar-term/shell/` and sets `GNARTERM_SHELL_INTEGRATION` to that path. Add `[ -n "$GNARTERM_SHELL_INTEGRATION" ] && source "$GNARTERM_SHELL_INTEGRATION"` to your `.bashrc` to enable CWD tracking.

This is how `api.getActiveCwd()`, tab title updates, and directory inheritance for new tabs/splits work under the hood.
