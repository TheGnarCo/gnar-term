# Wave 2 Shared Contracts

Contracts between S4 (Navigation) and S5 (Agent Orchestration) for parallel execution.

## findNextWaitingAgent — S5 provides, S4 consumes

S5 implements and exports this function from `src/lib/agent-utils.ts`.
S4 imports it in `keybindings.ts` to wire the "Jump to Waiting Agent" shortcut.

```typescript
// src/lib/agent-utils.ts

import type { Workspace } from "./types";

/**
 * Find the first harness surface with status "waiting" across all workspaces.
 * Returns the workspace ID and surface ID, or null if none are waiting.
 * Scans workspaces in order, surfaces in order within each workspace.
 */
export function findNextWaitingAgent(
  workspaces: Workspace[],
): { workspaceId: string; surfaceId: string } | null;
```

### S4 usage (keybindings.ts)

```typescript
import { findNextWaitingAgent } from "../agent-utils";

// In the keybinding handler for "Jump to Waiting Agent":
const target = findNextWaitingAgent(get(workspaces));
if (target) {
  // Switch to target.workspaceId, then focus target.surfaceId
}
```

**If S4 merges before S5:** S4 should add the keybinding handler that calls
`findNextWaitingAgent`. The function will exist as a stub (returns null) until
S5's branch is merged. This is safe because the keybinding is new and has no
existing behavior to break.

**If S5 merges before S4:** S5 provides the real implementation. S4 adds the
keybinding handler that calls it. No conflict.

## Command Palette Harness Entries — S4 provides, S5 informs

S4 owns `App.svelte` (command palette). S4 adds these entries:

- "New Harness" — creates a harness surface with default preset
- "New Harness: {presetName}" — one entry per preset in `getSettings().harnesses`
- "Jump to Waiting Agent" — calls `findNextWaitingAgent()` (see above)

S5 does NOT modify App.svelte or the command palette. All palette entries
are S4's responsibility.

## Status Color Contract

S5 changes `statusColor()` in `agent-utils.ts`. Both S4 and S5 consume this
function, but only S5 modifies it. S4 uses the existing function signature
unchanged:

```typescript
export function statusColor(status: AgentStatus, theme: ThemeColors): string;
```

No signature change. S5 only changes the internal color mapping.
