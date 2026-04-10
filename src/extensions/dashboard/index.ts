/**
 * Dashboard — included extension
 *
 * Registers the dashboard surface type and "Open Dashboard" command.
 * Dashboards display a configurable 2x2 grid of zones, each of which
 * can mount content from the sidebar tab or section registries.
 */
import type {
  ExtensionManifest,
  ExtensionAPI,
} from "../../lib/extension-types";
import DashboardSurface from "./DashboardSurface.svelte";

export const dashboardManifest: ExtensionManifest = {
  id: "dashboard",
  name: "Dashboard",
  version: "0.1.0",
  description: "Configurable zone-based dashboard surfaces",
  entry: "./index.ts",
  included: true,
  contributes: {
    surfaces: [{ id: "dashboard", label: "Dashboard" }],
    commands: [{ id: "open-dashboard", title: "Open Dashboard" }],
  },
};

export function registerDashboardExtension(api: ExtensionAPI): void {
  api.onActivate(() => {
    api.registerSurfaceType("dashboard", DashboardSurface);

    api.registerCommand("open-dashboard", () => {
      api.openSurface("dashboard:dashboard", "Dashboard");
    });
  });
}
