/**
 * SSH surface type registration — registers the "ssh" surface type with
 * the core surface-type-registry so PaneView can look up the component
 * for SSH surfaces by id.
 *
 * Called from initWorkspaces (bootstrap) alongside other core surface
 * type registrations.
 */
import { registerSurfaceType } from "../services/surface-type-registry";
import SshSurface from "./SshSurface.svelte";

export function registerSshSurfaceType(): void {
  registerSurfaceType({
    id: "ssh",
    label: "SSH",
    component: SshSurface,
    source: "core",
  });
}
