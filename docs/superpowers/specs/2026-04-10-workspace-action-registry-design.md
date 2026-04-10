# Workspace Action Registry

Extensions register workspace creation actions that appear as icon buttons in the sidebar. Core renders them; extensions own the presentation and behavior.

## Problem

Managed Workspaces and Project Scope are currently isolated — each has its own sidebar section with its own buttons. The user wants:

- Managed workspaces inline with normal workspaces (no standalone section)
- Each project as its own independently orderable sidebar section
- A shared button row for workspace creation actions
- Per-project creation buttons filtered by project context (e.g., git-only)
- Extensions fully own their button icons, labels, and tooltips

## Design

### Workspace Action Registry

New store: `src/lib/services/workspace-action-registry.ts`

```typescript
interface WorkspaceAction {
  id: string; // namespaced: "managed-workspaces:create-wt"
  label: string; // "New Managed Workspace" — used in tooltip
  icon: string; // icon identifier rendered by core
  shortcut?: string; // keyboard shortcut string for tooltip
  source: string; // extension id that registered this action
  handler: (ctx: WorkspaceActionContext) => void | Promise<void>;
  when?: (ctx: WorkspaceActionContext) => boolean;
}

interface WorkspaceActionContext {
  projectId?: string;
  projectPath?: string;
  projectName?: string;
  isGit?: boolean;
}
```

The store is a Svelte writable. Core registers the default "New Workspace" action. Extensions add more via the API.

### Extension API Changes

New methods:

```typescript
registerWorkspaceAction(actionId: string, options: {
  label: string;
  icon: string;
  shortcut?: string;
  handler: (ctx: WorkspaceActionContext) => void | Promise<void>;
  when?: (ctx: WorkspaceActionContext) => boolean;
}): void;

getWorkspaceActions(): WorkspaceAction[];
```

New manifest contribution:

```json
{
  "contributes": {
    "workspaceActions": [
      { "id": "create-worktree-workspace", "title": "New Managed Workspace" }
    ]
  }
}
```

Actions are namespaced the same way as commands (`extId:actionId`).

Extended `registerPrimarySidebarSection` — add optional `label` parameter for dynamic sections:

```typescript
registerPrimarySidebarSection(sectionId: string, component: unknown, options?: {
  collapsible?: boolean;
  showLabel?: boolean;
  label?: string;  // overrides manifest label — required for dynamic sections
}): void;
```

### New Tauri Command: `pick_directory`

Native OS directory picker dialog. Returns the selected path or null if cancelled.

Two options — use Tauri's official `tauri-plugin-dialog` (v2.7.0, provides `dialog.open()` from JS with folder mode) or add `rfd` crate and wrap in a custom Tauri command.

**Recommended: `tauri-plugin-dialog`** — it's the Tauri-native approach, handles macOS/Linux differences, and exposes a JS API directly. Extensions would call it via a thin wrapper in the extension API rather than `api.invoke()`.

Add to `Cargo.toml`:

```toml
tauri-plugin-dialog = "2"
```

Register in `lib.rs` setup:

```rust
.plugin(tauri_plugin_dialog::init())
```

Extension API wrapper:

```typescript
pickDirectory(title?: string): Promise<string | null>;
```

This avoids a custom Tauri command entirely — the dialog plugin handles it.

### PrimarySidebar Changes

The workspace zone header renders a button row from `workspaceActionStore`:

```
[ Workspace 1        ]  [+] [⑂] [📁]
[ Workspace 2        ]
```

Each button:

- Renders the action's `icon`
- `title` attribute: `"{label} ({shortcut})"` or `"{label}"` if no shortcut
- `on:click` calls `action.handler({})` (no project context at top level)
- All actions visible at top level (no `when` filtering — that's for project context)

Core registers the default action during app setup (in `App.svelte`):

```typescript
registerWorkspaceAction({
  id: "core:new-workspace",
  label: "New Workspace",
  icon: "plus",
  shortcut: isMac ? "Cmd+Shift+N" : "Ctrl+Shift+N",
  source: "core",
  handler: () => createWorkspace(`Workspace ${$workspaces.length + 1}`),
});
```

### Managed Workspaces Extension — Reworked

**Remove:**

- `primarySidebarSections` from manifest
- `ManagedWorkspacesList.svelte` — deleted entirely
- The standalone sidebar section registration

**Add:**

- `workspaceActions` manifest contribution: `create-worktree-workspace`
- Workspace action registration in `onActivate`:

```typescript
api.registerWorkspaceAction("create-worktree-workspace", {
  label: "New Managed Workspace",
  icon: "git-branch",
  handler: async (ctx) => {
    let repoPath: string;
    if (ctx.projectPath) {
      // Called from project context — use project root
      repoPath = ctx.projectPath;
    } else {
      // Called from top level — open native directory picker
      const picked = await api.invoke<string | null>("pick_directory", {
        title: "Select Git Repository",
      });
      if (!picked) return;
      repoPath = picked;
    }

    const isGit = await api.invoke<boolean>("is_git_repo", { path: repoPath });
    if (!isGit) return; // silently bail — not a git repo

    const branch = await api.showInputPrompt("Branch name");
    if (!branch) return;
    const base = await api.showInputPrompt("Base branch", "main");
    if (!base) return;

    // ... create worktree, copy files, run setup, create workspace
  },
  when: (ctx) => {
    // At top level (no project context): always show
    if (!ctx.projectId) return true;
    // In project context: only show if project root is a git repo
    return ctx.isGit === true;
  },
});
```

Managed workspaces appear inline because `api.createWorkspace()` adds them to the main workspace store. No separate list needed.

### Project Scope Extension — Reworked

**Remove:**

- Single "projects" section — no longer registered
- "Floating workspaces" rendering in `ProjectSection.svelte`
- `ProjectSection.svelte` — replaced with `ProjectSectionContent.svelte`

**Add:**

- `workspaceActions` manifest contribution: `create-project`
- Dynamic per-project section registration

**Workspace action for "New Project":**

```typescript
api.registerWorkspaceAction("create-project", {
  label: "New Project",
  icon: "folder-plus",
  handler: async (ctx) => {
    const picked = await api.invoke<string | null>("pick_directory", {
      title: "Select Project Root",
    });
    if (!picked) return;
    const name = await api.showInputPrompt("Project name");
    if (!name) return;
    const isGit = await api.invoke<boolean>("is_git_repo", { path: picked });
    // ... create project, register section
  },
  when: (ctx) => {
    // Hide inside project context (can't nest projects)
    return !ctx.projectId;
  },
});
```

**Dynamic section registration:**

When a project is created (or on extension activate for persisted projects), register a sidebar section for each project:

```typescript
function registerProjectSection(project: ProjectEntry) {
  api.registerPrimarySidebarSection(
    `project-${project.id}`,
    ProjectSectionContent,
    {
      collapsible: true,
      showLabel: true,
      label: project.name,
    },
  );
}
```

Each `ProjectSectionContent` component:

- Shows workspaces belonging to that project
- Shows workspace action buttons from `api.getWorkspaceActions()`, filtered by:
  - `action.when({ projectId, projectPath, projectName, isGit })`
- Buttons render the action's icon + tooltip
- Clicking calls `action.handler(projectContext)`

**Section cleanup:** When a project is deleted, unregister its section.

### Tooltip Rule (All Icon Buttons)

Every icon button in the UI gets a `title` attribute:

- Format: `"Label (Shortcut)"` when shortcut exists
- Format: `"Label"` when no shortcut
- Applies retroactively to existing buttons in PrimarySidebar, SecondarySidebar, TitleBar

### Files Changed

| File                                                             | Change                                                                                                                                                       |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src-tauri/Cargo.toml`                                           | Add `tauri-plugin-dialog` dependency                                                                                                                         |
| `src-tauri/src/lib.rs`                                           | Register dialog plugin in setup                                                                                                                              |
| `src/lib/services/workspace-action-registry.ts`                  | New file — store + register/unregister/query                                                                                                                 |
| `src/lib/services/extension-loader.ts`                           | Add `registerWorkspaceAction`, `getWorkspaceActions`, `pickDirectory` to API; add `label` to section options                                                 |
| `src/extensions/api.ts`                                          | Add types: `WorkspaceAction`, `WorkspaceActionContext`, `registerWorkspaceAction`, `getWorkspaceActions`; add `workspaceActions` to `ExtensionContributions` |
| `src/lib/extension-types.ts`                                     | Re-export new types                                                                                                                                          |
| `src/lib/components/PrimarySidebar.svelte`                       | Render workspace action buttons from store; add tooltips to all icon buttons                                                                                 |
| `src/App.svelte`                                                 | Register core "new-workspace" action; pass action store to sidebar                                                                                           |
| `src/extensions/managed-workspaces/index.ts`                     | Remove section registration; add workspace action registration                                                                                               |
| `src/extensions/managed-workspaces/ManagedWorkspacesList.svelte` | Delete                                                                                                                                                       |
| `src/extensions/project-scope/index.ts`                          | Dynamic per-project section registration; add workspace action                                                                                               |
| `src/extensions/project-scope/ProjectSection.svelte`             | Replace with ProjectSectionContent showing project workspaces + action buttons                                                                               |
| `EXTENSIONS.md`                                                  | Document workspace actions extension point                                                                                                                   |

### Files Deleted

- `src/extensions/managed-workspaces/ManagedWorkspacesList.svelte`

### What Stays the Same

- Workspace store, workspace service, pane service — unchanged
- The core workspace creation flow (`createWorkspace()`) — unchanged
- Extension lifecycle, state, events — unchanged
- Secondary sidebar, dashboard, GitHub extension — unchanged
- Agentic orchestrator — unchanged

### Testing

- Workspace action registry: register/unregister, store reactivity, namespacing
- `pick_directory` Tauri command: Rust unit test (mock dialog or skip in CI)
- Managed workspaces: action registration, `when` filter logic, handler with/without project context
- Project scope: dynamic section registration/unregistration, action button rendering, `when` filter
- Tooltip coverage: verify `title` attributes on icon buttons
- Existing tests: all 559 frontend + 135 Rust tests must continue to pass
