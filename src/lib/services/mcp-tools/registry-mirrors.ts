import { get } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import { nestedWorkspaces } from "../../stores/workspace";
import { surfaceTypeStore } from "../surface-type-registry";
import { commandStore } from "../command-registry";
import { sidebarTabStore, activateSidebarTab } from "../sidebar-tab-registry";
import { workspaceActionStore } from "../workspace-action-registry";
import {
  contextMenuItemStore,
  getContextMenuItemsForFile,
} from "../context-menu-item-registry";
import { sidebarSectionStore } from "../sidebar-section-registry";
import { dashboardWorkspaceRegistry } from "../dashboard-workspace-service";
import { workspaceSubtitleStore } from "../workspace-subtitle-registry";
import { dashboardTabStore } from "../dashboard-tab-registry";
import {
  canAddContributionToGroup,
  dashboardContributionStore,
  getDashboardContribution,
} from "../dashboard-contribution-registry";
import {
  closeDashboardForGroup,
  isDashboardWorkspace,
} from "../workspace-group-service";
import { getWorkspaceGroup } from "../../stores/workspace-groups";
import { listMarkdownComponents } from "../markdown-component-registry";
import type { ToolDef } from "../mcp-types";

export const registryMirrorTools: ToolDef[] = [
  // ---- Generic surface-type discovery ----
  {
    name: "list_surface_types",
    description:
      "List all registered extension surface types. Ids are namespaced as `<extension-id>:<surface-id>`. Returns `{ id, label, source }` for each. Built-in terminals are not included — use spawn_agent to create one.",
    inputSchema: { type: "object", properties: {} },
    handler: () => {
      const types = get(surfaceTypeStore).map((t) => ({
        id: t.id,
        label: t.label,
        source: t.source,
      }));
      return { types };
    },
  },

  // ---- Commands (mirror of commandStore) ----
  {
    name: "list_commands",
    description:
      "List every command registered in the command palette — core seed commands and anything contributed by an extension. Returns `{ id, title, shortcut?, source }` for each.",
    inputSchema: { type: "object", properties: {} },
    handler: () => {
      const commands = get(commandStore).map((c) => ({
        id: c.id,
        title: c.title,
        shortcut: c.shortcut,
        source: c.source,
      }));
      return { commands };
    },
  },
  {
    name: "invoke_command",
    description:
      "Invoke a command by id (see list_commands). The command's action runs in the webview and takes no arguments; some commands may open interactive prompts (text input, directory picker) — agents should expect those to block until the user responds.",
    inputSchema: {
      type: "object",
      properties: {
        command_id: { type: "string" },
      },
      required: ["command_id"],
    },
    handler: async (args) => {
      const p = args as { command_id: string };
      const cmd = get(commandStore).find((c) => c.id === p.command_id);
      if (!cmd) {
        throw new Error(
          `Unknown command: ${p.command_id}. Call list_commands to see what's available.`,
        );
      }
      await cmd.action();
      return { ok: true };
    },
  },

  // ---- Sidebar tabs (mirror of sidebarTabStore) ----
  {
    name: "list_sidebar_tabs",
    description:
      "List secondary-sidebar tabs contributed by extensions. Returns `{ id, label, source }` for each. Use activate_sidebar_tab to switch to one.",
    inputSchema: { type: "object", properties: {} },
    handler: () => {
      const tabs = get(sidebarTabStore).map((t) => ({
        id: t.id,
        label: t.label,
        source: t.source,
      }));
      return { tabs };
    },
  },
  {
    name: "activate_sidebar_tab",
    description:
      "Switch the secondary sidebar to a registered tab by id (see list_sidebar_tabs).",
    inputSchema: {
      type: "object",
      properties: { tab_id: { type: "string" } },
      required: ["tab_id"],
    },
    handler: (args) => {
      const p = args as { tab_id: string };
      const tab = get(sidebarTabStore).find((t) => t.id === p.tab_id);
      if (!tab) {
        throw new Error(
          `Unknown sidebar tab: ${p.tab_id}. Call list_sidebar_tabs to see what's registered.`,
        );
      }
      activateSidebarTab(p.tab_id);
      return { ok: true };
    },
  },

  // ---- NestedWorkspace actions (mirror of workspaceActionStore) ----
  {
    name: "list_workspace_actions",
    description:
      "List workspace actions — buttons extensions add to the workspace header or top bar. Returns `{ id, label, icon, shortcut?, zone, source }` for each. Use invoke_workspace_action to trigger one.",
    inputSchema: { type: "object", properties: {} },
    handler: () => {
      const actions = get(workspaceActionStore).map((a) => ({
        id: a.id,
        label: a.label,
        icon: a.icon,
        shortcut: a.shortcut,
        zone: a.zone ?? "workspace",
        source: a.source,
      }));
      return { actions };
    },
  },
  {
    name: "invoke_workspace_action",
    description:
      "Invoke a workspace action by id (see list_workspace_actions). `context` is forwarded to the action's handler — core passes an empty object for top-level invocations; extensions that dispatch actions from their own UI may populate fields like `{ workspaceId, groupId, branch, isGit }`. Use the owning extension's docs to learn which fields it reads.",
    inputSchema: {
      type: "object",
      properties: {
        action_id: { type: "string" },
        context: {
          type: "object",
          additionalProperties: true,
          description:
            "Free-form object forwarded to the handler. Typical fields: workspaceId, groupId, groupPath, branch, isGit. Shape depends on the owning extension.",
        },
      },
      required: ["action_id"],
    },
    handler: async (args) => {
      const p = args as {
        action_id: string;
        context?: Record<string, unknown>;
      };
      const action = get(workspaceActionStore).find(
        (a) => a.id === p.action_id,
      );
      if (!action) {
        throw new Error(
          `Unknown workspace action: ${p.action_id}. Call list_workspace_actions to see what's registered.`,
        );
      }
      await action.handler(p.context ?? {});
      return { ok: true };
    },
  },

  // ---- Context menu items (mirror of contextMenuItemStore) ----
  {
    name: "list_context_menu_items",
    description:
      "List context-menu items contributed by extensions — file-typed actions gated by a glob `when` pattern. Pass `file_path` to filter to items whose `when` pattern matches that path. Returns `{ id, label, when, source }` for each. Use invoke_context_menu_item to trigger one.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description:
            "Optional. When provided, only items whose `when` pattern matches the file's extension are returned.",
        },
      },
    },
    handler: (args) => {
      const p = (args ?? {}) as { file_path?: string };
      const all = get(contextMenuItemStore);
      const filtered = p.file_path
        ? getContextMenuItemsForFile(p.file_path)
        : all;
      return {
        items: filtered.map((i) => ({
          id: i.id,
          label: i.label,
          when: i.when,
          source: i.source,
        })),
      };
    },
  },
  {
    name: "invoke_context_menu_item",
    description:
      "Invoke a context-menu item against a concrete file path. Errors if the item's `when` pattern does not match the file. Use list_context_menu_items with `file_path` to find matching items first.",
    inputSchema: {
      type: "object",
      properties: {
        item_id: { type: "string" },
        file_path: { type: "string" },
      },
      required: ["item_id", "file_path"],
    },
    handler: async (args) => {
      const p = args as { item_id: string; file_path: string };
      const item = get(contextMenuItemStore).find((i) => i.id === p.item_id);
      if (!item) {
        throw new Error(
          `Unknown context menu item: ${p.item_id}. Call list_context_menu_items to see what's registered.`,
        );
      }
      const [exists] = await invoke<[boolean, boolean]>("mcp_file_info", {
        path: p.file_path,
      });
      if (!exists) {
        throw new Error(
          `File path not accessible (missing or blocked by read allowlist): ${p.file_path}`,
        );
      }
      const matching = getContextMenuItemsForFile(p.file_path);
      if (!matching.some((i) => i.id === p.item_id)) {
        throw new Error(
          `Context menu item ${p.item_id} (when=${item.when}) does not match file path ${p.file_path}.`,
        );
      }
      await item.handler(p.file_path);
      return { ok: true };
    },
  },

  // ---- Sidebar sections (mirror of sidebarSectionStore) ----
  {
    name: "list_sidebar_sections",
    description:
      "List primary-sidebar sections contributed by extensions — sticky panels below Workspaces. Returns `{ id, label, source }` for each. Sections are rendered by core; no invoke tool exists because interaction happens inside the section's own component.",
    inputSchema: { type: "object", properties: {} },
    handler: () => {
      const sections = get(sidebarSectionStore).map((s) => ({
        id: s.id,
        label: s.label,
        source: s.source,
      }));
      return { sections };
    },
  },

  // ---- Dashboard Workspaces (mirror of dashboardWorkspaceRegistry) ----
  {
    name: "list_dashboard_workspaces",
    description:
      "List singleton Dashboard Workspaces registered by core and extensions. Returns `{ id, label, source }` for each. Use spawn_or_navigate (or the owning extension's TitleBar button / command) to open one.",
    inputSchema: { type: "object", properties: {} },
    handler: () => {
      const entries = Array.from(get(dashboardWorkspaceRegistry).values()).map(
        (e) => ({ id: e.id, label: e.label, source: e.source }),
      );
      return { dashboardWorkspaces: entries };
    },
  },

  // ---- NestedWorkspace subtitles (mirror of workspaceSubtitleStore) ----
  {
    name: "list_workspace_subtitles",
    description:
      "List workspace-subtitle contributors — components extensions render below workspace names in the sidebar (e.g. git branch label). Returns `{ id, source, priority }` for each, sorted by priority ascending (lower renders first).",
    inputSchema: { type: "object", properties: {} },
    handler: () => {
      const entries = get(workspaceSubtitleStore).map((s) => ({
        id: s.id,
        source: s.source,
        priority: s.priority,
      }));
      return { subtitles: entries };
    },
  },

  // ---- Dashboard tabs (mirror of dashboardTabStore) ----
  {
    name: "list_dashboard_tabs",
    description:
      "List extension-contributed tabs for the dashboard overlay. Returns `{ id, label, source }` for each.",
    inputSchema: { type: "object", properties: {} },
    handler: () => {
      const tabs = get(dashboardTabStore).map((t) => ({
        id: t.id,
        label: t.label,
        source: t.source,
      }));
      return { tabs };
    },
  },

  // ---- Dashboard contributions (per-group add / remove / list) ----
  {
    name: "list_dashboard_contributions",
    description:
      "List every registered Dashboard contribution. When `group_id` is provided, each row also carries `active` (whether the group has a dashboard workspace for this contribution) and `workspace_id` when active. `autoProvision` contributions cannot be added or removed; the Settings dashboard toggle surfaces this via `locked_reason`.",
    inputSchema: {
      type: "object",
      properties: {
        group_id: {
          type: "string",
          description:
            "Optional. When set, annotate each row with active state.",
        },
      },
    },
    handler: (args) => {
      const p = args as { group_id?: string };
      const contribs = get(dashboardContributionStore);
      const group = p.group_id ? getWorkspaceGroup(p.group_id) : undefined;
      if (p.group_id && !group) {
        throw new Error(`Unknown workspace group: ${p.group_id}`);
      }
      const wsList = group ? get(nestedWorkspaces) : [];
      return {
        contributions: contribs.map((c) => {
          const base = {
            id: c.id,
            source: c.source,
            label: c.label,
            action_label: c.actionLabel,
            cap_per_group: c.capPerGroup,
            auto_provision: c.autoProvision === true,
            locked_reason: c.lockedReason,
          };
          if (!group) return base;
          const wsForContrib = wsList.find((w) =>
            isDashboardWorkspace(w, group.id, c.id),
          );
          return {
            ...base,
            active: Boolean(wsForContrib),
            workspace_id: wsForContrib?.id,
          };
        }),
      };
    },
  },
  {
    name: "add_dashboard_to_group",
    description:
      "Materialize a dashboard workspace for a Workspace by running the contribution's create hook. Errors when the contribution is autoProvision (those materialize automatically and cannot be added manually), already at its per-group cap, unknown, or gated out by the contribution's availability predicate. Returns the new workspace id.",
    inputSchema: {
      type: "object",
      properties: {
        group_id: { type: "string" },
        contribution_id: { type: "string" },
      },
      required: ["group_id", "contribution_id"],
    },
    handler: async (args) => {
      const p = args as { group_id: string; contribution_id: string };
      const group = getWorkspaceGroup(p.group_id);
      if (!group) throw new Error(`Unknown workspace group: ${p.group_id}`);
      const contribution = getDashboardContribution(p.contribution_id);
      if (!contribution) {
        throw new Error(`Unknown dashboard contribution: ${p.contribution_id}`);
      }
      if (contribution.autoProvision) {
        throw new Error(
          `Dashboard contribution "${p.contribution_id}" is autoProvision — it materializes automatically and cannot be added manually.`,
        );
      }
      const currentCount = get(nestedWorkspaces).filter((w) =>
        isDashboardWorkspace(w, group.id, contribution.id),
      ).length;
      if (!canAddContributionToGroup(group, contribution.id, currentCount)) {
        throw new Error(
          `Cannot add "${p.contribution_id}" to group "${p.group_id}" (at cap or gated by availability).`,
        );
      }
      const workspaceId = await contribution.create(group);
      return { workspace_id: workspaceId };
    },
  },
  {
    name: "remove_dashboard_from_group",
    description:
      "Close the dashboard workspace for `{group_id, contribution_id}`. Errors when the contribution is autoProvision (core Overview, core Settings, and the Agentic dashboard cannot be removed this way). Returns `{ removed: true }` on success, `{ removed: false }` when no such workspace existed.",
    inputSchema: {
      type: "object",
      properties: {
        group_id: { type: "string" },
        contribution_id: { type: "string" },
      },
      required: ["group_id", "contribution_id"],
    },
    handler: (args) => {
      const p = args as { group_id: string; contribution_id: string };
      const contribution = getDashboardContribution(p.contribution_id);
      if (!contribution) {
        throw new Error(`Unknown dashboard contribution: ${p.contribution_id}`);
      }
      if (contribution.autoProvision) {
        throw new Error(
          `Dashboard contribution "${p.contribution_id}" is autoProvision — locked on this group.`,
        );
      }
      const removed = closeDashboardForGroup(p.group_id, p.contribution_id);
      return { removed };
    },
  },

  // ---- Markdown components ----
  {
    name: "list_markdown_components",
    description:
      "List all registered markdown components — the things `gnar:<name>` markdown directives can reference. Returns `{ name, source, configSchema? }` for each.",
    inputSchema: { type: "object", properties: {} },
    handler: () => {
      const components = listMarkdownComponents().map((c) => ({
        name: c.name,
        source: c.source,
        configSchema: c.configSchema,
      }));
      return { components };
    },
  },
];
