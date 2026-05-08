<script lang="ts">
  /**
   * Workspace Overview Dashboard — landing page for a Workspace.
   * Mounted by PaneView via dashboardWorkspaceRegistry under the "group"
   * contribution id (OVERVIEW_DASHBOARD_CONTRIBUTION_ID). PaneView passes
   * the dashboard workspace's metadata as DashboardHostContext, so
   * `WorkspacesWidget` and any registered sections (Issues, PRs)
   * resolve their workspace scope from that context.
   *
   * Sections (Issues, PRs) live in extensions; we mount them through
   * ExtensionWrapper so the wrapped widget sees the registering
   * extension's API (theme, invoke, workspaces store, etc.).
   */
  import { theme } from "../stores/theme";
  import { workspaces } from "../stores/workspace";
  import { getDashboardHost } from "../contexts/dashboard-host";
  import {
    dashboardSectionStore,
    type DashboardSectionEntry,
  } from "../services/dashboard-section-registry";
  import { getExtensionApiById } from "../services/extension-loader";
  import ExtensionWrapper from "./ExtensionWrapper.svelte";
  import WorkspacesWidget from "./WorkspacesWidget.svelte";

  const host = getDashboardHost();

  $: rootWorkspaceId =
    typeof host?.metadata.rootWorkspaceId === "string"
      ? host.metadata.rootWorkspaceId
      : null;

  $: workspace = rootWorkspaceId
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
              host={{ metadata: host?.metadata ?? {} }}
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
              host={{ metadata: host?.metadata ?? {} }}
            />
          {/if}
        {/if}
      </div>
    {/if}
  {/if}
</div>
