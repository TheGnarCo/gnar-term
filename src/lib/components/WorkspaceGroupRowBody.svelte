<script lang="ts">
  /**
   * WorkspaceGroupRowBody — root-row renderer registered under the
   * "workspace-group" kind (see `bootstrap/init-workspace-groups.ts`).
   * Thin pass-through to WorkspaceGroupSectionContent — the shared
   * <ContainerRow> primitive (mounted inside the section content) owns
   * the grip + banner + nested-list chrome. This component exists as
   * the registry entry point and to forward the grip handle.
   *
   * The registry invokes the component with `{ id, onGripMouseDown }`.
   */
  import WorkspaceGroupSectionContent from "./WorkspaceGroupSectionContent.svelte";

  export let id: string;
  /** Forwarded to ContainerRow via WorkspaceGroupSectionContent. */
  export let onGripMouseDown: (e: MouseEvent) => void = () => {};
</script>

<WorkspaceGroupSectionContent
  groupId={id}
  containerBlockId="__workspaces__"
  overlay={null}
  {onGripMouseDown}
/>
