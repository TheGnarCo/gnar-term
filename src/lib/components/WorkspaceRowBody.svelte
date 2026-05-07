<script lang="ts">
  /**
   * WorkspaceRowBody — root-row renderer registered under the
   * "workspace" kind (see `bootstrap/init-workspaces.ts`).
   * Thin pass-through to WorkspaceSectionContent — the shared
   * <ContainerRow> primitive (mounted inside the section content) owns
   * the grip + banner + nested-list chrome. This component exists as
   * the registry entry point and to forward the grip handle.
   *
   * The registry invokes the component with `{ id, onGripMouseDown }`.
   */
  import WorkspaceSectionContent from "./WorkspaceSectionContent.svelte";

  export let id: string;
  /** Forwarded to ContainerRow via WorkspaceSectionContent. */
  export let onGripMouseDown: (e: MouseEvent) => void = () => {};
  /** Position among workspace-kind rows only, for Cmd+N shortcut label. */
  export let shortcutIdx: number | undefined = undefined;
  /**
   * True while this root row's collapsed-mode popover/banner is open.
   * Forwarded down so the rail stays full-width while the banner shows.
   */
  export let popoverActive: boolean = false;
</script>

<WorkspaceSectionContent
  rootWorkspaceId={id}
  containerBlockId="__workspaces__"
  overlay={null}
  {onGripMouseDown}
  {shortcutIdx}
  {popoverActive}
/>
