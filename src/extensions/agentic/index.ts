import type { ExtensionAPI } from "../api";

export { agenticManifest } from "./manifest";

export function registerAgenticExtension(api: ExtensionAPI): void {
  api.onActivate(() => {
    // Real registrations land in later cycles. This shell exists so
    // INCLUDED_EXTENSIONS can wire the manifest and the extension
    // can be enabled in user config without errors.
  });

  api.onDeactivate(() => {
    // Mirror onActivate teardown surface. Empty until cycle-2.
  });
}
