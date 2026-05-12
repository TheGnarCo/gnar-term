<script lang="ts">
  // Agentic Dashboard body — renders the three live panels.
  // Each panel reads the ExtensionAPI via Svelte context (EXTENSION_API_KEY),
  // which is set by the ExtensionWrapper host before mounting this component.
  // No prop threading is needed; context is inherited by all descendants.
  import AgentBoard from "./panels/AgentBoard.svelte";
  import BranchLifecycleSwimlanes from "./panels/BranchLifecycleSwimlanes.svelte";
  import AttentionInbox from "./panels/AttentionInbox.svelte";
</script>

<div class="agentic-dashboard">
  <!-- Header strip: cycle-4 fills this in -->
  <div class="agentic-dashboard-header"></div>

  <div class="agentic-dashboard-content">
    <section class="agentic-section">
      <h2 class="agentic-section-title">Agent Board</h2>
      <AgentBoard />
    </section>

    <section class="agentic-section">
      <h2 class="agentic-section-title">Branch Lifecycle</h2>
      <BranchLifecycleSwimlanes />
    </section>

    <section class="agentic-section">
      <h2 class="agentic-section-title">Attention Inbox</h2>
      <AttentionInbox />
    </section>
  </div>
</div>

<style>
  .agentic-dashboard {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .agentic-dashboard-header {
    flex-shrink: 0;
    height: 2rem;
  }

  .agentic-dashboard-content {
    flex: 1;
    overflow-y: auto;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .agentic-section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .agentic-section-title {
    font-size: 0.875rem;
    font-weight: 600;
    opacity: 0.7;
    margin: 0;
  }
</style>
