/**
 * Registers the shared `"core"` ExtensionAPI with the extension
 * loader. Core subsystems (Workspaces, preview pipeline, etc.) live
 * outside the extension layer, but their UI contributions still flow
 * through the extension-facing registries (root-row renderers,
 * markdown components, etc.) so a single code path handles mounting
 * regardless of origin — they stamp their origin as `"core"` rather
 * than a per-subsystem id.
 *
 * `ExtensionWrapper` looks up the source's `ExtensionAPI` via
 * `getExtensionApiById` so children inside the wrapper (e.g.
 * `PathStatusLine` reading `api.theme`, `api.invoke`) find one.
 * Register a single synthetic API under the id `"core"` so every
 * core-owned contribution shares it.
 */
import type { ExtensionManifest } from "../extension-types";
import { registerCoreExtensionAPI } from "../services/extension-loader";

const CORE_MANIFEST: ExtensionManifest = {
  id: "core",
  name: "gnar-term core",
  version: "0.0.0-core",
  description:
    "Built-in core subsystems (Workspaces, preview, etc.). Not a real extension — registered so UI contributions keyed under source='core' resolve to an ExtensionAPI.",
  entry: "core://gnar-term",
  included: true,
  permissions: [],
};

let _registered = false;

export function initCoreExtensionAPI(): void {
  if (_registered) return;
  _registered = true;
  registerCoreExtensionAPI(CORE_MANIFEST);
}
