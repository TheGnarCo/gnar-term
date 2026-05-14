# Spacebase Extension — Architecture

Shared design context for all stories in `jrvs/spacebase`. Stories must conform to the contracts here.

## What is Spacebase

Cloud control plane at `https://spacebase.thegnar.com` exposing markdown documents, source artifacts, and agent pipeline runs scoped under `clients → projects`. The existing gnar plugin (`/Users/jarvis/.claude/plugins/marketplaces/gnar/spacebase`) already provides shell scripts (`spacebase-pull.sh`, `spacebase-sync.sh`, etc.) for pull/push/sync; this extension surfaces the same data inside gnar-term's UI without duplicating those flows.

## Auth Model

- **Bearer token.** `Authorization: Bearer sw_...` on every request.
- **Project-scoped** API keys (`sw_*` format) — same scoping the gnar plugin uses. A key resolves to one project.
- **Storage.** No keychain / stronghold integration exists in gnar-term. Keys live in the extension's settings file (`./gnar-term.json` or `~/.config/gnar-term/gnar-term.json`) under field `spacebase.apiKey`. Document this clearly in the settings UI.
- **Env var fallbacks** (read at activate time, do not override an explicit setting):
  - `SPACEBASE_API_KEY` → `apiKey`
  - `SPACEBASE_URL` → `baseUrl` (default `https://spacebase.thegnar.com`)
  - `SPACEBASE_PROJECT_ID` → `projectId` (used by workspace dashboard when no per-workspace override exists)

## Settings Schema (manifest `contributes.settings`)

| Key                | Type            | Default                         | Notes                                                         |
| ------------------ | --------------- | ------------------------------- | ------------------------------------------------------------- |
| `apiKey`           | string (secret) | —                               | Bearer token (sw\_\*). Required.                              |
| `baseUrl`          | string          | `https://spacebase.thegnar.com` | Override for staging.                                         |
| `projectId`        | string          | —                               | Default project for workspace dashboards when not overridden. |
| `syncDir`          | string          | `.` (workspace root)            | Relative path to scan for local `.md` files.                  |
| `showTitleBarIcon` | boolean         | `true`                          | Hide the title bar button without uninstalling.               |

## API Client Surface

Located at `src/extensions/spacebase/api-client.ts`. Pure functions over `fetch`. Construct once with `{ apiKey, baseUrl }`; methods return typed promises:

```ts
type SpacebaseClient = {
  me(): Promise<MeResponse>; // GET /api/v1/me
  listDocs(projectId: string): Promise<DocSummary[]>; // GET /api/v1/projects/{id}/docs
  getDoc(projectId: string, docId: string): Promise<Doc>; // GET /api/v1/projects/{id}/docs/{docId}
  getDocRaw(projectId: string, docId: string): Promise<string>; // GET /api/v1/projects/{id}/docs/{docId}/raw
};
```

`MeResponse` shape (from gnar plugin's `/me` usage): user metadata + a `projects` array. Registry surface uses this to determine what to display — if exactly one project, show docs flat; if multiple (via a user-scoped key in future), show client → project → doc tree.

Errors surface as `SpacebaseError` with an `{ status, code, message }` shape; never throw raw `fetch` errors. Network sandbox blocks `*.thegnar.com`, so all client tests must mock `fetch` (either via `vi.spyOn(globalThis, 'fetch')` or by injecting a fetch override into the constructor — pick the latter for testability).

## Local File Convention

Mirrors `spacebase-sync.sh` exactly:

- A "sync directory" is any directory the user designates (workspace setting `syncDir`, default = workspace CWD).
- Files inside it are `.md` files placed at `{folder_path}/{sanitize(title)}.md` relative to syncDir.
- `sanitize(title)`: lowercase, replace any run of non-`[a-z0-9]` characters with `-`, trim `-` from edges. Implementation lives in `src/extensions/spacebase/sanitize.ts`; tests pin behavior to `spacebase-helpers.sh`'s `sanitize()`.

The workspace dashboard does **not** sync — it only reads. Push/pull stays in the gnar plugin scripts.

## Surfaces Registered

1. **Registry global surface** (`dashboard:spacebase-registry`)
   - Singleton workspace via `api.registerGlobalSurface()`.
   - Title bar button (gated reactively on `showTitleBarIcon`) toggles open.
   - Renders `SpacebaseRegistry.svelte`: client → project → doc tree fetched live; click-doc → fetch raw markdown, write to a cache file under `gnar-term`'s app cache dir, then `api.openPreviewSplit(cachePath)`.

2. **Workspace dashboard contribution** (cap=1 per workspace, opt-in via context menu "Add Spacebase Dashboard").
   - Renders `SpacebaseWorkspaceDashboard.svelte`: lists local `.md` files under `{workspace.cwd}/{syncDir}`.
   - For each, sanitized title is matched against the project's doc list (when `projectId` is set for the workspace) to compute a remote-status badge: `synced | local-only | remote-only | locked | mismatched`.
   - Click → `api.openPreviewSplit(localFilePath)`.

## Doc Cache for Registry Previews

Fetched docs from the registry surface (which may not exist locally) are written to a cache directory before opening as preview splits. Path:

```
{appCacheDir}/spacebase/{projectId}/{docId}.md
```

`appCacheDir` is resolved via Tauri's `appCacheDir()` API. The cache is a fire-and-forget write — last-write-wins; on next click, refetch and overwrite. No invalidation logic.

## Out of Scope (v1)

- Editing / pushing docs. (Read-only in v1; user uses gnar plugin scripts to push.)
- Source artifact upload/download.
- Run management.
- Multi-account support.
- Auto-sync. The dashboard reflects current filesystem state; user invokes the gnar plugin's `/sync` command externally to refresh.

## Test Strategy

- **Unit (vitest):** sanitize, api-client (mocked fetch), auth-store, doc-status reducer.
- **Component (vitest + @testing-library/svelte):** SpacebaseRegistry renders tree; SpacebaseWorkspaceDashboard renders file list with badges.
- **Integration:** loading the extension wires title bar button + registers surface types. Verified against the existing extension-loader test if one exists; otherwise add.
- **Manual QA (PR test plan):** real Bearer key against staging; load a workspace with a syncDir containing `.md` files; toggle visibility setting; open registry; click a doc renders preview split.
