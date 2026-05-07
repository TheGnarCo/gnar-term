/**
 * Extension context — allows ExtensionWrapper to set the ExtensionAPI
 * on the Svelte component context. Extension components retrieve it via:
 *
 *   import { getContext } from "svelte";
 *   import { EXTENSION_API_KEY, type ExtensionAPI } from "../api";
 *   const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
 */
import { setContext } from "svelte";
import type { ExtensionAPI } from "./extension-types";
import { EXTENSION_API_KEY } from "./extension-types";

export function setExtensionAPI(api: ExtensionAPI): void {
  setContext(EXTENSION_API_KEY, api);
}
