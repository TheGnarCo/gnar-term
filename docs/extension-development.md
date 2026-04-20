---
title: Development Guide
parent: Extensions
nav_order: 4
---

# Extension Development Guide

How to create, build, test, and debug GnarTerm extensions — both included (in the GnarTerm repo) and external (in your own repo).

> **New to extensions?** Start with the [Getting Started Guide](extension-getting-started.md) to build your first extension. Come back here for the full development workflow.
>
> **API reference:** See [EXTENSIONS.md](../EXTENSIONS.md) for the complete API surface.

## Project Setup

### 1. Create the directory structure

```
my-extension/
  extension.json       # manifest
  src/
    index.ts           # entry point
    MyComponent.svelte # UI component (if needed)
  dist/
    index.js           # bundled output (generated)
  package.json
  tsconfig.json
```

### 2. Initialize the project

```bash
mkdir my-extension && cd my-extension
bun init
bun add -d svelte typescript vite
```

### 3. Add the type definitions

Copy the standalone API types file for compile-time safety:

```bash
curl -O https://raw.githubusercontent.com/TheGnarCo/gnar-term/main/src/extensions/api.ts
```

This file is self-contained (depends only on `svelte/store`). It provides the `ExtensionAPI`, `ExtensionManifest`, `WorkspaceRef`, `PaneRef`, `SurfaceRef`, `DirEntry`, and all other types your extension needs.

### 4. Write the manifest

```json
{
  "id": "my-extension",
  "name": "My Extension",
  "version": "0.1.0",
  "description": "What it does in one line",
  "entry": "./dist/index.js",
  "contributes": {
    "commands": [{ "id": "hello", "title": "Say Hello" }]
  }
}
```

See [EXTENSIONS.md — Manifest Reference](../EXTENSIONS.md#manifest-reference) for all fields.

### 5. Write the entry point

```typescript
// src/index.ts
import type { ExtensionAPI } from "./api";

export default function register(api: ExtensionAPI) {
  api.onActivate(() => {
    api.registerCommand("hello", () => {
      console.log("Hello from my extension!");
    });
  });
}
```

## Building

Extensions must be bundled into a single ES module. The output must have a `default` export matching `ExtensionRegisterFn`.

### Vite (recommended)

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte()],
  build: {
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: () => "index.js",
    },
    outDir: "dist",
    rollupOptions: {
      external: ["svelte", "svelte/store", "svelte/internal"],
    },
  },
});
```

```bash
bun run vite build
```

### esbuild (simpler, no Svelte components)

```bash
bun run esbuild src/index.ts --bundle --format=esm --outfile=dist/index.js \
  --external:svelte --external:svelte/store
```

### Key bundling rules

- **Format:** ES module (`export default function register...`)
- **Externals:** Always externalize `svelte` and `svelte/store` — the host provides these
- **Single file:** The entry point must resolve to one JS file
- **No Tauri imports:** Never import from `@tauri-apps/api` — use `api.invoke()` instead

## Installing

Install your extension from the GnarTerm Settings overlay:

1. Open Settings (gear icon in the title bar, or `Cmd+,`)
2. Go to the **Extensions** page
3. Click **Install from path**
4. Select your extension directory (the one containing `extension.json`)

The extension is validated, registered, activated, and persisted to `~/.config/gnar-term/settings.json`.

Alternatively, during development you can restart GnarTerm after adding the extension to settings.json manually:

```json
{
  "extensions": {
    "my-extension": {
      "enabled": true,
      "source": "local:/path/to/my-extension"
    }
  }
}
```

## Testing

### Unit testing with Vitest

Mock the `ExtensionAPI` and test your extension logic directly:

```typescript
import { describe, it, expect, vi } from "vitest";
import register from "../src/index";
import type { ExtensionAPI } from "../src/api";

function makeMockApi(): ExtensionAPI {
  let _onActivate: (() => void) | undefined;

  const api = {
    onActivate: vi.fn((cb) => {
      _onActivate = cb;
    }),
    onDeactivate: vi.fn(),
    registerCommand: vi.fn(),
    invoke: vi.fn(),
    state: {
      get: vi.fn(),
      set: vi.fn(),
    },
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    // Activate after registration
    _activate: () => _onActivate?.(),
  } as unknown as ExtensionAPI & { _activate: () => void };

  return api;
}

describe("my-extension", () => {
  it("registers a command on activate", () => {
    const api = makeMockApi();
    register(api);
    (api as any)._activate();

    expect(api.registerCommand).toHaveBeenCalledWith(
      "hello",
      expect.any(Function),
    );
  });
});
```

### What to test

- **Registration:** Verify that `onActivate` registers expected commands, sidebar tabs, etc.
- **Event handlers:** Simulate events and verify state changes
- **State persistence:** Mock `api.state.get/set` and verify read/write patterns
- **Tauri commands:** Mock `api.invoke` and verify it's called with correct args
- **Error handling:** Verify graceful degradation when `invoke` rejects

### Integration testing

For testing with real GnarTerm, install the extension and use the browser DevTools:

1. Run GnarTerm in dev mode: `npm run dev` (or `cargo tauri dev`)
2. Open DevTools: right-click in the app and select "Inspect"
3. Check the Console for your extension's log output
4. Use the Elements tab to inspect your Svelte components
5. Use the Network tab to debug Tauri command invocations

## Debugging

### Console logging

Extensions run in the WebView context. Use `console.log()`, `console.warn()`, and `console.error()` — output appears in the browser DevTools console.

### Common issues

| Symptom                             | Likely cause                                                                                                                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Extension doesn't load              | Check `extension.json` is valid JSON with required fields (`id`, `name`, `version`, `entry`)                                                                                        |
| Entry point not found               | Verify `entry` path is relative and the file exists after building                                                                                                                  |
| `api.on()` throws "not declared"    | Add the event to `contributes.events` in your manifest                                                                                                                              |
| `api.invoke()` throws "not allowed" | The command isn't in the allowlist. Check [EXTENSIONS.md — Tauri Commands](../EXTENSIONS.md#tauri-commands)                                                                         |
| UI doesn't appear                   | Verify you called the registration method inside `onActivate`, not at the top level of `register()`                                                                                 |
| State not persisting                | `api.state.set()` debounces writes by 300ms — state isn't written instantly. Also check that the extension activates successfully (errors during activation may prevent state load) |
| Styles don't match theme            | Use `$theme` properties from `api.theme` instead of hardcoded colors                                                                                                                |

### Activation failure recovery

If your `onActivate` throws, core automatically:

1. Rolls back all registrations made during the failing activation
2. Removes all event subscriptions
3. On first install, marks the extension as `enabled: false` to prevent boot loops

Check the DevTools console for the error message.

## Extension Lifecycle

```
install → register() → [state loaded] → onActivate() → [running] → onDeactivate() → [cleanup]
                                                           ↑                ↓
                                                           └── re-enable ───┘
```

| Phase          | What happens                                                                 | Your code runs?      |
| -------------- | ---------------------------------------------------------------------------- | -------------------- |
| **Install**    | Manifest validated, entry point loaded via `import()`                        | No                   |
| **Register**   | `register(api)` called — set up `onActivate`/`onDeactivate`                  | Yes (synchronously)  |
| **State load** | Persisted state loaded from `~/.config/gnar-term/extensions/<id>/state.json` | No                   |
| **Activate**   | `onActivate()` fires — register UI, commands, event handlers                 | Yes                  |
| **Running**    | Events fire, users interact with your UI                                     | Yes (event handlers) |
| **Deactivate** | `onDeactivate()` fires, then all registrations auto-cleaned                  | Yes (cleanup only)   |

## Svelte Component Patterns

### Accessing the API

All extension components are wrapped in an `ExtensionWrapper` that injects the API via Svelte context:

```svelte
<script lang="ts">
  import { getContext } from "svelte";
  import { EXTENSION_API_KEY, type ExtensionAPI } from "./api";

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const theme = api.theme;
</script>
```

### Reactive stores

Use Svelte's `$` prefix with the read-only stores:

```svelte
<script>
  const workspaces = api.workspaces;
  const activeWs = api.activeWorkspace;
</script>

<p>Active: {$activeWs?.name} ({$workspaces.length} total)</p>
```

### Theme integration

Always use theme values. Never hardcode colors:

```svelte
<div
  style="color: {$theme.fg}; background: {$theme.bg}; border: 1px solid {$theme.border};"
>
  Content
</div>
```

## Development Workflow

### Hot-reload during development

GnarTerm doesn't hot-reload extensions automatically, but you can set up a fast iteration loop:

```bash
# Terminal 1: watch and rebuild on source changes
bun run vite build --watch
```

After each rebuild, toggle your extension off and on in **Settings > Extensions** to reload the new code. This is faster than restarting the entire app.

For included extensions (developed inside the GnarTerm repo), use the standard dev server:

```bash
# Rebuilds the entire app with HMR
npm run dev
```

### Debugging tips

- **Console**: `console.log()` output appears in the browser DevTools console (right-click > Inspect)
- **Network**: Use the DevTools Network tab to see Tauri IPC calls
- **Components**: The Elements tab shows your Svelte components in the DOM tree
- **State**: Call `api.state.get("key")` in the console to inspect extension state at runtime

## External vs. Included Extensions

| Aspect                    | Included                               | External                                        |
| ------------------------- | -------------------------------------- | ----------------------------------------------- |
| Location                  | `src/extensions/` in the GnarTerm repo | Any directory on the filesystem                 |
| Manifest `included` field | `true`                                 | Omitted or `false`                              |
| Build                     | Built as part of the GnarTerm frontend | Bundled separately by the extension author      |
| Installation              | Automatic — loaded on app startup      | Via Settings UI or manual `settings.json` entry |
| Capabilities              | Identical                              | Identical                                       |
| Type imports              | `from "../../lib/extension-types"`     | `from "./api"` (copied type file)               |

There is no capability difference between included and external extensions. The same API, the same security sandbox, the same registries. External extensions can do everything included extensions can.

## Distribution

### Sharing via git

The simplest way to distribute an extension is as a git repository:

```
my-gnarterm-extension/
  README.md              # installation instructions
  extension.json         # manifest
  src/                   # source code
  dist/                  # built output (commit this)
  api.ts                 # type definitions
  package.json
```

**Commit `dist/`** so users can install without building. Document the install steps in your README:

```markdown
## Install

1. Clone this repo: `git clone https://github.com/you/gnarterm-my-extension`
2. Open GnarTerm Settings > Extensions > Install from path
3. Select the cloned directory
```

### Versioning

Use semver in your `extension.json`. GnarTerm reads the `version` field for display in the Settings overlay. Users update by pulling the latest code and toggling the extension off/on.

## Reference Examples

The six included extensions in `src/extensions/` demonstrate every extension pattern. Browse them as reference:

| Extension               | Key patterns                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| `preview/`              | Surface type registration, context menu items, file type handling                            |
| `file-browser/`         | Sidebar tab + actions, directory tree, context menus, workspace actions                      |
| `agentic-orchestrator/` | Observe permission, custom events, status tracking                                           |
| `diff-viewer/`          | Surface type, commands, context menus, core event subscription (`worktree:merged`), settings |
| `project-scope/`        | Overlays, workspace claiming, dashboard tabs, color picker, event-driven auto-association    |
| `jrvs-themes/`          | Theme pack registration                                                                      |

### Included vs. External Extensions

Both types share the same capabilities and API surface. The structural difference is in manifest format:

- **Included extensions** (in `src/extensions/`) define their manifest as an exported TypeScript constant in `index.ts`. They are compiled with the app.
- **External extensions** (installed from disk) use a separate `extension.json` file alongside a bundled `dist/index.js` entry point.

When contributing a new included extension, export both the manifest and a register function from `index.ts`. See any existing extension in `src/extensions/` for the pattern.

## Troubleshooting

### Extension won't load

Check manifest validation. The following fields are required: `id`, `name`, `version`, `entry`. Common causes:

- **Entry path is invalid.** The entry path must not contain `..` or start with `/`. It must be a relative path within the extension directory.
- **Extension ID format.** The ID must be lowercase alphanumeric with hyphens only (e.g., `my-extension`). Uppercase letters, underscores, and spaces are rejected.
- **Missing required fields.** All four fields (`id`, `name`, `version`, `entry`) must be present. A missing field silently prevents loading.

Check the browser console (DevTools) for specific validation error messages.

### Surface doesn't render

Surface type IDs are auto-namespaced by the extension system. When you call:

```typescript
api.registerSurfaceType("mysurface", MySurfaceComponent);
```

The registered ID becomes `your-ext-id:mysurface`. The `api.openSurface()` method also auto-namespaces, so pass the bare surface ID:

```typescript
// Correct — pass the bare ID
api.openSurface("mysurface", { props });

// Wrong — do NOT include your extension prefix
api.openSurface("your-ext-id:mysurface", { props });
```

### Events not firing

Events must be declared in the manifest `contributes.events` array before calling `api.on()`. Undeclared events throw an error at registration time.

- **Custom events** must use the `extension:` prefix (e.g., `extension:harness:statusChanged`).
- **Core events** (like `surface:created`, `workspace:created`) must also be listed in your manifest to subscribe.
- Check the console for "Event not declared in manifest" errors.

### Commands not appearing in palette

Commands must be declared in `contributes.commands` with both `id` and `title`:

```json
{
  "contributes": {
    "commands": [{ "id": "my-command", "title": "Do Something" }]
  }
}
```

The command ID you pass to `api.registerCommand()` should be the bare ID without your extension prefix — the system adds the prefix automatically:

```typescript
// Correct
api.registerCommand("my-command", handler);

// Wrong — prefix is added for you
api.registerCommand("my-ext:my-command", handler);
```

## Related Docs

- [Getting Started](extension-getting-started.md) — Build your first extension
- [EXTENSIONS.md](../EXTENSIONS.md) — Full API reference
- [Registry System](registry-system.md) — How registries work
- [Extension Cookbook](extension-cookbook.md) — Recipes for common patterns
- [ADR-001](adr/001-extension-architecture.md) — Architecture decisions
- [Glossary](glossary.md) — Term definitions
