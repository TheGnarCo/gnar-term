<script lang="ts">
  /**
   * Workspace Overview Dashboard — landing page for a Workspace.
   * Registered as a hidden surface type (`dashboard:group`) by
   * init-workspaces and mounted via PaneView's normal extension surface
   * render path. The spawn flow seeds `surface.props.rootWorkspaceId`,
   * which we project into a DashboardHostContext so embedded sections
   * (Issues, PRs) and WorkspacesWidget resolve their scope unchanged.
   *
   * Sections (Issues, PRs) live in extensions; we mount them through
   * ExtensionWrapper so the wrapped widget sees the registering
   * extension's API (theme, invoke, workspaces store, etc.).
   */
  import { theme } from "../stores/theme";
  import { workspaces } from "../stores/workspace";
  import { setDashboardHost } from "../contexts/dashboard-host";
  import {
    dashboardSectionStore,
    type DashboardSectionEntry,
  } from "../services/dashboard-section-registry";
  import { getExtensionApiById } from "../services/extension-loader";
  import ExtensionWrapper from "./ExtensionWrapper.svelte";
  import WorkspacesWidget from "./WorkspacesWidget.svelte";

  export let rootWorkspaceId: string | undefined = undefined;

  const hostMetadata: Record<string, unknown> = {
    ...(typeof rootWorkspaceId === "string" ? { rootWorkspaceId } : {}),
  };
  setDashboardHost({ metadata: hostMetadata });

  $: workspace =
    typeof rootWorkspaceId === "string"
      ? $workspaces.find((w) => w.id === rootWorkspaceId)
      : undefined;

  $: issuesSection =
    $dashboardSectionStore.find((s) => s.id === "issues") ?? null;
  $: prsSection = $dashboardSectionStore.find((s) => s.id === "prs") ?? null;

  function sectionApi(section: DashboardSectionEntry) {
    return getExtensionApiById(section.source);
  }
</script>

<div
  data-workspace-overview-body
  data-workspace-id={workspace?.id ?? ""}
  style="
    flex: 1; min-width: 0; min-height: 0; overflow: auto;
    padding: 24px 32px;
    display: flex; flex-direction: column; gap: 20px;
    background: {$theme.bg}; color: {$theme.fg};
  "
>
  {#if workspace}
    <header style="display: flex; flex-direction: column; gap: 4px;">
      <h1 style="margin: 0; font-size: 18px; font-weight: 600;">
        {workspace.name}
      </h1>
      <code
        style="
          color: {$theme.fgDim}; font-size: 12px;
          font-family: monospace;
        ">{workspace.path}</code
      >
    </header>

    <WorkspacesWidget />

    {#if issuesSection || prsSection}
      <div
        data-overview-columns
        style="
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
          gap: 16px;
        "
      >
        {#if issuesSection}
          {@const api = sectionApi(issuesSection)}
          {#if api}
            <ExtensionWrapper
              {api}
              component={issuesSection.component}
              props={{ state: "open", displayOnly: true }}
              host={{ metadata: hostMetadata }}
            />
          {/if}
        {/if}
        {#if prsSection}
          {@const api = sectionApi(prsSection)}
          {#if api}
            <ExtensionWrapper
              {api}
              component={prsSection.component}
              props={{ state: "open" }}
              host={{ metadata: hostMetadata }}
            />
          {/if}
        {/if}
      </div>
    {/if}
  {/if}
</div>
