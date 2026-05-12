<script lang="ts">
  // DashboardHeader — top action strip for the agentic dashboard.
  // API is provided via Svelte context (EXTENSION_API_KEY), set by ExtensionWrapper.
  import { getContext } from "svelte";
  import { EXTENSION_API_KEY, type ExtensionAPI } from "../../api";
  import { openSpawnBranchFlow } from "./spawn-branch-flow";
  import { openBotTaskFlow } from "./bot-task-flow";
  import { openPresetLibrary } from "./preset-library";

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
</script>

<div class="dashboard-header">
  <button
    class="header-btn"
    data-header-btn="new-branch"
    onclick={() => {
      void openSpawnBranchFlow(api);
    }}
  >
    + New agentic branch
  </button>
  <button
    class="header-btn primary"
    data-header-btn="new-bot-task"
    onclick={() => {
      void openBotTaskFlow(api);
    }}
  >
    <svg
      class="bot-icon"
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M12 8V4H8" />
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      <path d="M15 13v2" />
      <path d="M9 13v2" />
    </svg>
    New Bot Task
  </button>
  <button
    class="header-btn"
    data-header-btn="preset-library"
    onclick={() => {
      void openPresetLibrary(api);
    }}
  >
    AgentPreset library
  </button>
</div>

<style>
  .dashboard-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.375rem 0.75rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    flex-shrink: 0;
  }

  .header-btn {
    font-size: 0.75rem;
    padding: 0.25rem 0.6rem;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: transparent;
    color: inherit;
    cursor: pointer;
    opacity: 0.8;
    transition:
      opacity 0.15s,
      background 0.15s;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }

  .bot-icon {
    flex-shrink: 0;
  }

  .header-btn:hover {
    opacity: 1;
    background: rgba(255, 255, 255, 0.08);
  }

  .header-btn.primary {
    border-color: rgba(99, 102, 241, 0.5);
    color: #a5b4fc;
  }

  .header-btn.primary:hover {
    background: rgba(99, 102, 241, 0.15);
  }
</style>
