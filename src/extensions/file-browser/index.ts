/**
 * File Browser — included extension
 *
 * Registers context menu items for files in the active workspace's cwd.
 */
import type { ExtensionManifest, ExtensionAPI } from "../api";

export const fileBrowserManifest: ExtensionManifest = {
  id: "file-browser",
  name: "File Browser",
  version: "0.1.0",
  description: "Browse files in the active workspace directory",
  entry: "./index.ts",
  included: true,
  contributes: {
    contextMenuItems: [
      {
        id: "open-as-preview",
        label: "Open as Preview",
        when: "*.{md,markdown,mdx}",
      },
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
  },
};

export function registerFileBrowserExtension(api: ExtensionAPI): void {
  api.onActivate(() => {
    api.registerContextMenuItem("open-as-preview", (filePath) => {
      api.openPreviewSplit(filePath);
    });

    api.registerContextMenuItem("edit", (filePath) => {
      api.openInEditor(filePath);
    });

    api.registerContextMenuItem("show-in-file-manager", (filePath) => {
      void api.invoke("show_in_file_manager", { path: filePath });
    });

    api.registerContextMenuItem("open-with-default-app", (filePath) => {
      void api.invoke("open_with_default_app", { path: filePath });
    });

    api.registerContextMenuItem("open-as-workspace", (dirPath) => {
      const name = dirPath.split("/").pop() || dirPath;
      api.createNestedWorkspace(name, dirPath);
    });
  });
}
