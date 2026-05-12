<script lang="ts">
  // Placeholder body for the Agentic Dashboard.
  // Real panels (Agent Board, Branch Lifecycle, Attention Inbox) land in cycle-3.
</script>

<div class="agentic-dashboard">
  <div class="agentic-dashboard-header"></div>

  <div class="agentic-dashboard-content">
    <section class="agentic-section">
      <h2 class="agentic-section-title">Agent Board</h2>
      <p class="agentic-placeholder">Coming in cycle-3.</p>
    </section>

    <section class="agentic-section">
      <h2 class="agentic-section-title">Branch Lifecycle</h2>
      <p class="agentic-placeholder">Coming in cycle-3.</p>
    </section>

    <section class="agentic-section">
      <h2 class="agentic-section-title">Attention Inbox</h2>
      <p class="agentic-placeholder">Coming in cycle-3.</p>
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

  .agentic-placeholder {
    font-size: 0.75rem;
    opacity: 0.4;
    margin: 0;
  }
</style>
