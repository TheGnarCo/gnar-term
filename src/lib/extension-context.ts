/**
 * Extension context — allows extension Svelte components to access their
 * ExtensionAPI via getContext() instead of importing core internals.
 *
 * Usage in extension components:
 *   import { getExtensionAPI } from "../../lib/extension-context";
 *   const api = getExtensionAPI();
 */
import { getContext, setContext } from "svelte";
import type { ExtensionAPI } from "./extension-types";
import { EXTENSION_API_KEY } from "./extension-types";

export function setExtensionAPI(api: ExtensionAPI): void {
  setContext(EXTENSION_API_KEY, api);
}

export function getExtensionAPI(): ExtensionAPI {
  return getContext<ExtensionAPI>(EXTENSION_API_KEY);
}
