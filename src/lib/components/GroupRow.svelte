<script lang="ts">
  /**
   * GroupRow — thin pass-through to WorkspaceGroup for one anchor row in
   * the WorkspaceList. Renamed from dev's WorkspaceRowBody (which was a
   * registry indirection for extension renderers). The stack-top drops
   * the extension renderer indirection and renders WorkspaceGroup
   * directly, so this is a one-component shim kept for naming symmetry
   * and so the renderer can swap a row body without touching the list.
   */
  import type { Workspace } from "../types";
  import WorkspaceGroup from "./WorkspaceGroup.svelte";

  export let anchor: Workspace;
  export let onGripMouseDown: ((e: MouseEvent) => void) | undefined = undefined;
  export let popoverActive: boolean = false;

  let groupEl: WorkspaceGroup;

  /** Forward an inline-rename request to the wrapped WorkspaceGroup. */
  export function startRename() {
    groupEl?.startRename?.();
  }
</script>

<WorkspaceGroup bind:this={groupEl} {anchor} {onGripMouseDown} {popoverActive} />
