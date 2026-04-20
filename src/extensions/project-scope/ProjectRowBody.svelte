<script lang="ts">
  /**
   * ProjectRowBody — root-row renderer registered under the "project"
   * kind. Thin pass-through to ProjectSectionContent — the shared
   * <ContainerRow> primitive (mounted inside ProjectSectionContent)
   * owns the grip + banner + nested-list chrome. This component exists
   * as the registry entry point and to forward the grip handle.
   *
   * Registered via `api.registerRootRowRenderer("project", ...)`.
   * The registry invokes the component with `{ id, onGripMouseDown }`.
   */
  import ProjectSectionContent from "./ProjectSectionContent.svelte";

  export let id: string;
  /** Forwarded to ContainerRow via ProjectSectionContent. */
  export let onGripMouseDown: (e: MouseEvent) => void = () => {};
</script>

<ProjectSectionContent
  projectId={id}
  containerBlockId="__workspaces__"
  overlay={null}
  {onGripMouseDown}
/>
