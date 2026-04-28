// Shared types for the MCP server and its tool modules.

/** Partial binding that accumulates over the connection lifecycle.
 *  `paneId` and `workspaceId` are set on the initial connection bind.
 *  `clientPid` arrives separately via the identify/pid event.
 *  Individual fields are `null` until their respective events fire. */
export interface ConnectionBinding {
  paneId: string | null;
  workspaceId: string | null;
  clientPid: number | null;
}

export interface ConnectionContext {
  connectionId: number;
  binding: ConnectionBinding | null;
  /** Most-recent pane this connection spawned into. Used as the split host for
   *  the *next* spawn so rapid-fire `dispatch_tasks` produces a shallow
   *  right-chain instead of an N-deep left spine around the binding pane —
   *  the latter exploded `findParentSplit` + DOM render cost into O(N²). */
  lastSpawnedPaneId: string | null;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (
    args: Record<string, unknown>,
    ctx: ConnectionContext,
  ) => Promise<unknown> | unknown;
  /** Extension id that contributed this tool; undefined for core tools. */
  source?: string;
}
