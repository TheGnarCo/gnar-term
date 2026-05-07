/**
 * Dashboard Tab Registry — store-based tab registration for dashboard overlays.
 *
 * Extensions register tabs that appear in dashboard overlay views.
 * Built-in tabs are rendered by the dashboard component itself;
 * this registry is for extension-contributed tabs.
 */
import { createRegistry } from "./create-registry";

export interface DashboardTab {
  id: string;
  label: string;
  component: unknown; // Svelte component
  source: string; // extension id
  props?: Record<string, unknown>;
}

const registry = createRegistry<DashboardTab>();

export const dashboardTabStore = registry.store;
export const registerDashboardTab = registry.register;
export const unregisterDashboardTabsBySource = registry.unregisterBySource;
export const resetDashboardTabs = registry.reset;
