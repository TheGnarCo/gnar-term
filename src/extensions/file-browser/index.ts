/**
 * File Browser — included extension
 *
 * Registers a secondary sidebar tab showing files in the active workspace's cwd.
 * Clicking a file opens it in preview.
 */
import type {
  ExtensionManifest,
  ExtensionAPI,
} from "../../lib/extension-types";
import FileBrowser from "./FileBrowser.svelte";

export const fileBrowserManifest: ExtensionManifest = {
  id: "file-browser",
  name: "File Browser",
  version: "0.1.0",
  description: "Browse files in the active workspace directory",
  entry: "./index.ts",
  included: true,
  contributes: {
    secondarySidebarTabs: [{ id: "files", label: "Files", icon: "folder" }],
    commands: [{ id: "toggle-file-browser", title: "Toggle File Browser" }],
    contextMenuItems: [
      { id: "edit", label: "Edit", when: "*" },
      { id: "show-in-file-manager", label: "Show in File Manager", when: "*" },
      {
        id: "open-with-default-app",
        label: "Open with Default App",
        when: "*",
      },
      {
        id: "open-as-workspace",
        label: "Open as Workspace",
        when: "directory",
      },
    ],
    events: ["workspace:activated", "workspace:created"],
  },
};

export function registerFileBrowserExtension(api: ExtensionAPI): void {
  api.onActivate(() => {
    api.registerSecondarySidebarTab("files", FileBrowser);

    api.registerCommand("toggle-file-browser", () => {
      api.toggleSecondarySidebar();
    });

    api.registerContextMenuItem("edit", (filePath) => {
      api.openInEditor(filePath);
    });

    api.registerContextMenuItem("show-in-file-manager", (filePath) => {
      api.invoke("show_in_file_manager", { path: filePath });
    });

    api.registerContextMenuItem("open-with-default-app", (filePath) => {
      api.invoke("open_with_default_app", { path: filePath });
    });

    api.registerContextMenuItem("open-as-workspace", (dirPath) => {
      const name = dirPath.split("/").pop() || dirPath;
      api.createWorkspace(name, dirPath);
    });
  });
}
