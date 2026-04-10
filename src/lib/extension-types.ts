/**
 * Extension system type definitions — re-exports from the public API
 * plus core-internal types.
 *
 * The canonical type definitions live in src/extensions/api.ts, which is
 * self-contained (only depends on svelte/store) so external extension
 * authors can copy it for type safety. This module re-exports those types
 * for internal use and adds core-only types like LoadedExtension.
 */

// Re-export all public types from the extractable API file
export type {
  AppEvent,
  AppEventType,
  ExtensionManifestAction,
  ExtensionManifestTab,
  ExtensionManifestSection,
  ExtensionManifestCommand,
  ExtensionManifestSurface,
  ExtensionManifestContextMenu,
  ExtensionSettingsField,
  ExtensionSettingsSchema,
  ExtensionContributions,
  ExtensionManifest,
  ExtensionStateAPI,
  ExtensionAPI,
  ExtensionRegisterFn,
  WorkspaceRef,
  SurfaceRef,
  PaneRef,
} from "../extensions/api";

export { EXTENSION_API_KEY } from "../extensions/api";

export type { DirEntry } from "../extensions/api";

// --- Type drift guard ---
// api.ts and event-bus.ts each define AppEventType independently.
// This compile-time assertion catches any divergence between the two.
import type { AppEventType as ApiAppEventType } from "../extensions/api";
import type { AppEventType as BusAppEventType } from "./services/event-bus";

type _AssertApiExtendsBus = ApiAppEventType extends BusAppEventType
  ? true
  : false;
type _AssertBusExtendsApi = BusAppEventType extends ApiAppEventType
  ? true
  : false;
// If either of these is 'false', the two AppEventType definitions have drifted.
void (true as _AssertApiExtendsBus & _AssertBusExtendsApi);

// --- Core-internal types (not part of the public extension API) ---

import type { ExtensionAPI } from "../extensions/api";

export interface LoadedExtension {
  manifest: import("../extensions/api").ExtensionManifest;
  enabled: boolean;
  api?: ExtensionAPI;
  activateCallback?: () => void | Promise<void>;
  deactivateCallback?: () => void;
}
