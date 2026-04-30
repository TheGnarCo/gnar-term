# Browser Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `BrowserSurface` type that renders arbitrary URLs in a Tauri-native child webview embedded in the main window, exposed to agents via four MCP tools (`open_browser`, `navigate_browser`, `close_browser`, `list_open_browsers`).

**Architecture:** Each `BrowserSurface` creates a named Tauri `Webview` (not a `WebviewWindow`) embedded inside the existing main window — on macOS a child `WKWebView`, on Linux a child WebKitGTK view. The Svelte component renders a full-size placeholder `<div>` and uses a `locate()` lookup (same pattern as `PreviewSurface`) to self-discover its pane/workspace. A `ResizeObserver` on the placeholder sends position updates to Rust via Tauri commands so the native webview stays locked to the pane bounds. MCP tools follow the `registerTool` pattern used by `spawn_preview`, and `createBrowserSurfaceInPane` follows `createPreviewSurfaceInPane` exactly. Browser surfaces serialize naturally with workspace persistence and are restored on restart.

**Known v1 limitation:** The native webview floats above all Svelte UI (it's a sibling WKWebView/WebKitGTK view, not inside the DOM stack). Command palette, modals, and overlays will render behind an active browser surface. Fixing this requires propagating overlay-open state to Rust to temporarily hide the webview; that is out of scope for this plan.

**Tech Stack:** Tauri v2 multi-webview API, Svelte, TypeScript, Rust, Vitest

> ⚠️ **Before Task 4 (Rust module):** Verify the exact Tauri v2 API for adding a child webview to an existing window using context7:
>
> ```
> mcp__plugin_context7_context7__resolve-library-id: { libraryName: "tauri" }
> mcp__plugin_context7_context7__query-docs: { topic: "add child webview window multi-webview" }
> ```
>
> The plan uses the expected v2 API shape — confirm method names and types before writing.

---

## File Map

**Create:**

- `src/lib/components/BrowserSurface.svelte` — placeholder div + ResizeObserver + Tauri command lifecycle
- `src/lib/services/browser-surface-registry.ts` — runtime map of surfaceId → {url, paneId, workspaceId}; URL dedup for MCP
- `src-tauri/src/browser_webview.rs` — managed state + six commands: create, navigate, set_bounds, show, hide, close

**Modify:**

- `src/lib/types.ts` — add `BrowserSurface` to the `Surface` union; add `isBrowserSurface` guard
- `src/lib/services/surface-service.ts` — add `createBrowserSurfaceInPane`
- `src/lib/components/PaneView.svelte` — add `{:else if isBrowserSurface(surface)}` rendering branch
- `src/lib/services/mcp-server.ts` — register four MCP tools
- `src-tauri/src/lib.rs` — `mod browser_webview`, manage state, add six commands to invoke_handler
- `src/__tests__/browser-surface.test.ts` — unit tests for type guard, registry, surface-service, MCP handlers

---

## Task 1: BrowserSurface type

**Files:**

- Modify: `src/lib/types.ts` (after `PreviewSurface`, around line 57)
- Test: `src/__tests__/browser-surface.test.ts` (create new)

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/browser-surface.test.ts
import { describe, it, expect } from "vitest";
import { isBrowserSurface } from "../lib/types";

describe("isBrowserSurface", () => {
  it("returns true for a browser surface", () => {
    expect(
      isBrowserSurface({
        kind: "browser",
        id: "b1",
        url: "https://example.com",
        title: "Example",
      }),
    ).toBe(true);
  });

  it("returns false for terminal surfaces", () => {
    expect(isBrowserSurface({ kind: "terminal" } as any)).toBe(false);
  });

  it("returns false for preview surfaces", () => {
    expect(isBrowserSurface({ kind: "preview" } as any)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test -- browser-surface
```

Expected: `isBrowserSurface is not a function` or similar import error.

- [ ] **Step 3: Add BrowserSurface to types.ts**

After the `PreviewSurface` interface (line ~57), insert:

```typescript
export interface BrowserSurface {
  kind: "browser";
  id: string;
  url: string;
  title: string;
}

export function isBrowserSurface(s: Surface): s is BrowserSurface {
  return s.kind === "browser";
}
```

Change the existing `Surface` union at line 59:

```typescript
export type Surface =
  | TerminalSurface
  | ExtensionSurface
  | PreviewSurface
  | BrowserSurface;
```

- [ ] **Step 4: Run to confirm pass**

```bash
npm test -- browser-surface
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts src/__tests__/browser-surface.test.ts
git commit -m "feat(types): add BrowserSurface type and isBrowserSurface guard"
```

---

## Task 2: Browser surface registry

**Files:**

- Create: `src/lib/services/browser-surface-registry.ts`
- Modify: `src/__tests__/browser-surface.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/__tests__/browser-surface.test.ts`:

```typescript
import {
  registerBrowserSurface,
  unregisterBrowserSurface,
  findBrowserSurfaceByUrl,
  getBrowserSurfaceById,
  listBrowserSurfaces,
} from "../lib/services/browser-surface-registry";

describe("browser-surface-registry", () => {
  const entry = {
    surfaceId: "b1",
    url: "https://example.com",
    paneId: "pane1",
    workspaceId: "ws1",
  };

  afterEach(() => unregisterBrowserSurface("b1"));

  it("registers and retrieves by id", () => {
    registerBrowserSurface(entry);
    expect(getBrowserSurfaceById("b1")).toEqual(entry);
  });

  it("finds by url", () => {
    registerBrowserSurface(entry);
    expect(findBrowserSurfaceByUrl("https://example.com")).toEqual(entry);
  });

  it("returns undefined for unknown id", () => {
    expect(getBrowserSurfaceById("nope")).toBeUndefined();
  });

  it("lists all registered surfaces", () => {
    registerBrowserSurface(entry);
    expect(listBrowserSurfaces()).toContainEqual(entry);
  });

  it("unregisters correctly", () => {
    registerBrowserSurface(entry);
    unregisterBrowserSurface("b1");
    expect(getBrowserSurfaceById("b1")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test -- browser-surface
```

Expected: `Cannot find module '../lib/services/browser-surface-registry'`.

- [ ] **Step 3: Create browser-surface-registry.ts**

```typescript
// src/lib/services/browser-surface-registry.ts
export interface BrowserSurfaceEntry {
  surfaceId: string;
  url: string;
  paneId: string;
  workspaceId: string;
}

const registry = new Map<string, BrowserSurfaceEntry>();

export function registerBrowserSurface(entry: BrowserSurfaceEntry): void {
  registry.set(entry.surfaceId, entry);
}

export function unregisterBrowserSurface(surfaceId: string): void {
  registry.delete(surfaceId);
}

export function getBrowserSurfaceById(
  surfaceId: string,
): BrowserSurfaceEntry | undefined {
  return registry.get(surfaceId);
}

export function findBrowserSurfaceByUrl(
  url: string,
): BrowserSurfaceEntry | undefined {
  for (const entry of registry.values()) {
    if (entry.url === url) return entry;
  }
  return undefined;
}

export function listBrowserSurfaces(): BrowserSurfaceEntry[] {
  return Array.from(registry.values());
}
```

- [ ] **Step 4: Run to confirm pass**

```bash
npm test -- browser-surface
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/browser-surface-registry.ts src/__tests__/browser-surface.test.ts
git commit -m "feat(browser-surface): add browser surface registry"
```

---

## Task 3: Surface service — createBrowserSurfaceInPane

**Files:**

- Modify: `src/lib/services/surface-service.ts` (after `createPreviewSurfaceInPane`, around line 372)
- Modify: `src/__tests__/browser-surface.test.ts`

- [ ] **Step 1: Read createPreviewSurfaceInPane for reference**

Read `src/lib/services/surface-service.ts` lines 328–372 before writing. Note the exact import names used (`get`, `workspaces`, `getAllPanes`, `uid`, `workspaces.update`, `eventBus.emit`, `schedulePersist`).

- [ ] **Step 2: Write failing test**

Append to `src/__tests__/browser-surface.test.ts`:

```typescript
import { vi } from "vitest";

// Surface-service imports workspaces store and uid from types.ts.
// Mock both so we control their output.
vi.mock("../lib/stores/workspace", () => ({
  workspaces: {
    subscribe: vi.fn(),
    update: vi.fn((fn: any) => fn(mockWsState)),
    get: vi.fn(),
  },
}));
vi.mock("svelte/store", async (importOriginal) => {
  const orig = await importOriginal<typeof import("svelte/store")>();
  return { ...orig, get: vi.fn(() => mockWsState.list) };
});

const mockPane = {
  id: "pane1",
  surfaces: [] as any[],
  activeSurfaceId: null as string | null,
};
const mockWsState = {
  list: [{ id: "ws1", splitRoot: { type: "pane", pane: mockPane } }],
};

// NOTE: if the import path or store API differs from the above, adjust to match.
// The key thing to verify: after calling createBrowserSurfaceInPane, the pane has
// one surface with kind === "browser" and the correct url/title.

describe("createBrowserSurfaceInPane", () => {
  beforeEach(() => {
    mockPane.surfaces = [];
    mockPane.activeSurfaceId = null;
  });

  it("pushes a BrowserSurface onto the pane", async () => {
    const { createBrowserSurfaceInPane } =
      await import("../lib/services/surface-service");
    const result = createBrowserSurfaceInPane(
      "pane1",
      "https://localhost:3000",
      {
        title: "Dev Server",
      },
    );
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("browser");
    expect(result!.url).toBe("https://localhost:3000");
    expect(result!.title).toBe("Dev Server");
    expect(mockPane.surfaces).toContain(result);
    expect(mockPane.activeSurfaceId).toBe(result!.id);
  });

  it("defaults title to hostname when omitted", async () => {
    const { createBrowserSurfaceInPane } =
      await import("../lib/services/surface-service");
    const result = createBrowserSurfaceInPane(
      "pane1",
      "https://grafana.internal/d/foo",
    );
    expect(result!.title).toBe("grafana.internal");
  });
});
```

> The mock setup above is intentionally approximate — the exact store API (`get(workspaces)` vs `workspaces.get()`, how `getAllPanes` is exported) may differ. Read the top of `surface-service.ts` and adjust the mock to match. The intent is: after calling the function, the pane has a browser surface with the right fields.

- [ ] **Step 3: Run to confirm failure**

```bash
npm test -- browser-surface
```

Expected: `createBrowserSurfaceInPane is not a function`.

- [ ] **Step 4: Add createBrowserSurfaceInPane to surface-service.ts**

Add `BrowserSurface` to the import from `../types` at the top of surface-service.ts (it's already importing `PreviewSurface` — add `BrowserSurface` alongside it).

After `createPreviewSurfaceInPane` (around line 372), insert:

```typescript
export function createBrowserSurfaceInPane(
  paneId: string,
  url: string,
  options?: { focus?: boolean; title?: string },
): BrowserSurface | null {
  let owningWs: Workspace | undefined;
  let pane: Pane | undefined;
  for (const ws of get(workspaces)) {
    const found = getAllPanes(ws.splitRoot).find((p) => p.id === paneId);
    if (found) {
      owningWs = ws;
      pane = found;
      break;
    }
  }
  if (!pane || !owningWs) return null;

  const title = options?.title ?? new URL(url).hostname;
  const surface: BrowserSurface = {
    kind: "browser",
    id: uid(),
    url,
    title,
  };
  pane.surfaces.push(surface);
  if (options?.focus !== false) {
    pane.activeSurfaceId = surface.id;
  } else if (!pane.activeSurfaceId) {
    pane.activeSurfaceId = surface.id;
  }
  workspaces.update((l) => [...l]);
  eventBus.emit({
    type: "surface:created",
    id: surface.id,
    paneId: pane.id,
    kind: "browser",
  });
  schedulePersist();
  return surface;
}
```

> `get`, `workspaces`, `getAllPanes`, `Workspace`, `Pane`, `uid`, `eventBus`, `schedulePersist` are already in scope in this file — no new imports needed beyond `BrowserSurface`.

- [ ] **Step 5: Run to confirm pass**

```bash
npm test -- browser-surface
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/services/surface-service.ts src/__tests__/browser-surface.test.ts
git commit -m "feat(surface-service): add createBrowserSurfaceInPane"
```

---

## Task 4: Rust browser_webview module

**Files:**

- Create: `src-tauri/src/browser_webview.rs`
- Modify: `src-tauri/src/lib.rs`

> ⚠️ **Do this first:** Query context7 for the exact Tauri v2 API:
>
> ```
> resolve-library-id: "tauri"
> query-docs: "add child webview to window WebviewBuilder multi-webview"
> ```
>
> The code below uses the expected v2 API shape. Adjust method names, type params, and import paths to match what context7 returns before writing.

- [ ] **Step 1: Create browser_webview.rs**

```rust
// src-tauri/src/browser_webview.rs
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State, WebviewBuilder, WebviewUrl};

pub struct BrowserWebviewState(pub Mutex<HashMap<String, tauri::Webview<tauri::Wry>>>);

impl BrowserWebviewState {
    pub fn new() -> Self {
        BrowserWebviewState(Mutex::new(HashMap::new()))
    }
}

#[tauri::command]
pub fn create_browser_webview(
    app: AppHandle,
    state: State<'_, BrowserWebviewState>,
    label: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let parsed_url = url.parse().map_err(|e| format!("Invalid URL: {e}"))?;
    // `window()` unwraps the Window from the WebviewWindow; verify method name with context7.
    let window = app
        .get_webview_window("main")
        .ok_or("Main window not found")?
        .window();

    let webview = window
        .add_child(
            WebviewBuilder::new(&label, WebviewUrl::External(parsed_url)),
            tauri::LogicalPosition::new(x, y),
            tauri::LogicalSize::new(width, height),
        )
        .map_err(|e| e.to_string())?;

    state.0.lock().unwrap().insert(label, webview);
    Ok(())
}

#[tauri::command]
pub fn navigate_browser_webview(
    state: State<'_, BrowserWebviewState>,
    label: String,
    url: String,
) -> Result<(), String> {
    let map = state.0.lock().unwrap();
    let webview = map.get(&label).ok_or_else(|| format!("No webview: {label}"))?;
    let parsed_url: tauri::Url = url.parse().map_err(|e| format!("Invalid URL: {e}"))?;
    // Verify the navigation method name with context7 — may be `navigate`, `load_url`, etc.
    webview.navigate(parsed_url).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_browser_webview_bounds(
    state: State<'_, BrowserWebviewState>,
    label: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let map = state.0.lock().unwrap();
    let webview = map.get(&label).ok_or_else(|| format!("No webview: {label}"))?;
    // Verify set_bounds / set_position+set_size API with context7.
    webview
        .set_bounds(tauri::Rect {
            position: tauri::Position::Logical(tauri::LogicalPosition::new(x, y)),
            size: tauri::Size::Logical(tauri::LogicalSize::new(width, height)),
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn show_browser_webview(
    state: State<'_, BrowserWebviewState>,
    label: String,
) -> Result<(), String> {
    let map = state.0.lock().unwrap();
    let webview = map.get(&label).ok_or_else(|| format!("No webview: {label}"))?;
    webview.show().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn hide_browser_webview(
    state: State<'_, BrowserWebviewState>,
    label: String,
) -> Result<(), String> {
    let map = state.0.lock().unwrap();
    let webview = map.get(&label).ok_or_else(|| format!("No webview: {label}"))?;
    webview.hide().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn close_browser_webview(
    state: State<'_, BrowserWebviewState>,
    label: String,
) -> Result<(), String> {
    let webview = state.0.lock().unwrap().remove(&label);
    if let Some(webview) = webview {
        webview.close().map_err(|e| e.to_string())
    } else {
        Ok(()) // Already gone — idempotent
    }
}
```

- [ ] **Step 2: Register in lib.rs**

Near the top of `src-tauri/src/lib.rs` (where other module declarations live), add:

```rust
mod browser_webview;
```

In the `.setup(|app, _| { ... })` closure, after other `app.manage(...)` calls, add:

```rust
app.manage(browser_webview::BrowserWebviewState::new());
```

In the `.invoke_handler(tauri::generate_handler![...])` call, add all six commands (find the existing list and append):

```rust
browser_webview::create_browser_webview,
browser_webview::navigate_browser_webview,
browser_webview::set_browser_webview_bounds,
browser_webview::show_browser_webview,
browser_webview::hide_browser_webview,
browser_webview::close_browser_webview,
```

- [ ] **Step 3: cargo check**

```bash
cargo check
```

Expected: no errors. If method names differ from the context7 docs, fix them now before proceeding.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/browser_webview.rs src-tauri/src/lib.rs
git commit -m "feat(tauri): add browser_webview Rust module with create/navigate/bounds/show/hide/close"
```

---

## Task 5: BrowserSurface.svelte

**Files:**

- Create: `src/lib/components/BrowserSurface.svelte`

No vitest test — ResizeObserver + Tauri invoke can't be exercised without a running app. Cover via manual test in Task 7.

- [ ] **Step 1: Read PreviewSurface.svelte for the locate() pattern**

Read `src/lib/components/PreviewSurface.svelte` lines 1–60 to confirm the exact `locate()` shape used. The implementation below mirrors it.

- [ ] **Step 2: Create BrowserSurface.svelte**

```svelte
<!-- src/lib/components/BrowserSurface.svelte -->
<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { get } from "svelte/store";
  import { invoke } from "@tauri-apps/api/core";
  import type { BrowserSurface } from "../types";
  import { getAllPanes } from "../types";
  import { workspaces } from "../stores/workspace";
  import {
    registerBrowserSurface,
    unregisterBrowserSurface,
  } from "../services/browser-surface-registry";

  export let surface: BrowserSurface;
  export let visible: boolean;

  let placeholder: HTMLDivElement;
  let observer: ResizeObserver | undefined;
  let ready = false;

  function locate(): { paneId: string; workspaceId: string } | null {
    for (const ws of get(workspaces)) {
      for (const pane of getAllPanes(ws.splitRoot)) {
        if (pane.surfaces.some((s) => s.id === surface.id)) {
          return { paneId: pane.id, workspaceId: ws.id };
        }
      }
    }
    return null;
  }

  async function syncBounds() {
    if (!ready) return;
    const rect = placeholder.getBoundingClientRect();
    await invoke("set_browser_webview_bounds", {
      label: surface.id,
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    });
  }

  onMount(async () => {
    const loc = locate();
    if (loc) {
      registerBrowserSurface({
        surfaceId: surface.id,
        url: surface.url,
        paneId: loc.paneId,
        workspaceId: loc.workspaceId,
      });
    }

    const rect = placeholder.getBoundingClientRect();
    await invoke("create_browser_webview", {
      label: surface.id,
      url: surface.url,
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    });
    ready = true;

    observer = new ResizeObserver(syncBounds);
    observer.observe(placeholder);

    if (!visible) {
      await invoke("hide_browser_webview", { label: surface.id });
    }
  });

  onDestroy(async () => {
    observer?.disconnect();
    unregisterBrowserSurface(surface.id);
    await invoke("close_browser_webview", { label: surface.id });
  });

  $: if (ready) {
    if (visible) {
      syncBounds().then(() =>
        invoke("show_browser_webview", { label: surface.id }),
      );
    } else {
      invoke("hide_browser_webview", { label: surface.id });
    }
  }
</script>

<div bind:this={placeholder} class="browser-placeholder" />

<style>
  .browser-placeholder {
    width: 100%;
    height: 100%;
    background: transparent;
  }
</style>
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/BrowserSurface.svelte
git commit -m "feat(ui): add BrowserSurface.svelte with ResizeObserver positioning"
```

---

## Task 6: PaneView.svelte — add browser surface rendering

**Files:**

- Modify: `src/lib/components/PaneView.svelte` (around lines 8–18 for imports; line 364 for the rendering block)

- [ ] **Step 1: Add import**

At the top of `PaneView.svelte`, alongside the `PreviewSurface` import (line 8):

```svelte
import BrowserSurface from "./BrowserSurface.svelte";
```

Alongside the `isPreviewSurface` import (line 18), add:

```svelte
isBrowserSurface,
```

- [ ] **Step 2: Add rendering branch**

After the `{:else if isPreviewSurface(surface)}` block (line 364–370), add:

```svelte
{:else if isBrowserSurface(surface)}
  <BrowserSurface
    {surface}
    visible={surface.id === pane.activeSurfaceId}
  />
```

- [ ] **Step 3: Build check**

```bash
npm run build
```

Expected: no TypeScript or Svelte errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/PaneView.svelte
git commit -m "feat(ui): render BrowserSurface in PaneView"
```

---

## Task 7: MCP tools

**Files:**

- Modify: `src/lib/services/mcp-server.ts` (after the `create_preview_file` tool block, around line 1300)
- Modify: `src/__tests__/browser-surface.test.ts`

- [ ] **Step 1: Read spawn_preview handler for reference**

Read `src/lib/services/mcp-server.ts` lines 1199–1264 before writing. Note the exact shape of `registerTool`, `resolveTarget`, `pickHostPane`, and `focusSurfaceById`. Confirm which imports are available at the top of the file.

- [ ] **Step 2: Write failing tests for MCP tool logic**

The MCP tool handlers in mcp-server.ts are inline closures registered via `registerTool` — they can't be imported directly. Test them by exercising `browser-surface-registry` + `surface-service` (already tested in Tasks 1–3). For MCP-layer dedup logic, write an integration-style test that mocks the registry:

Append to `src/__tests__/browser-surface.test.ts`:

```typescript
import { findBrowserSurfaceByUrl } from "../lib/services/browser-surface-registry";
import { vi } from "vitest";

// Smoke test: dedup logic that open_browser handler will use
describe("open_browser dedup logic", () => {
  it("returns the existing surface when url already registered", () => {
    registerBrowserSurface({
      surfaceId: "existing-1",
      url: "https://localhost:3000",
      paneId: "p1",
      workspaceId: "ws1",
    });
    const found = findBrowserSurfaceByUrl("https://localhost:3000");
    expect(found?.surfaceId).toBe("existing-1");
    unregisterBrowserSurface("existing-1");
  });

  it("returns undefined for a url not yet open", () => {
    expect(findBrowserSurfaceByUrl("https://not-open.com")).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run to confirm pass**

```bash
npm test -- browser-surface
```

Expected: all tests PASS (these tests exercise the same registry already tested in Task 2).

- [ ] **Step 4: Add imports to mcp-server.ts**

At the top of `src/lib/services/mcp-server.ts`, alongside other service imports, add:

```typescript
import {
  findBrowserSurfaceByUrl,
  getBrowserSurfaceById,
  listBrowserSurfaces,
} from "./browser-surface-registry";
import { createBrowserSurfaceInPane } from "./surface-service";
```

> `invoke` from `@tauri-apps/api/core` and `focusSurfaceById`, `closeSurfaceById`, `resolveTarget`, `pickHostPane` are already in scope — confirm by checking the top of the file.

- [ ] **Step 5: Register the four MCP tools**

After the `create_preview_file` `registerTool` block (around line 1300), add:

```typescript
// ---- Browser surfaces ----

registerTool({
  name: "open_browser",
  description:
    "Open a URL in a native browser surface inside a pane. If a browser surface for the same URL is already open anywhere in the app, focuses it instead of opening a duplicate. Returns the surface id.",
  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "URL to open (must be http:// or https://).",
      },
      title: {
        type: "string",
        description: "Tab label. Defaults to the URL hostname.",
      },
      pane_id: {
        type: "string",
        description: "Optional override; defaults to the agent's bound pane.",
      },
      focus: {
        type: "boolean",
        description:
          "Whether to focus the surface after opening. Default true.",
      },
    },
    required: ["url"],
  },
  handler: (args, ctx) => {
    const p = args as {
      url: string;
      title?: string;
      pane_id?: string;
      focus?: boolean;
    };
    const existing = findBrowserSurfaceByUrl(p.url);
    if (existing) {
      if (p.focus !== false) focusSurfaceById(existing.surfaceId);
      return {
        surface_id: existing.surfaceId,
        pane_id: existing.paneId,
        workspace_id: existing.workspaceId,
        reused: true,
      };
    }
    const target = resolveTarget(p, ctx);
    const hostPane = target.hostPane ?? pickHostPane(target.workspace);
    const surface = createBrowserSurfaceInPane(hostPane.id, p.url, {
      title: p.title,
      focus: p.focus !== false,
    });
    if (!surface) {
      throw new Error(
        `Could not place browser surface in pane ${hostPane.id} (workspace ${target.workspace.id})`,
      );
    }
    return {
      surface_id: surface.id,
      pane_id: hostPane.id,
      workspace_id: target.workspace.id,
      reused: false,
    };
  },
});

registerTool({
  name: "navigate_browser",
  description: "Navigate an existing browser surface to a new URL.",
  inputSchema: {
    type: "object",
    properties: {
      surface_id: {
        type: "string",
        description: "The browser surface to navigate.",
      },
      url: { type: "string", description: "New URL to load." },
    },
    required: ["surface_id", "url"],
  },
  handler: async (args) => {
    const { surface_id, url } = args as { surface_id: string; url: string };
    const entry = getBrowserSurfaceById(surface_id);
    if (!entry) throw new Error(`No browser surface: ${surface_id}`);
    await invoke("navigate_browser_webview", { label: surface_id, url });
    return { ok: true };
  },
});

registerTool({
  name: "close_browser",
  description: "Close a browser surface.",
  inputSchema: {
    type: "object",
    properties: {
      surface_id: { type: "string" },
    },
    required: ["surface_id"],
  },
  handler: (args) => {
    const { surface_id } = args as { surface_id: string };
    const entry = getBrowserSurfaceById(surface_id);
    if (!entry) throw new Error(`No browser surface: ${surface_id}`);
    // closeSurfaceById removes the Svelte surface; BrowserSurface.svelte's
    // onDestroy handles close_browser_webview and registry cleanup.
    closeSurfaceById(entry.paneId, surface_id);
    return { ok: true };
  },
});

registerTool({
  name: "list_open_browsers",
  description: "List all open browser surfaces.",
  inputSchema: { type: "object", properties: {} },
  handler: () => ({
    browsers: listBrowserSurfaces().map((e) => ({
      surface_id: e.surfaceId,
      url: e.url,
      pane_id: e.paneId,
      workspace_id: e.workspaceId,
    })),
  }),
});
```

> `handler` may or may not support `async` depending on how `registerTool` is typed — check the handler type signature in mcp-server.ts. If it doesn't support async, use `.then()` for the `navigate_browser` invoke call, or check if `invoke` can be called fire-and-forget for navigation (it can — the webview navigates regardless of whether we await).

- [ ] **Step 6: Full test suite**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/services/mcp-server.ts src/__tests__/browser-surface.test.ts
git commit -m "feat(mcp): add open_browser, navigate_browser, close_browser, list_open_browsers tools"
```

---

## Task 8: Manual integration test

Tauri native webviews cannot be tested with vitest. Verify the full flow manually:

- [ ] Start dev mode: `npm run tauri dev`
- [ ] Call `open_browser` with `url: "http://localhost:3000"` (or any accessible URL) from an MCP client
- [ ] Verify a new browser surface tab appears in the active pane
- [ ] Verify the native webview renders at the correct position inside the pane bounds
- [ ] Drag a split divider to resize the pane — verify the webview resizes with it
- [ ] Switch to another surface tab — verify the webview hides
- [ ] Switch back — verify the webview reappears at the correct position
- [ ] Call `navigate_browser` with a different URL — verify the webview navigates
- [ ] Call `list_open_browsers` — verify the surface appears in the result
- [ ] Call `close_browser` — verify the tab closes and the webview is destroyed
- [ ] Call `open_browser` with the same URL twice — verify the second call reuses the first surface
- [ ] Restart the app — verify the browser surface is restored from persisted workspace state (the native webview should be recreated when the Svelte component mounts)

- [ ] **Final build + test**

```bash
npm test && cargo check
```

Expected: all green.

---

## Known limitations (v1)

- **Overlay z-order:** The native webview floats above all Svelte UI. Command palette, modals, and any overlay render behind an active browser surface. Fix: propagate overlay-open state (command palette open, modal open) to Rust and call `hide_browser_webview` / `show_browser_webview` around it.
- **`navigate_browser` URL dedup:** After navigation, `findBrowserSurfaceByUrl` still returns the original URL. The registry entry is not updated on navigation. Fix: emit a navigation event from Rust and update the registry entry, or update the `BrowserSurface` surface object in the workspace store.
