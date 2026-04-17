import { registerCommand as registryRegisterCommand } from "./command-registry";
import {
  registerSidebarTab,
  registerSidebarAction,
} from "./sidebar-tab-registry";
import { registerSidebarSection } from "./sidebar-section-registry";
import { registerSurfaceType as registryRegisterSurfaceType } from "./surface-type-registry";
import {
  registerContextMenuItem as registryRegisterContextMenuItem,
  validateWhenPattern,
} from "./context-menu-item-registry";
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
  };
}
