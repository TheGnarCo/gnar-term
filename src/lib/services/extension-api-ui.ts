import { registerCommand as registryRegisterCommand } from "./command-registry";
import {
  registerSidebarTab,
  registerSidebarAction,
} from "./sidebar-tab-registry";
import { registerSidebarSection } from "./sidebar-section-registry";
import { registerSurfaceType as registryRegisterSurfaceType } from "./surface-type-registry";
import { registerContextMenuItem as registryRegisterContextMenuItem } from "./context-menu-item-registry";
import {
  registerWorkspaceAction as registryRegisterWorkspaceAction,
  getWorkspaceActions as registryGetWorkspaceActions,
  type WorkspaceActionContext,
} from "./workspace-action-registry";
import { registerDashboardTab as registryRegisterDashboardTab } from "./dashboard-tab-registry";
import {
  registerOverlay as registryRegisterOverlay,
  unregisterOverlay as registryUnregisterOverlay,
} from "./overlay-registry";
import { registerWorkspaceSubtitle as registryRegisterWorkspaceSubtitle } from "./workspace-subtitle-registry";
import {
  registerAgentLauncher as registryRegisterAgentLauncher,
  unregisterAgentLaunchersBySource as registryUnregisterAgentLaunchersBySource,
} from "./agent-launcher-registry";
import type { ExtensionManifest, ExtensionAPI } from "../extension-types";

/** All register*() methods for UI contributions (sidebar tabs, surfaces, overlays, etc.). */
export function createUIRegistrationAPI(
  extId: string,
  manifest: ExtensionManifest,
): Pick<
  ExtensionAPI,
  | "registerSecondarySidebarTab"
  | "registerSecondarySidebarAction"
  | "registerPrimarySidebarSection"
  | "registerSurfaceType"
  | "registerAgentLauncher"
  | "unregisterAgentLaunchers"
  | "registerOverlay"
  | "unregisterOverlay"
  | "registerCommand"
  | "registerContextMenuItem"
  | "registerDashboardTab"
  | "registerWorkspaceAction"
  | "getWorkspaceActions"
  | "registerWorkspaceSubtitle"
> {
  return {
    registerSecondarySidebarTab(tabId: string, component: unknown) {
      const declared = manifest.contributes?.secondarySidebarTabs?.find(
        (t) => t.id === tabId,
      );
      registerSidebarTab({
        id: `${extId}:${tabId}`,
        label: declared?.label ?? tabId,
        icon: declared?.icon,
        component,
        source: extId,
      });
    },

    registerSecondarySidebarAction(
      tabId: string,
      actionId: string,
      handler: () => void,
    ) {
      const declaredTab = manifest.contributes?.secondarySidebarTabs?.find(
        (t) => t.id === tabId,
      );
      const declaredAction = declaredTab?.actions?.find(
        (a) => a.id === actionId,
      );
      registerSidebarAction({
        tabId: `${extId}:${tabId}`,
        actionId,
        title: declaredAction?.title,
        handler,
        source: extId,
      });
    },

    registerPrimarySidebarSection(
      sectionId: string,
      component: unknown,
      options?: {
        collapsible?: boolean;
        showLabel?: boolean;
        label?: string;
        props?: Record<string, unknown>;
      },
    ) {
      const declared = manifest.contributes?.primarySidebarSections?.find(
        (s) => s.id === sectionId,
      );
      registerSidebarSection({
        id: `${extId}:${sectionId}`,
        label: options?.label ?? declared?.label ?? sectionId,
        component,
        source: extId,
        collapsible: options?.collapsible,
        showLabel: options?.showLabel,
        props: options?.props,
      });
    },

    registerSurfaceType(surfaceId: string, component: unknown) {
      const declared = manifest.contributes?.surfaces?.find(
        (s) => s.id === surfaceId,
      );
      registryRegisterSurfaceType({
        id: `${extId}:${surfaceId}`,
        label: declared?.label ?? surfaceId,
        component,
        source: extId,
      });
    },

    registerAgentLauncher(id: string, label: string, command: string) {
      registryRegisterAgentLauncher({
        id: `${extId}:${id}`,
        label,
        command,
        source: extId,
      });
    },

    unregisterAgentLaunchers() {
      registryUnregisterAgentLaunchersBySource(extId);
    },

    registerOverlay(
      overlayId: string,
      component: unknown,
      props?: Record<string, unknown>,
    ) {
      registryRegisterOverlay({
        id: `${extId}:${overlayId}`,
        component,
        source: extId,
        props,
      });
    },

    unregisterOverlay(overlayId: string) {
      registryUnregisterOverlay(`${extId}:${overlayId}`);
    },

    registerCommand(
      commandId: string,
      handler: () => void | Promise<void>,
      options?: { title?: string },
    ) {
      const namespacedId = `${extId}:${commandId}`;
      // Look up title from manifest contributions, then options, then commandId
      const declared = manifest.contributes?.commands?.find(
        (c) => c.id === commandId,
      );
      registryRegisterCommand({
        id: namespacedId,
        title: declared?.title ?? options?.title ?? commandId,
        action: handler,
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
      const namespacedId = `${extId}:${itemId}`;
      registryRegisterContextMenuItem({
        id: namespacedId,
        label: declared.label ?? itemId,
        when: declared.when ?? "*",
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
        icon: string;
        shortcut?: string;
        zone?: "workspace" | "sidebar";
        handler: (ctx: WorkspaceActionContext) => void | Promise<void>;
        when?: (ctx: WorkspaceActionContext) => boolean;
      },
    ) {
      const namespacedId = `${extId}:${actionId}`;
      registryRegisterWorkspaceAction({
        id: namespacedId,
        label: options.label,
        icon: options.icon,
        shortcut: options.shortcut,
        zone: options.zone,
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

    registerWorkspaceSubtitle(component: unknown, priority?: number) {
      registryRegisterWorkspaceSubtitle({
        id: `${extId}:subtitle`,
        component,
        source: extId,
        priority: priority ?? 50,
      });
    },
  };
}
