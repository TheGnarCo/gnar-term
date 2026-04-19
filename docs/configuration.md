---
title: Configuration
nav_order: 4
---

# Configuration

gnar-term reads configuration from (in priority order):

1. `./settings.json` (per-project)
2. `./gnar-term.json` (legacy per-project)
3. `./cmux.json` (per-project cmux compat)
4. `~/.config/gnar-term/settings.json` (global)
5. `~/.config/cmux/cmux.json` (global cmux compat)

The config format is a superset of [cmux.json](https://cmux.com/docs/custom-commands). Any valid `cmux.json` works as a `settings.json`.

## Settings

| Key                                             | Type         | Description                                                  |
| :---------------------------------------------- | :----------- | :----------------------------------------------------------- |
| `theme`                                         | string       | Theme ID (e.g. `"tokyo-night"`, `"molly"`, `"github-light"`) |
| `autoload`                                      | string[]     | Workspace command names to launch on startup                 |
| `commands[].workspace.layout...surfaces[].type` | `"markdown"` | Markdown preview surface (in addition to `"terminal"`)       |

## Available theme IDs

`github-dark`, `tokyo-night`, `catppuccin-mocha`, `dracula`, `solarized-dark`, `one-dark`, `molly`, `molly-disco`, `github-light`, `solarized-light`, `catppuccin-latte`

## Example

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
