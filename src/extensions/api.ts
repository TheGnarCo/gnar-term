/**
 * GnarTerm Extension API — public contract for extension developers.
 *
 * This file is self-contained (only depends on svelte/store). External
 * extension authors can copy this file into their project for type safety:
 *
 *   curl -O https://raw.githubusercontent.com/TheGnarCo/gnar-term/main/src/extensions/api.ts
 *
 * Extensions are loaded at runtime via dynamic import(). They must
 * export a default function matching ExtensionRegisterFn.
 */
import type { Readable } from "svelte/store";

// --- Workspace color slots (shared across extensions + core) ---
//
// Semantic palette for workspaces and extensions that want
// theme-following color pickers. Each slot maps onto the active theme's
// ansi palette via getWorkspaceColors(), so a stored slot name resolves to
// different hex values as the user switches themes. Custom hex strings
// (anything starting with "#") pass through resolveWorkspaceColor()
// unchanged — users who type their own color keep it verbatim.

export const WORKSPACE_COLOR_SLOTS = [
  "red",
  "pink",
  "green",
  "mint",
  "yellow",
  "peach",
  "blue",
  "sky",
  "purple",
  "lavender",
  "cyan",
  "teal",
] as const;

export type WorkspaceColorSlot = (typeof WORKSPACE_COLOR_SLOTS)[number];

/**
 * Minimum theme shape required for slot resolution — only the ansi
 * block. Both core's ThemeDef and the extension-facing ExtensionTheme
 * satisfy this interface.
 */
export interface WorkspaceColorTheme {
  ansi: {
    red: string;
    brightRed: string;
    green: string;
    brightGreen: string;
    yellow: string;
    brightYellow: string;
    blue: string;
    brightBlue: string;
    magenta: string;
    brightMagenta: string;
    cyan: string;
    brightCyan: string;
  };
}

export function getWorkspaceColors(
  theme: WorkspaceColorTheme,
): Record<WorkspaceColorSlot, string> {
  return {
    red: theme.ansi.red,
    pink: theme.ansi.brightRed,
    green: theme.ansi.green,
    mint: theme.ansi.brightGreen,
    yellow: theme.ansi.yellow,
    peach: theme.ansi.brightYellow,
    blue: theme.ansi.blue,
    sky: theme.ansi.brightBlue,
    purple: theme.ansi.magenta,
    lavender: theme.ansi.brightMagenta,
    cyan: theme.ansi.cyan,
    teal: theme.ansi.brightCyan,
  };
}

/**
 * Resolve a color field to a hex value. Slot names look up the active
 * theme; custom hex strings (starting with `#`) pass through unchanged.
 * Unknown strings return as-is. Legacy persisted records may lack a
 * color, so undefined/null/empty fall back to the `blue` slot.
 */
export function resolveWorkspaceColor(
  color: string | undefined | null,
  theme: WorkspaceColorTheme,
): string {
  const colors = getWorkspaceColors(theme);
  if (!color) return colors.blue;
  if (color.startsWith("#")) return color;
  return colors[color as WorkspaceColorSlot] ?? color;
}

// --- Status types (inlined so api.ts stays self-contained) ---

export interface StatusItem {
  id: string;
  source: string;
  workspaceId: string;
  category: string;
  priority: number;
  label: string;
  icon?: string;
  tooltip?: string;
  variant?: "default" | "success" | "warning" | "error" | "muted";
  action?: {
    command: string;
    args?: unknown[];
  };
  metadata?: Record<string, unknown>;
}

export type StatusItemInput = Omit<StatusItem, "id" | "source" | "workspaceId">;

// --- Event types (for api.on/off) ---

export type AppEventType =
  | "workspace:created"
  | "workspace:activated"
  | "workspace:closed"
  | "workspace:renamed"
  | "pane:split"
  | "pane:closed"
  | "pane:focused"
  | "surface:created"
  | "surface:activated"
  | "surface:closed"
  | "surface:ptyReady"
  | "surface:titleChanged"
  | "sidebar:toggled"
  | "theme:changed"
  | "worktree:merged"
  | "agent:statusChanged"
  | "agent:interrupted"
  | "agent:killed"
  | "branch:lifecycleChanged"
  | "attention:event";

/** Base shape for all events delivered to extension handlers. */
export interface AppEvent {
  type: AppEventType;
  [key: string]: unknown;
}

// --- Manifest types (extension.json) ---

export interface ExtensionManifestAction {
  id: string;
  icon: string;
  title: string;
}

export interface ExtensionManifestTab {
  id: string;
  label: string;
  icon?: string;
  actions?: ExtensionManifestAction[];
}

export interface ExtensionManifestSection {
  id: string;
  label: string;
}

export interface ExtensionManifestCommand {
  id: string;
  title: string;
  /**
   * Optional keyboard shortcut (e.g. "⌘⇧P" or "Ctrl+Shift+P"). When set,
   * pressing the shortcut invokes the command's action — so keep it
   * consistent with the runtime `options.shortcut` on `registerCommand`.
   */
  shortcut?: string;
}

export interface ExtensionManifestSurface {
  id: string;
  label: string;
}

export interface ExtensionManifestContextMenu {
  id: string;
  label: string;
  when: string; // glob: "*", "*.md", "*.{png,jpg}"
}

export interface ExtensionSettingsField {
  type: "string" | "number" | "boolean" | "select";
  title: string;
  description?: string;
  default?: string | number | boolean;
  options?: Array<{ label: string; value: string }>; // for "select" type
}

export interface ExtensionSettingsSchema {
  fields: Record<string, ExtensionSettingsField>;
}

export interface ExtensionManifestWorkspaceAction {
  id: string;
  /** Button label shown in the workspace header / sidebar. */
  title: string;
  /** Icon name rendered alongside the label. Required at runtime — declare it
   *  here so tools (MCP, command palette, shortcut help) can discover it. */
  icon?: string;
  /** Optional keyboard shortcut (e.g. "⌘⇧N"). */
  shortcut?: string;
  /** Where the action appears: "workspace" (default), "sidebar", or "workspace-tile". */
  zone?: "workspace" | "sidebar" | "workspace-tile";
}

export interface ExtensionManifestWorkspaceSubtitle {
  /** Render priority (ascending — lower renders first). Default 50. */
  priority?: number;
}

export interface ExtensionContributions {
  sidebarSections?: ExtensionManifestSection[];
  commands?: ExtensionManifestCommand[];
  surfaces?: ExtensionManifestSurface[];
  contextMenuItems?: ExtensionManifestContextMenu[];
  workspaceActions?: ExtensionManifestWorkspaceAction[];
  /** Declare that the extension renders a component below workspace names. */
  workspaceSubtitle?: ExtensionManifestWorkspaceSubtitle;
  events?: string[];
  settings?: ExtensionSettingsSchema;
}

export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  entry: string;
  included?: boolean;
  /**
   * Elevated permissions opted into by the extension. Valid values:
   *   - `"pty"`        — spawn/write/kill PTYs (`spawn_pty`, `write_pty`, …)
   *   - `"shell"`      — `run_script` arbitrary shell exec
   *   - `"filesystem"` — write-side fs commands (`write_file`, `ensure_dir`,
   *                      `remove_dir`, `copy_files`). Read-side commands
   *                      (`read_file`, `list_dir`, …) are always available.
   *                      Path must live inside a `.gnar-term/` directory or
   *                      under `~/.gnar-term/`; the app config dir
   *                      (`~/.config/gnar-term/`) is blocked even with this
   *                      permission.
   *   - `"observe"`    — read raw PTY output via `onSurfaceOutput`
   */
  permissions?: string[];
  contributes?: ExtensionContributions;
}

// --- Extension API (passed to register()) ---

export interface ExtensionStateAPI {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
}

/**
 * Theme shape visible to extensions. Mirrors the core ThemeDef so slot
 * resolution, ansi lookups, and UI chrome styling all work the same
 * way inside extensions as in core.
 */
export interface ExtensionTheme {
  name: string;
  bg: string;
  bgSurface: string;
  bgFloat: string;
  bgHighlight: string;
  bgActive: string;
  border: string;
  borderActive: string;
  borderNotify: string;
  fg: string;
  fgMuted: string;
  fgDim: string;
  accent: string;
  accentHover: string;
  notify: string;
  notifyGlow: string;
  danger: string;
  success: string;
  warning: string;
  termBg: string;
  termFg: string;
  termCursor: string;
  termSelection: string;
  sidebarBg: string;
  sidebarBorder: string;
  tabBarBg: string;
  tabBarBorder: string;
  /**
   * Glyph used for AgentDashboard rows in the sidebar. Either an icon
   * name (currently `lucide:layout-dashboard` is the only recognized
   * name — the row falls back to an inline SVG when the name is
   * unknown) or a literal emoji / single-grapheme string rendered as
   * text. Personality themes set this to flair like "🪩".
   */
  dashboardIcon: string;
  ansi: {
    black: string;
    red: string;
    green: string;
    yellow: string;
    blue: string;
    magenta: string;
    cyan: string;
    white: string;
    brightBlack: string;
    brightRed: string;
    brightGreen: string;
    brightYellow: string;
    brightBlue: string;
    brightMagenta: string;
    brightCyan: string;
    brightWhite: string;
  };
}

/**
 * The API object passed to an extension's register function.
 * This is the only interface between an extension and the host.
 * Extensions must NOT import from core paths or @tauri-apps/api directly.
 */
export interface ExtensionAPI {
  // Lifecycle — must be called synchronously during register(), not in async callbacks
  onActivate(callback: () => void | Promise<void>): void;
  onDeactivate(callback: () => void): void;

  // Event bus (filtered to declared events in manifest)
  // Accepts both core AppEventType and "extension:*" custom events
  on(
    event: AppEventType | `extension:${string}`,
    handler: (payload: AppEvent) => void,
  ): void;
  off(
    event: AppEventType | `extension:${string}`,
    handler: (payload: AppEvent) => void,
  ): void;
  // Emit custom events (must use "extension:" prefix)
  emit(event: `extension:${string}`, payload?: Record<string, unknown>): void;

  // UI registration — core owns chrome, extension provides content
  /**
   * Contribute a button to the TitleBar, rendered between the Settings button
   * and the Secondary Sidebar toggle. `isActive` controls the active highlight color.
   */
  registerTitleBarButton(
    buttonId: string,
    options: {
      icon: unknown;
      title: string;
      isActive?: Readable<boolean>;
      /**
       * When provided, the button only renders while this store emits
       * true. Use it to gate a button on an extension setting without
       * unregistering on every change.
       */
      visible?: Readable<boolean>;
      onClick: () => void;
    },
  ): void;
  registerSidebarSection(
    sectionId: string,
    component: unknown,
    options?: {
      collapsible?: boolean;
      showLabel?: boolean;
      label?: string;
      props?: Record<string, unknown>;
    },
  ): void;
  /**
   * Register a renderer for a non-workspace row kind inside the
   * Workspaces section's interleaved list (workspaces today, other kinds
   * later). The component receives `{ id: string }` as a prop and is
   * responsible for its own drag-hover feedback.
   *
   * `options.railColor`, when provided, lets core paint the DragGrip
   * rail in a per-row color (e.g. the workspace's color). Returning
   * undefined for a given id falls back to the theme accent.
   */
  registerRootRowRenderer(
    kind: string,
    component: unknown,
    options?: {
      railColor?: (id: string) => string | undefined;
      label?: (id: string) => string | undefined;
    },
  ): void;
  /**
   * Append a row to the end of the Workspaces section's root-row
   * list. Idempotent — repeat calls for the same {kind, id} are
   * no-ops. Extensions call this when they create an entity that
   * should render at the root level (e.g. a workspace row on workspace create).
   */
  appendRootRow(row: { kind: string; id: string }): void;
  /**
   * Remove a row from the root-row list. No-op if the row isn't
   * present. Extensions call this when they delete an entity that
   * was rendering at the root level.
   */
  removeRootRow(row: { kind: string; id: string }): void;
  /**
   * Register a new surface type. `options.hideFromNewSurface` keeps the
   * type out of the "+ new surface" menu — use it for surfaces that
   * need external context (a file path, a commit sha) and can't be
   * opened from an empty click.
   */
  registerSurfaceType(
    surfaceId: string,
    component: unknown,
    options?: { hideFromNewSurface?: boolean },
  ): void;
  /**
   * Register a singleton global surface. Returns a `spawnOrNavigate`
   * function — call it (e.g. from a TitleBar button onClick) to open the
   * surface or switch to it if already open. The host workspace is draggable,
   * closeable, and persists across restarts. Global surfaces render
   * tab-less (PaneView suppresses the TabBar for top-level dashboard
   * workspaces); use this for app-wide overlays like Settings, Keyboard
   * Shortcuts, and user-level Claude Settings rather than per-workspace
   * dashboards (those go through `registerDashboardContribution`).
   */
  registerGlobalSurface(
    id: string,
    options: {
      label: string;
      icon: unknown;
      component: unknown;
      accentColor?: string;
    },
  ): () => void;
  /**
   * Contribute a theme to the app-wide theme picker. `id` is the value
   * saved in user settings; `theme` is a full ThemeDef-shaped object
   * (same shape as ExtensionTheme — exactly what `api.theme` emits).
   * Registered themes are merged with the built-in set and appear in
   * Settings › General › Theme. Unregistered automatically on
   * deactivate.
   */
  registerTheme(id: string, theme: ExtensionTheme): void;
  registerDashboardTab(
    tabId: string,
    component: unknown,
    options?: { label?: string; props?: Record<string, unknown> },
  ): void;
  registerCommand(
    commandId: string,
    handler: () => void | Promise<void>,
    options?: { title?: string; shortcut?: string },
  ): void;
  /** Trigger a registered command by its full id (e.g. "worktrees:create-workspace").
   *  Returns true when found and dispatched. Use this from an extension to invoke
   *  a core command when the extension is just an alternate trigger surface. */
  runCommand(commandId: string, args?: unknown): boolean;
  registerContextMenuItem(
    itemId: string,
    handler: (filePath: string) => void,
  ): void;

  /**
   * Contribute a tool to the MCP surface. Extensions expand what MCP
   * clients (agents) can do; the core MCP server exposes generic
   * primitives (open_surface, list_commands, etc.) while each
   * extension registers domain-specific shortcuts here.
   *
   * The tool name is registered as-is (no extension-id prefix) so that
   * contracts stay stable for external agents.
   * Conflicts across extensions are the author's responsibility to avoid.
   *
   * Automatically unregistered on extension deactivate.
   */
  registerMcpTool(
    toolName: string,
    options: {
      description: string;
      inputSchema: Record<string, unknown>;
      handler: (args: Record<string, unknown>) => unknown | Promise<unknown>;
    },
  ): void;

  /**
   * Contribute child rows to another extension's parent rows. The
   * `parentType` matches the kind of a row registered via
   * `registerRootRowRenderer` (e.g. "workspace", "dashboard"); given a
   * specific parent's id, return the child row ids that should render
   * underneath it. Each id is dispatched through the same
   * root-row-renderer registry, so children inherit whatever the
   * registered renderer for their kind already does.
   *
   * Use this when the lifecycle of the child rows lives in this
   * extension but they should appear nested under a row owned by a
   * different extension.
   *
   * Automatically unregistered on extension deactivate.
   */
  registerChildRowContributor(
    parentType: string,
    contribute: (parentId: string) => Array<{ kind: string; id: string }>,
  ): void;

  /**
   * Enumerate every child row contributed for the given parent.
   * Returns concatenated `{ kind, id }` descriptors from all
   * contributors registered against `parentType`. The caller looks
   * each kind up via `getRootRowRenderer()` and renders the component.
   */
  getChildRowsFor(
    parentType: string,
    parentId: string,
  ): Array<{ kind: string; id: string }>;
  /**
   * Reactive store of every contributor — subscribe to re-enumerate
   * when contributors register/unregister (e.g. when an extension
   * activates after the parent row has already mounted).
   */
  childRowContributors: Readable<unknown[]>;
  /**
   * Look up a registered root-row renderer by kind. Used by parent
   * rows to render contributed children (each child carries its own
   * kind so the parent doesn't need to know about every renderer).
   */
  getRootRowRenderer(kind: string): { component: unknown } | undefined;

  /**
   * Register a dashboard contribution — a "kind of dashboard" that can
   * attach to a Workspace. Each workspace's context menu surfaces an
   * "Add <actionLabel>" affordance per registered contribution whose
   * `isAvailableFor` gate accepts the workspace and whose `capPerWorkspace`
   * isn't already met. When invoked, core calls `create(workspace)` to
   * materialize the dashboard Branch. Automatically unregistered on
   * extension deactivate.
   *
   * The agentic extension registers under `id: "agentic"`. Dashboard
   * tiles carry `metadata.dashboardContributionId = contribution.id`
   * so the multi-dashboard grid can attribute them back to their
   * contribution.
   */
  registerDashboardContribution(contribution: DashboardContributionInput): void;

  /**
   * Register a pseudo-workspace — a non-persisted, pinned entry that
   * renders in the root sidebar list. Pseudo-workspaces cannot be
   * deleted, renamed, or have panes/surfaces added through normal
   * workspace controls. The canonical use is the Global Agentic
   * Dashboard. Automatically unregistered on extension deactivate.
   */
  registerPseudoWorkspace(pw: PseudoWorkspaceInput): void;

  // Workspace subtitle — components rendered below workspace name in sidebar
  /** Register a Svelte component to render below workspace names. Component receives { workspaceId } prop. */
  registerWorkspaceSubtitle(component: unknown, priority?: number): void;

  // Workspace actions — buttons in the workspace header and sidebar top bar.
  // Icon/shortcut/zone may be declared once in the manifest and omitted here;
  // runtime values win over manifest fallbacks.
  registerWorkspaceAction(
    actionId: string,
    options: {
      label: string;
      icon?: string;
      shortcut?: string;
      /** Where the action appears: "workspace" (default) in the workspace header,
       *  "sidebar" in the top bar alongside reorder,
       *  "workspace-tile" as a dash-btn tile in the workspace group banner row. */
      zone?: "workspace" | "sidebar" | "workspace-tile";
      handler: (ctx: WorkspaceActionContext) => void | Promise<void>;
      when?: (ctx: WorkspaceActionContext) => boolean;
    },
  ): void;
  getWorkspaceActions(): WorkspaceActionInfo[];
  unregisterWorkspaceAction(id: string): void;

  // Tauri command invocation — use this instead of @tauri-apps/api/core
  invoke<T = unknown>(
    command: string,
    args?: Record<string, unknown>,
  ): Promise<T>;

  // Actions — open surfaces, prompt user, toggle sidebar
  openFile(path: string): void;
  getActiveCwd(): Promise<string | undefined>;
  pickDirectory(title?: string): Promise<string | null>;
  showInputPrompt(label: string, defaultValue?: string): Promise<string | null>;
  /**
   * Ask the user to confirm a destructive action. Returns true when
   * confirmed, false when cancelled. Use for close/delete affordances
   * on container rows that remove user-visible state.
   */
  showConfirm(
    message: string,
    options?: { title?: string; confirmLabel?: string; cancelLabel?: string },
  ): Promise<boolean>;
  showFormPrompt(
    title: string,
    fields: Array<
      | {
          key: string;
          label: string;
          defaultValue?: string;
          placeholder?: string;
          type?: "text";
        }
      | {
          key: string;
          label: string;
          defaultValue?: string;
          type: "select";
          options: Array<{ label: string; value: string }>;
        }
      | {
          key: string;
          label: string;
          defaultValue?: string;
          type: "info";
        }
      | {
          key: string;
          label: string;
          defaultValue?: string;
          type: "color";
        }
      | {
          key: string;
          label: string;
          defaultValue?: string;
          placeholder?: string;
          type: "directory";
          required?: boolean;
          pickerTitle?: string;
          readonly?: boolean;
        }
    >,
    options?: { submitLabel?: string },
  ): Promise<Record<string, string> | null>;
  /**
   * Create a workspace from a declarative template (name, layout, cwd,
   * and top-level fields like `rootWorkspaceId` / `extensionData`) and
   * resolve to its id. The single workspace-creation entrypoint for
   * extensions — pass `layout: { pane: { surfaces: [{ type: "terminal" }] } }`
   * for a one-off terminal workspace.
   */
  createWorkspaceFromDef(def: WorkspaceDefInput): Promise<string>;
  /**
   * Run `callback` once core's bootstrap workspace restore has settled.
   * Fires immediately if restore already completed (the common case for
   * extensions enabled at runtime). Returns a disposer that cancels a
   * pending callback if invoked before the deferred run.
   *
   * Use this when an extension needs to read or mutate the workspace
   * store at activation time but might race the bootstrap
   * `restoreWorkspaces` call.
   */
  onWorkspacesRestored(callback: () => void): () => void;
  openInEditor(filePath: string): void;
  /**
   * Open a file as a preview surface in a new pane split to the right.
   * Deduplicates by path — reopening the same path focuses the existing
   * preview rather than spawning a new one.
   *
   * `opts.ratio` sets the resulting split's ratio (proportion of the
   * source pane). The new preview pane gets `1 - ratio`. Default `0.5`.
   * `opts.exclusive` closes any other preview surfaces in the active
   * workspace before opening the new one.
   */
  openPreviewSplit(
    filePath: string,
    opts?: { ratio?: number; exclusive?: boolean },
  ): void;
  openSurface(
    surfaceTypeId: string,
    title: string,
    props?: Record<string, unknown>,
  ): void;
  /**
   * Open a dashboard surface as a tab inside `workspaceId`'s active pane.
   * Used by `DashboardContribution.openAsTab` implementations to push
   * Workspace overview / Agentic / Diff / etc. into the parent workspace
   * instead of switching to a separate dashboard workspace. Dedupes by
   * path (preview specs) or surfaceTypeId+matchProps (extension specs).
   * Extension surface ids without `:` are namespaced under the calling
   * extension's id.
   *
   * Pass `opts.activate = false` for "ensure-tab-exists" semantics —
   * auto-provisioning paths use this so the dashboard becomes part of
   * the workspace's tab strip without stealing focus from the active
   * surface.
   */
  openDashboardTab(
    workspaceId: string,
    spec: ExtensionDashboardTabSpec,
    opts?: { activate?: boolean },
  ): Promise<void>;

  // Workspace management — switch and close by ID
  switchWorkspace(workspaceId: string): void;
  closeWorkspace(workspaceId: string): void;

  /** Set hasUnread=true on a surface tab (e.g., to signal "agent waiting"). Cleared automatically when the surface is selected. */
  markSurfaceUnread(surfaceId: string): void;
  /** Navigate to a specific surface: switches workspace, focuses pane, selects surface. No-op if surfaceId not found. */
  focusSurface(surfaceId: string): void;
  /** Resolve the owning workspace id for a surface. Returns null if the surface is not found. */
  getWorkspaceIdForSurface(surfaceId: string): string | null;
  /**
   * Surface an error to the user-visible error store. The extension's
   * failure toast will appear on next launch (or immediately if the
   * toast UI is already mounted). Use for configuration errors, observer
   * failures, or other recoverable-but-important conditions that should
   * not be silently logged.
   */
  reportError(message: string): void;
  /**
   * Enumerate every terminal surface across all workspaces and all panes
   * (active or background, split or single). Used by extensions that need
   * to bootstrap tracking for surfaces that existed before activation —
   * surface:created only fires for surfaces created AFTER the listener was
   * attached, so an extension that activates after workspace restore must
   * use this to catch up.
   */
  getAllTerminalSurfaces(): Array<{
    id: string;
    workspaceId: string;
    title: string;
  }>;

  /** Set or clear a status indicator on a workspace item (e.g., "running" | "waiting" | "idle" | null to clear). */
  setWorkspaceIndicator(workspaceId: string, status: string | null): void;

  // Status registry — structured workspace status items
  /** Set a status item for a workspace, scoped to this extension. */
  setStatus(workspaceId: string, itemId: string, status: StatusItemInput): void;
  /** Clear a specific status item. */
  clearStatus(workspaceId: string, itemId: string): void;
  /** Clear all status items for a workspace from this extension. */
  clearAllStatus(workspaceId: string): void;
  /** Subscribe to all status items for a workspace (from all sources). */
  getWorkspaceStatus(workspaceId: string): Readable<StatusItem[]>;
  /** Subscribe to status items for a workspace filtered by category. */
  getWorkspaceStatusByCategory(
    workspaceId: string,
    category: string,
  ): Readable<StatusItem[]>;

  // Context menus — show a menu with items from all extensions matching the target
  showFileContextMenu(x: number, y: number, filePath: string): void;
  showDirContextMenu(x: number, y: number, dirPath: string): void;

  /**
   * Open an ad-hoc context menu at the given viewport coordinates with
   * a caller-provided list of items. Use this for right-click menus on
   * extension-rendered rows (e.g. an agent dashboard row) when the menu
   * is dynamic and can't be declared via `contextMenuItems` in the
   * manifest. Each item's `action` is invoked on select.
   */
  showContextMenu(
    x: number,
    y: number,
    items: Array<{
      label: string;
      action: () => void;
      shortcut?: string;
      separator?: boolean;
      disabled?: boolean;
      danger?: boolean;
    }>,
  ): void;

  // Clipboard
  readClipboard(): Promise<string>;
  writeClipboard(text: string): Promise<void>;

  // Desktop notifications
  /** Send a desktop notification. Requests permission automatically on first call. */
  sendNotification(title: string, body?: string): Promise<void>;

  // Asset URL conversion — use this instead of @tauri-apps/api/core convertFileSrc
  convertFileSrc(path: string): string;

  // Terminal output observation (requires "observe" permission)
  /** Subscribe to raw PTY output for a terminal surface. Returns unsubscribe function. No-ops for non-terminal surfaces. */
  onSurfaceOutput(
    surfaceId: string,
    callback: (data: string) => void,
  ): () => void;

  // File watching — listen for changes from watch_file command
  onFileChanged(
    watchId: number,
    handler: (event: {
      watchId: number;
      path: string;
      content: string;
    }) => void,
  ): () => void; // returns unsubscribe function

  // Scoped state
  state: ExtensionStateAPI;

  // Extension settings (declared via manifest contributes.settings)
  getSetting<T = unknown>(key: string): T | undefined;
  getSettings(): Record<string, unknown>;

  // Read-only core state (Svelte readable stores)
  workspaces: Readable<WorkspaceRef[]>;
  activeWorkspace: Readable<WorkspaceRef | null>;
  activePane: Readable<PaneRef | null>;
  activeSurface: Readable<SurfaceRef | null>;
  /**
   * Reactive list of AI agents currently detected by the core
   * agent-detection-service. Extensions subscribe here to render agent
   * UI (dashboards, kanbans, status rows) without owning the detection
   * pipeline itself. Each entry is live — status transitions update the
   * store in place and emit `agent:statusChanged` on the event bus.
   */
  agents: Readable<AgentRef[]>;
  /**
   * Reactive list of agent spawn presets defined in `settings.json` under
   * `agents[]`. The store reflects the canonical config; mutations go
   * through the Settings UI or direct config edits. Use this to power
   * preset pickers, kanban "spawn agent" affordances, and similar UI.
   */
  agentPresets: Readable<AgentPresetRef[]>;
  /**
   * Reactive map of branch-id → derived lifecycle entry. The map is
   * recomputed by core whenever any canonical input (git state, PR
   * state, agent state, activity) moves. Subscribe here to render
   * kanban-style swimlanes; pair with the `branch:lifecycleChanged`
   * event for transition-only handlers.
   */
  branchLifecycle: Readable<Map<string, BranchLifecycleEntry>>;
  /**
   * Reactive list of attention events derived by core from agent state
   * transitions (awaiting_input / errored) and OSC notifications. The
   * list is newest-first with a per-pane cap of 50 and total cap of 500.
   * Pair with the `attention:event` event for transition-only handlers.
   */
  attention: Readable<AttentionEventRef[]>;
  /**
   * Clear all attention events for a pane — typically called when the
   * user acknowledges the pane (focuses it, dismisses a card, etc.).
   * Routes through core's attention store so all subscribers update.
   */
  dismissAttention(paneId: string): void;
  /**
   * Inject an externally-sourced attention event (e.g. from a CI
   * webhook, a long-running CLI agent, or a remote system). Core forces
   * `source: "external"` and stamps `createdAt`, so callers omit both.
   */
  pushExternalAttention(
    event: Omit<AttentionEventRef, "createdAt" | "source">,
  ): void;
  /**
   * O(n) lookup over the live agents store: returns the agent currently
   * hosted in `paneId`, or null if the pane has no detected agent.
   * Convenience for UI that renders per-pane agent chrome on every
   * render; for batch reads, subscribe to `agents` directly.
   */
  getAgentByPane(paneId: string): AgentRef | null;
  /**
   * Reactive log of MCP tool dispatches (most-recent-last, cap 500). Each
   * entry captures the tool name, args, optional resolved target, and
   * outcome. Subscribe to this to render an "agent activity" timeline or
   * to derive secondary indicators (last successful spawn, error rate).
   */
  mcpEvents: Readable<McpEventRef[]>;
  /**
   * Reactive flat list of recorded terminal sessions across all
   * workspaces, derived from the per-workspace session-log store.
   * Each entry carries the owning `workspaceId`, surface name, log path,
   * and recording timestamp. Useful for building cross-workspace session
   * browsers, replays, or audit views.
   */
  sessions: Readable<SessionRef[]>;
  /**
   * Read-only snapshot of every branch core is currently tracking.
   * Returns the same set of branchIds keyed by the `branchLifecycle`
   * store, with their repo/pane context attached.
   */
  listBranches(): ReadonlyArray<BranchDescriptorRef>;
  /**
   * Mark a branch as abandoned by closing its owning workspace through
   * the standard confirmAndCloseWorkspace path. No-op when the branch
   * is unknown. The store transitions to `abandoned` as a side effect
   * of the workspace disappearing — extensions never mutate lifecycle
   * directly.
   */
  markBranchAbandoned(branchId: string): Promise<void>;
  theme: Readable<ExtensionTheme>;
  /** The sidebar drag-reorder currently in progress, or null when idle. */
  reorderContext: Readable<ReorderContext | null>;
  /**
   * Id of the sidebar block currently hovered over its drag-grip
   * column, or null when no block is hovered. Extensions that render
   * section banners can subscribe to this to paint hover-only UI (e.g.
   * a dark-dot frit over the rail-overlap zone) in sync with core-owned
   * section hover affordances.
   */
  hoveredSidebarBlockId: Readable<string | null>;
  /**
   * Key of the Workspaces-section root row currently hovered over its
   * grip column, encoded as `"kind:id"` (e.g. `"workspace:g-42"`), or
   * null when no row is hovered. Renderers registered via
   * `registerRootRowRenderer` use this to derive their own
   * expansion/frit state in sync with the core-owned grip.
   */
  hoveredRootRowKey: Readable<string | null>;
  settings: Readable<Record<string, unknown>>;

  // Dashboard zone helpers — query mountable content from registries
  getDashboardTabs(): Array<{
    id: string;
    label: string;
    component: unknown;
    props?: Record<string, unknown>;
  }>;

  /**
   * Shared UI components — use these instead of importing core internals.
   *
   * - **WorkspaceListView** — renders workspace items with full interaction
   *   Props: `{ filterIds?: Set<string>, accentColor?: string }`
   * - **SplitButton** — primary action + dropdown caret for secondary actions
   *   Props: `{ label, onMainClick, dropdownItems, theme }`
   * - **ColorPicker** — grid of color swatches with selection state
   *   Props: `{ theme: Readable<ThemeDef>, value: string (bindable), colors?: string[] }`
   * - **DragGrip** — left-border drag handle that appears on hover
   *   Props: `{ theme, visible, onMouseDown, ariaLabel? }`
   * - **SidebarBanner** — root-row chrome for a Workspace banner in the
   *   primary sidebar. Owns grip + visible bar + nested list. Banner
   *   can represent a first-class workspace by wiring
   *   onBannerClick/onClose to switchWorkspace/closeWorkspace.
   *   Props: `{ color, foreground, parentColor?, onGripMouseDown?,
   *     onBannerClick?, onBannerContextMenu?, onClose?, filterIds,
   *     dashboardHintFor?, hideStatusBadges?, scopeId, containerBlockId,
   *     containerLabel }` + slots: icon / banner-end / banner-subtitle.
   */
  getComponents(): {
    WorkspaceListView: unknown;
    SplitButton: unknown;
    ColorPicker: unknown;
    DragGrip: unknown;
    DropGhost: unknown;
    SidebarBanner: unknown;
    PathStatusLine: unknown;
  };

  /**
   * Create a drag-reorder handle for a custom reorderable list.
   * Shared mouse-based implementation (HTML5 DnD is broken in Tauri WKWebView).
   * The caller provides a data attribute selector, container selector, and
   * onDrop callback; the returned handle exposes `start(e, idx)` and
   * `getState()` for wiring into the component's own reactive state.
   *
   * Pass `scope: "inner"` for row-level drags nested inside a sidebar block —
   * outer-block drag will be suppressed while this drag is active, so the
   * two reorder contexts never compete.
   */
  createDragReorder(
    config: DragReorderConfig & {
      scope?: "inner" | "block";
      /**
       * Called on every drag state change. Return the ReorderContext to
       * publish to the global reorder-context store (or null when the drag
       * ends). The sidebar reads this store to render per-level dims and
       * labels on every block, Workspace, and Branch.
       *
       * Required for `scope: "inner"` drags that should participate in the
       * global overlay system.
       */
      buildReorderContext?: (state: DragReorderState) => ReorderContext | null;
    },
  ): DragReorderHandle;
}

/**
 * Describes the sidebar drag-reorder currently in progress.
 *
 * - `kind: "branch"` — a Branch row is being dragged.
 *   `scopeId` is the immediate container: `"__workspaces__"` when dragging
 *   from the unattached list, or a Workspace id when dragging inside a
 *   Workspace block. `containerBlockId` is the top-level sidebar block the
 *   drag lives in.
 * - `kind: "workspace"` — a workspace row is being dragged inside the
 *   Workspaces block. `sourceWorkspaceId` is the id of the dragged workspace.
 * - `kind: "section"` — a top-level sidebar block is being dragged.
 *   `sourceBlockId` is the block id.
 */
export type ReorderContext =
  | { kind: "branch"; scopeId: string; containerBlockId: string }
  | {
      kind: "workspace";
      sourceWorkspaceId: string;
      containerBlockId: string;
    }
  | { kind: "section"; sourceBlockId: string }
  | {
      // Root-level drag inside the Workspaces section — the unified
      // lane that covers unclaimed workspaces + whole workspace
      // blocks. `sourceKind` + `sourceId` identify the dragged row so
      // sibling rows (of any kind) can resolve their overlay.
      kind: "rootRow";
      sourceKind: "branch" | "workspace" | string;
      sourceId: string;
      containerBlockId: string;
    };

/** Config for createDragReorder — re-exported so extensions can type their usage. */
export interface DragReorderConfig {
  dataAttr: string;
  containerSelector: string;
  ghostStyle: () => { background: string; border: string };
  onDrop: (fromIdx: number, toIdx: number) => void;
  canStart?: () => boolean;
  onStateChange?: () => void;
}

export interface DragReorderState {
  sourceIdx: number | null;
  indicator: { idx: number; edge: "before" | "after" } | null;
  active: boolean;
  /** Pixel height of the source element at drag start — consumers use
   *  this to render a ghost placeholder at the drop target that matches
   *  the source's dimensions. */
  sourceHeight: number;
}

export interface DragReorderHandle {
  start: (e: MouseEvent, idx: number) => void;
  getState: () => DragReorderState;
}

// --- Workspace action types ---

/**
 * Context passed to workspace action handlers and `when` filters.
 *
 * Core passes an empty context `{}` for top-level actions. Extensions
 * may populate additional fields (e.g., workspace or git metadata) when
 * invoking actions from their own UI. Use optional chaining to access
 * extension-provided fields safely.
 */
export interface WorkspaceActionContext {
  [key: string]: unknown;
}

export interface WorkspaceActionInfo {
  id: string;
  label: string;
  icon: string;
  shortcut?: string;
  zone?: "workspace" | "sidebar" | "workspace-tile";
  handler: (ctx: WorkspaceActionContext) => void | Promise<void>;
  when?: (ctx: WorkspaceActionContext) => boolean;
}

// --- Dashboard contributions / pseudo-workspaces ---
//
// Extensions register a DashboardContributionInput or
// PseudoWorkspaceInput via the corresponding ExtensionAPI method; core
// attaches `source` and stores the full record in the registry.

/**
 * Minimum shape of a Workspace passed to contribution hooks. The
 * canonical type lives in core (`src/lib/types.ts#Workspace`); the
 * public API exposes the read-only subset that contributions are
 * allowed to inspect so core can evolve the stored record without
 * breaking extensions.
 */
export interface WorkspaceRef {
  id: string;
  name: string;
  /** Root CWD — contributions typically place markdown under `<path>/.gnar-term/...`. */
  path?: string;
  color?: string;
  isGit?: boolean;
  /** Set on Branches / dashboards; identifies the root Workspace they belong to. */
  rootWorkspaceId?: string;
  /** Worktree-backed Workspace fields (BranchedWorkspace). */
  worktreePath?: string;
  branch?: string;
  baseBranch?: string;
  repoPath?: string;
  /** Dashboard discriminants. */
  isDashboard?: boolean;
  dashboardContributionId?: string;
  /** Provenance markers populated by spawn-helper / worktree-service. */
  spawnedBy?:
    | { kind: "global" }
    | { kind: "workspace"; rootWorkspaceId: string };
  spawnedFromIssues?: number[];
}

/**
 * Spec passed to `ExtensionAPI.openDashboardTab`. Surface ids without `:`
 * are namespaced under the calling extension's id at call time. Mirrors
 * the internal `DashboardTabSpec`.
 */
export type ExtensionDashboardTabSpec =
  | {
      kind: "registry";
      surfaceTypeId: string;
      title: string;
      props?: Record<string, unknown>;
      /**
       * Subset of `props` used to dedupe an existing matching tab. When
       * omitted, dedup falls back to surfaceTypeId equality.
       */
      matchProps?: Record<string, unknown>;
      /**
       * Stable contribution id (e.g. `"agentic"`). Stamped onto the
       * resulting RegistrySurface so close-by-contribution helpers can
       * find dashboard tabs without scanning props.
       */
      dashboardContributionId?: string;
    }
  | {
      kind: "preview";
      path: string;
      title?: string;
      dashboardContributionId?: string;
    };

/**
 * Arguments for `ExtensionAPI.registerDashboardContribution`. See the
 * registry docs in `src/lib/services/dashboard-contribution-registry.ts`
 * for lifecycle details.
 */
export interface DashboardContributionInput {
  /**
   * Stable identifier. Also stamped as `metadata.dashboardContributionId`
   * on the created dashboard workspace so the grid can attribute
   * tiles. Must be unique across all contributions.
   */
  id: string;
  /** Tile label (e.g. "Agentic Dashboard"). */
  label: string;
  /** Context-menu verb (e.g. "Add Agentic Dashboard"). */
  actionLabel: string;
  /**
   * Maximum coexisting dashboard tabs of this kind per workspace. `1` is
   * the canonical exclusive cap; `Number.POSITIVE_INFINITY` for unlimited.
   */
  capPerWorkspace: number;
  /**
   * Optional "delete and regenerate" hook surfaced as a button next to
   * the dashboard's row in Workspace Settings. Implementations typically
   * force-rewrite the dashboard's backing markdown so a stale user
   * file picks up a newer seeded template. Contributions without
   * backing state (e.g. Diff) omit this and the button does not render.
   */
  regenerate?: (workspace: WorkspaceRef) => Promise<void>;
  /**
   * Optional gate — when returns false, the contribution is hidden from
   * this workspace's "Add Dashboard" menu.
   */
  isAvailableFor?: (workspace: WorkspaceRef) => boolean;
  /**
   * Optional icon component rendered on the dashboard tile. Tiles are
   * icon-only; the workspace name is surfaced as the tile's `title`.
   */
  icon?: unknown;
  /**
   * When true, the contribution materializes on every workspace
   * (at workspace creation and startup reconciliation) and cannot be
   * removed. Also hides the contribution from "Add Dashboard" menus
   * and suppresses the per-tile Delete action.
   */
  autoProvision?: boolean;
  /**
   * When true, the contribution materializes automatically for every
   * workspace on first creation / reconciliation, but the user CAN
   * remove it. Closing a defaultEnabled dashboard records the
   * dismissal on the workspace so the next reconcile pass does not
   * recreate it. Re-enabling from Settings clears the dismissal.
   *
   * Use this for default-on extension dashboards. `autoProvision` and
   * `defaultEnabled` are mutually exclusive — `autoProvision` wins.
   */
  defaultEnabled?: boolean;
  /**
   * Hints for how PaneView should render the dashboard workspace.
   * `singleSurface: true` documents that the contribution's
   * workspace is a tab-less / split-less single-surface pane.
   */
  paneConstraints?: { singleSurface?: boolean };
  /**
   * Human-readable reason the contribution's toggle is locked in the
   * Settings dashboard's per-workspace toggle list. Typically set
   * alongside `autoProvision: true`.
   */
  lockedReason?: string;
  /**
   * Open this dashboard as a tab inside the workspace's active pane.
   * Required — dashboards live as tabs, not as separate workspaces.
   *
   * Pass `activate: false` to push the tab into the pane without
   * activating the workspace or focusing the new surface (used during
   * auto-provisioning so the workspace's seeded terminal stays focused
   * after creation).
   */
  openAsTab: (
    workspace: WorkspaceRef,
    opts?: { activate?: boolean },
  ) => Promise<void>;
}

/**
 * Arguments for `ExtensionAPI.registerPseudoWorkspace`. See the registry
 * docs in `src/lib/services/pseudo-workspace-registry.ts`.
 */
export interface PseudoWorkspaceInput {
  /** Stable identifier. Convention: `<extensionId>.<name>`. */
  id: string;
  /** Human-readable label (a11y + context menus). */
  label: string;
  /** Pin position within the root list. */
  position: "root-top" | "root-bottom";
  /** Icon component rendered in the root-row entry. */
  icon: unknown;
  /** Body component rendered when the pseudo-workspace is active. */
  render: unknown;
  /**
   * Synthetic workspace metadata made available to the body via
   * `DashboardHostContext`. Mirror whatever a real dashboard workspace
   * would carry for the same role (e.g.
   * `{ isGlobalAgenticDashboard: true }`).
   */
  metadata: Record<string, unknown>;
  /** Optional settings component surfaced in the extension's settings page. */
  settings?: unknown;
  /**
   * Optional component rendered INSIDE the sidebar root row,
   * to the right of `icon`, in place of the plain text label. Mounted
   * with the registering extension's `api` provided via context so the
   * widget can subscribe to live state (`api.agents`, etc.). Footprint
   * should stay compact — the row banner is ~40px tall.
   */
  rowBody?: unknown;
  /** Called after the row is removed; register a reopen action or persist closed state. */
  onClose?: () => void;
}

// --- Workspace template shapes for createWorkspaceFromDef ---

/**
 * Shape of a single surface inside a `WorkspaceDefInput.layout` pane.
 * Mirrors the on-disk SurfaceDef but trimmed to the fields contributors
 * are expected to set.
 */
export interface SurfaceDefInput {
  /**
   * `"registry"` is the modern spelling for surfaces resolved through the
   * surface-type registry. `"extension"` is accepted as a deprecated alias
   * — existing user configs and contributors still using the old name keep
   * working.
   */
  type: "terminal" | "browser" | "registry" | "extension" | "preview";
  name?: string;
  command?: string;
  cwd?: string;
  env?: Record<string, string>;
  /** Browser surfaces only. */
  url?: string;
  /** `<extension-id>:<surface-id>` for registry-typed surfaces. */
  extensionType?: string;
  /** Opaque props forwarded to the surface component. */
  extensionProps?: Record<string, unknown>;
  /** Absolute path for preview-typed surfaces. */
  path?: string;
  focus?: boolean;
}

export interface PaneDefInput {
  surfaces: SurfaceDefInput[];
}

export interface SplitDefInput {
  direction: "horizontal" | "vertical";
  split?: number;
  children: [LayoutNodeInput, LayoutNodeInput];
}

export type LayoutNodeInput = { pane: PaneDefInput } | SplitDefInput;

/**
 * Workspace template accepted by `api.createWorkspaceFromDef`. Mirrors
 * the public subset of core's `WorkspaceTemplate`. Use this from
 * dashboard contribution `create:` callbacks to materialize a new
 * workspace declaratively.
 *
 * Pass `rootWorkspaceId` to attach the new workspace as a Branch of an
 * existing root Workspace; pass `isDashboard: true` plus a
 * `dashboardContributionId` for dashboard variants. Extension-specific
 * data goes in `extensionData`.
 */
export interface WorkspaceDefInput {
  name?: string;
  cwd?: string;
  color?: string;
  env?: Record<string, string>;
  layout?: LayoutNodeInput;
  rootWorkspaceId?: string;
  isDashboard?: boolean;
  dashboardContributionId?: string;
  /**
   * Worktree-backed branched workspace fields. Set together when the
   * caller is materializing an agentic Controlled Workspace from an
   * extension (e.g. the agentic dashboard's spawn flow). `worktreePath`
   * + `branch` are what `isBranchedWorkspace` checks for.
   */
  worktreePath?: string;
  branch?: string;
  baseBranch?: string;
  repoPath?: string;
  /**
   * Marks the resulting workspace as agentic-Controlled. Drives
   * lifecycle-pill visibility and agentic-dashboard participation.
   */
  controlled?: boolean;
  extensionData?: Record<string, unknown>;
}

// --- Git operation result types ---

/** Result of a git_merge Tauri command invocation. */
export interface MergeResult {
  success: boolean;
  message: string;
  conflicts?: string[];
}

// --- Public-facing core state types (stable subset for extensions) ---

export interface SurfaceRef {
  id: string;
  kind: string;
  title: string;
  hasUnread: boolean;
}

export interface PaneRef {
  id: string;
  surfaces: SurfaceRef[];
  activeSurfaceId: string | null;
}

/**
 * Public projection of a `GnarTermConfig.agents[]` preset entry. Mirrors
 * the canonical `AgentPreset` shape in `src/lib/agents-config.ts` so the
 * public API surface stays decoupled from core internals.
 */
export interface AgentPresetRef {
  /** Human-readable label shown in spawn pickers. */
  name: string;
  /** Shell command used to start the agent, e.g. `"claude"`. */
  command: string;
  /** Extra environment variables injected into the spawned pane. */
  env?: Record<string, string>;
  /** Which detection entry this preset maps to (e.g. `"claude-code"`). */
  intendedAgent?: string;
  /** Override working directory for the spawned pane. */
  defaultCwd?: string;
  /** When true, automatically spawn this preset in matching workspaces. */
  autoSpawn?: boolean;
  /** Text sent to the agent pane immediately after spawn. */
  initialPrompt?: string;
}

/**
 * Public projection of a detected agent. Matches the core
 * DetectedAgent type but keeps the extension-visible shape narrow so
 * the public API can evolve without breaking downstream extensions.
 */
export interface AgentRef {
  agentId: string;
  agentName: string;
  surfaceId: string;
  /** Pane hosting the agent's surface. May be null briefly during startup
   *  before the surface→pane mapping resolves. */
  paneId: string | null;
  workspaceId: string;
  status: string;
  createdAt: string;
  lastStatusChange: string;
}

// --- Branch lifecycle projections ---
//
// Lifecycle is DERIVED in core by branch-lifecycle.ts from canonical
// inputs (git state, PR state, paneAgentStateStore, activity timestamp).
// Extensions consume the derived store read-only; the only state-
// mutating action surfaced here is `markBranchAbandoned`, which routes
// through the workspace-close path.

/**
 * Lifecycle states a Branch can occupy. See `branch-lifecycle.ts` for
 * the derivation table. When `gh` is unavailable, `in_review` / `merged`
 * collapse to `awaiting_review` and `prStateKnown` is set to `false`.
 */
export type BranchLifecycle =
  | "draft"
  | "active"
  | "awaiting_review"
  | "in_review"
  | "merged"
  | "abandoned";

/** Entry stored per-branch in the `branchLifecycle` store. */
export interface BranchLifecycleEntry {
  lifecycle: BranchLifecycle;
  /** False when `gh` is unavailable, so UI can show an appropriate hint. */
  prStateKnown: boolean;
  /** Unix millisecond timestamp of the most recent detected activity. */
  lastActivityAt: number;
  /** Optional human-readable explanation of why this lifecycle was computed. */
  reason?: string;
}

/**
 * Read-only descriptor returned by `listBranches`. Pairs each branchId
 * with its repo/pane context so extensions can resolve a branch back to
 * its worktree or active pane without re-deriving from the workspaces
 * store.
 */
export interface BranchDescriptorRef {
  branchId: string;
  repoPath: string;
  branch: string;
  baseBranch: string;
  paneId: string | null;
}

// --- Attention projections ---
//
// Attention events are DERIVED in core by attention-api.ts from
// paneAgentStateStore (state transitions into awaiting_input/errored)
// and oscNotificationStore (notify/error/progress/complete kinds).
// Extensions consume the derived store read-only; mutations go through
// `dismissAttention` (per-pane clear) or `pushExternalAttention` (out
// of band injection from MCP / extensions).

export type AttentionEventKind =
  | "awaiting_input"
  | "errored"
  | "completed"
  | "notify"
  | "progress";

export type AttentionEventSource = "agent-state" | "osc" | "external";

/** Entry stored in the `attention` store, newest first. */
export interface AttentionEventRef {
  paneId: string;
  surfaceId?: string;
  agentType?: string;
  kind: AttentionEventKind;
  title?: string;
  body?: string;
  level?: string;
  source: AttentionEventSource;
  createdAt: number;
}

/**
 * MCP dispatch log entry projected to the public extension surface. Backs the
 * `mcpEvents` readable; the store is newest-last with a rolling cap of 500.
 * `resolved` is populated for tools that take a workspace/pane target.
 */
export interface McpEventRef {
  /** ISO timestamp when the tool dispatch completed. */
  ts: string;
  connectionId: number;
  tool: string;
  args: unknown;
  resolved?: {
    workspaceId: string;
    paneId: string | null;
    source: string;
  };
  result?: { kind: "ok"; summary: string } | { kind: "error"; message: string };
}

/**
 * Per-workspace recorded session entry projected to the public extension
 * surface. Backs the `sessions` readable as a flat newest-last list across
 * all workspaces.
 */
export interface SessionRef {
  workspaceId: string;
  surfaceName: string;
  /** Absolute path to the recorded session log file. */
  logPath: string;
  /** Epoch milliseconds when the session was recorded. */
  timestamp: number;
}

/** Shape of a registry-backed surface, as delivered to surface components. */
export interface RegistrySurfacePayload {
  kind: "registry";
  id: string;
  surfaceTypeId: string;
  title: string;
  hasUnread: boolean;
  props?: Record<string, unknown>;
  dispose?: () => void;
}

// --- Extension entry point ---

export type ExtensionRegisterFn = (api: ExtensionAPI) => void | Promise<void>;

// --- Context helper ---

/**
 * Context key used by GnarTerm to inject the ExtensionAPI into Svelte components.
 * Use with Svelte's getContext() in your component's <script> block:
 *
 *   import { getContext } from "svelte";
 *   import { EXTENSION_API_KEY, type ExtensionAPI } from "./api";
 *   const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
 */
export const EXTENSION_API_KEY = "gnar-term:extension-api";

// --- Tauri command types (for use with api.invoke()) ---

/**
 * Directory entry returned by the "list_dir" command.
 */
export interface DirEntry {
  name: string;
  is_dir: boolean;
  is_hidden: boolean;
}

/**
 * Available Tauri commands for extensions via api.invoke().
 *
 * All file system commands validate paths — reads to ~/.ssh, ~/.gnupg, ~/.aws,
 * ~/.kube, ~/.config/gcloud, and ~/.docker are blocked.
 * Writes are restricted to ~/.config/gnar-term/.
 * Note: most system paths (e.g. /etc/hosts) are allowed for reads.
 * Exceptions: /etc/shadow and /etc/gshadow are blocked.
 *
 * Usage:
 *   const entries = await api.invoke<DirEntry[]>("list_dir", { path: "/tmp" });
 *
 * Commands:
 *
 *   File System:
 *     "file_exists"    { path: string }                    → boolean
 *     "list_dir"       { path: string }                    → DirEntry[]
 *     "read_file"      { path: string }                    → string
 *     "read_file_base64" { path: string }                  → string (base64)
 *     "write_file"     { path: string, content: string }   → void (restricted to ~/.config/gnar-term/)
 *     "ensure_dir"     { path: string }                    → void (restricted to ~/.config/gnar-term/)
 *     "remove_dir"     { path: string }                    → void (restricted to ~/.config/gnar-term/)
 *     "get_home"       {}                                  → string
 *
 *   Git:
 *     "is_git_repo"    { path: string }                    → boolean
 *     "list_gitignored" { path: string }                   → string[]
 *
 *   File Watching:
 *     "watch_file"     { path: string }                    → number (watchId)
 *     "unwatch_file"   { watchId: number }                 → void
 *     Use api.onFileChanged(watchId, handler) to receive change events.
 *
 *   Git Worktree:
 *     "create_worktree" { repoPath: string, branch: string, base: string, worktreePath: string } → void
 *     "remove_worktree" { repoPath: string, worktreePath: string } → void
 *     "list_worktrees"  { repoPath: string }               → WorktreeInfo[]
 *     "list_branches"   { repoPath: string, includeRemote: boolean } → BranchInfo[]
 *
 *   Git Operations:
 *     "git_clone"       { url: string, targetDir: string }  → void
 *     "push_branch"     { repoPath: string, branch: string, remote?: string } → void
 *     "delete_branch"   { repoPath: string, branch: string, remote?: boolean } → void
 *     "git_checkout"    { repoPath: string, branch: string } → void
 *     "git_log"         { repoPath: string, count?: number } → CommitInfo[]
 *     "git_status"      { repoPath: string }                → FileStatus[]
 *     "git_diff"        { repoPath: string, file?: string, base?: string, head?: string } → string
 *     "git_merge"       { repoPath: string, branch: string } → MergeResult
 *
 *   GitHub CLI:
 *     "gh_list_issues"  { repoPath: string, state?: string } → GhIssue[]
 *     "gh_list_prs"     { repoPath: string, state?: string } → GhPr[]
 *
 *   File Utilities (requires permissions):
 *     "copy_files"      { sourceDir: string, destDir: string, patterns: string[] } → number  (requires "filesystem")
 *     "run_script"      { cwd: string, command: string }   → ScriptOutput  (requires "shell")
 *
 *   System:
 *     "show_in_file_manager" { path: string }              → void
 *     "open_with_default_app" { path: string }             → void
 *     "find_file"      { name: string }                    → string
 *
 *   PTY (requires "pty" permission):
 *     "spawn_pty"       { cwd: string, ... }               → number (ptyId)
 *     "write_pty"       { id: number, data: string }       → void
 *     "kill_pty"        { id: number }                     → void
 *     "resize_pty"      { id: number, cols: number, rows: number } → void
 *     "get_pty_cwd"     { id: number }                     → string
 *     "get_pty_title"   { id: number }                     → string
 *     "pause_pty"       { id: number }                     → void
 *     "resume_pty"      { id: number }                     → void
 */
