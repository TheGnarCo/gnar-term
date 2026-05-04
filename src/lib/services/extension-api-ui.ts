import {
  registerCommand as registryRegisterCommand,
  runCommandById as registryRunCommandById,
} from "./command-registry";
import { registerTitleBarButton as registryRegisterTitleBarButton } from "./titlebar-button-registry";
import { registerSidebarSection } from "./sidebar-section-registry";
import { registerSurfaceType as registryRegisterSurfaceType } from "./surface-type-registry";
import {
  registerContextMenuItem as registryRegisterContextMenuItem,
  validateWhenPattern,
} from "./context-menu-item-registry";
import {
  registerWorkspaceAction as registryRegisterWorkspaceAction,
  unregisterWorkspaceAction as registryUnregisterWorkspaceAction,
  getWorkspaceActions as registryGetWorkspaceActions,
  type WorkspaceActionContext,
} from "./workspace-action-registry";
import { registerDashboardTab as registryRegisterDashboardTab } from "./dashboard-tab-registry";
import { registerWorkspaceSubtitle as registryRegisterWorkspaceSubtitle } from "./workspace-subtitle-registry";
import { registerRootRowRenderer as registryRegisterRootRowRenderer } from "./root-row-renderer-registry";
import {
  appendRootRow as storeAppendRootRow,
  removeRootRow as storeRemoveRootRow,
} from "../stores/root-row-order";
import { registerTheme as registryRegisterTheme } from "./theme-registry";
import { registerMarkdownComponent as registryRegisterMarkdownComponent } from "./markdown-component-registry";
import { registerChildRowContributor } from "./child-row-contributor-registry";
import { registerDashboardContribution as registryRegisterDashboardContribution } from "./dashboard-contribution-registry";
import { registerPseudoWorkspace as registryRegisterPseudoWorkspace } from "./pseudo-workspace-registry";
import {
  registerDashboardWorkspaceType,
  spawnOrNavigate,
} from "./dashboard-workspace-service";
import { registerExtensionMcpTool } from "./mcp-server";
import type {
  DashboardContributionInput,
  PseudoWorkspaceInput,
} from "../../extensions/api";
import type { ThemeDef } from "../theme-data";
import type { ExtensionManifest, ExtensionAPI } from "../extension-types";

/** All register*() methods for UI contributions (sidebar tabs, surfaces, overlays, etc.). */
export function createUIRegistrationAPI(
  extId: string,
  manifest: ExtensionManifest,
): Pick<
  ExtensionAPI,
  | "registerTitleBarButton"
  | "registerSidebarSection"
  | "registerRootRowRenderer"
  | "appendRootRow"
  | "removeRootRow"
  | "registerSurfaceType"
  | "registerDashboardWorkspace"
  | "registerTheme"
  | "registerCommand"
  | "runCommand"
  | "registerContextMenuItem"
  | "registerMcpTool"
  | "registerMarkdownComponent"
  | "registerChildRowContributor"
  | "registerDashboardContribution"
  | "registerPseudoWorkspace"
  | "registerDashboardTab"
  | "registerWorkspaceAction"
  | "unregisterWorkspaceAction"
  | "getWorkspaceActions"
  | "registerWorkspaceSubtitle"
> {
  return {
    registerTitleBarButton(
      buttonId: string,
      options: {
        icon: unknown;
        title: string;
        isActive?: import("svelte/store").Readable<boolean>;
        onClick: () => void;
      },
    ) {
      registryRegisterTitleBarButton({
        id: `${extId}:${buttonId}`,
        source: extId,
        icon: options.icon,
        title: options.title,
        isActive: options.isActive,
        onClick: options.onClick,
      });
    },

    registerSidebarSection(
      sectionId: string,
      component: unknown,
      options?: {
        collapsible?: boolean;
        showLabel?: boolean;
        label?: string;
        props?: Record<string, unknown>;
      },
    ) {
      const declared = manifest.contributes?.sidebarSections?.find(
        (s) => s.id === sectionId,
      );
      const namespacedId = `${extId}:${sectionId}`;
      registerSidebarSection({
        id: namespacedId,
        label: options?.label ?? declared?.label ?? sectionId,
        component,
        source: extId,
        collapsible: options?.collapsible,
        showLabel: options?.showLabel,
        // Inject the host block id so sections that host inner drag-reorder
        // can publish a ReorderContext whose containerBlockId matches the
        // actual namespaced block id rendered by Sidebar.
        props: { ...(options?.props ?? {}), hostBlockId: namespacedId },
      });
    },

    registerSurfaceType(
      surfaceId: string,
      component: unknown,
      options?: { hideFromNewSurface?: boolean },
    ) {
      const declared = manifest.contributes?.surfaces?.find(
        (s) => s.id === surfaceId,
      );
      registryRegisterSurfaceType({
        id: `${extId}:${surfaceId}`,
        label: declared?.label ?? surfaceId,
        component,
        source: extId,
        hideFromNewSurface: options?.hideFromNewSurface,
      });
    },

    registerDashboardWorkspace(
      id: string,
      options: {
        label: string;
        icon: unknown;
        component: unknown;
        accentColor?: string;
      },
    ): () => void {
      const stableId = `${extId}:${id}`;
      registerDashboardWorkspaceType({
        id: stableId,
        label: options.label,
        icon: options.icon as import("svelte").Component,
        component: options.component as import("svelte").Component,
        source: extId,
        accentColor: options.accentColor,
      });
      return () => void spawnOrNavigate(stableId);
    },

    registerTheme(id: string, theme: unknown) {
      // Structural cast — ExtensionTheme is a subset of ThemeDef, so the
      // runtime shapes are compatible. Exposing the type on the public
      // surface as ExtensionTheme avoids tying extension authors to
      // ThemeDef, which lives in core.
      registryRegisterTheme(extId, id, theme as ThemeDef);
    },

    runCommand(commandId: string, args?: unknown): boolean {
      return registryRunCommandById(commandId, args);
    },

    registerCommand(
      commandId: string,
      handler: () => void | Promise<void>,
      options?: { title?: string; shortcut?: string },
    ) {
      const namespacedId = `${extId}:${commandId}`;
      // Look up title from manifest contributions, then options, then commandId.
      // Shortcut falls back to the manifest when runtime options don't provide one.
      const declared = manifest.contributes?.commands?.find(
        (c) => c.id === commandId,
      );
      registryRegisterCommand({
        id: namespacedId,
        title: declared?.title ?? options?.title ?? commandId,
        shortcut: options?.shortcut ?? declared?.shortcut,
        action: handler,
        source: extId,
      });
    },

    registerMcpTool(
      toolName: string,
      options: {
        description: string;
        inputSchema: Record<string, unknown>;
        handler: (args: Record<string, unknown>) => unknown | Promise<unknown>;
      },
    ) {
      registerExtensionMcpTool(
        extId,
        toolName,
        options.description,
        options.inputSchema,
        options.handler,
      );
    },

    registerMarkdownComponent(
      name: string,
      component: unknown,
      options?: { configSchema?: Record<string, unknown> },
    ) {
      // No id-prefix on the component name — markdown directives
      // (`gnar:<name>`) stay short and stable. Source tracking still uses
      // extId for cleanup.
      registryRegisterMarkdownComponent({
        name,
        component,
        source: extId,
        configSchema: options?.configSchema,
      });
    },

    registerChildRowContributor(
      parentType: string,
      contribute: (parentId: string) => Array<{ kind: string; id: string }>,
    ) {
      registerChildRowContributor({
        parentType,
        source: extId,
        contribute,
      });
    },

    registerDashboardContribution(contribution: DashboardContributionInput) {
      registryRegisterDashboardContribution({
        ...contribution,
        source: extId,
      });
    },

    registerPseudoWorkspace(pw: PseudoWorkspaceInput) {
      registryRegisterPseudoWorkspace({
        ...pw,
        source: extId,
      });
    },

    registerContextMenuItem(
      itemId: string,
      handler: (filePath: string) => void,
    ) {
      const declared = manifest.contributes?.contextMenuItems?.find(
        (c) => c.id === itemId,
      );
      if (!declared) {
        throw new Error(
          `[extension:${extId}] Context menu item "${itemId}" is not declared in the manifest. ` +
            `Add it to contributes.contextMenuItems before registering.`,
        );
      }
      const when = declared.when ?? "*";
      const whenError = validateWhenPattern(when);
      if (whenError) {
        throw new Error(
          `[extension:${extId}] Context menu item "${itemId}" has invalid "when": ${whenError}`,
        );
      }
      const namespacedId = `${extId}:${itemId}`;
      registryRegisterContextMenuItem({
        id: namespacedId,
        label: declared.label ?? itemId,
        when,
        handler,
        source: extId,
      });
    },

    registerDashboardTab(
      tabId: string,
      component: unknown,
      options?: { label?: string; props?: Record<string, unknown> },
    ) {
      registryRegisterDashboardTab({
        id: `${extId}:${tabId}`,
        label: options?.label ?? tabId,
        component,
        source: extId,
        props: options?.props,
      });
    },

    registerWorkspaceAction(
      actionId: string,
      options: {
        label: string;
        icon?: string;
        shortcut?: string;
        zone?: "workspace" | "sidebar";
        handler: (ctx: WorkspaceActionContext) => void | Promise<void>;
        when?: (ctx: WorkspaceActionContext) => boolean;
      },
    ) {
      const namespacedId = `${extId}:${actionId}`;
      // Manifest fills in missing runtime metadata — shortcut/zone/icon can
      // be declared once and omitted at the registerWorkspaceAction call.
      const declared = manifest.contributes?.workspaceActions?.find(
        (a) => a.id === actionId,
      );
      registryRegisterWorkspaceAction({
        id: namespacedId,
        label: options.label,
        icon: options.icon ?? declared?.icon ?? "",
        shortcut: options.shortcut ?? declared?.shortcut,
        zone: options.zone ?? declared?.zone,
        source: extId,
        handler: options.handler,
        when: options.when,
      });
    },

    getWorkspaceActions() {
      return registryGetWorkspaceActions().map((a) => ({
        id: a.id,
        label: a.label,
        icon: a.icon,
        shortcut: a.shortcut,
        zone: a.zone,
        handler: a.handler,
        when: a.when,
      }));
    },

    unregisterWorkspaceAction(actionId: string) {
      registryUnregisterWorkspaceAction(`${extId}:${actionId}`);
    },

    registerWorkspaceSubtitle(component: unknown, priority?: number) {
      // Priority falls back to manifest declaration, then to 50.
      const declared = manifest.contributes?.workspaceSubtitle;
      registryRegisterWorkspaceSubtitle({
        id: `${extId}:subtitle`,
        component,
        source: extId,
        priority: priority ?? declared?.priority ?? 50,
      });
    },

    registerRootRowRenderer(
      kind: string,
      component: unknown,
      options?: {
        railColor?: (id: string) => string | undefined;
        label?: (id: string) => string | undefined;
      },
    ) {
      // Contribute a renderer for a non-workspace row kind inside the
      // Workspaces section's unified list. `kind` keys the renderer;
      // the component receives `{ id: string }` as a prop and is
      // responsible for its own drag-hover feedback. Optional
      // resolvers let core paint the rail (railColor) and the drag
      // overlay label (label) per row.
      registryRegisterRootRowRenderer({
        id: kind,
        source: extId,
        component,
        railColor: options?.railColor,
        label: options?.label,
      });
    },

    appendRootRow(row: { kind: string; id: string }) {
      storeAppendRootRow(row);
    },

    removeRootRow(row: { kind: string; id: string }) {
      storeRemoveRootRow(row);
    },
  };
}
