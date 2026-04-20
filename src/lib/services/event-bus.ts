/**
 * Typed event bus for GnarTerm lifecycle events.
 *
 * Services emit events after state mutations. Extensions and components
 * subscribe via on()/off(). A Svelte store adapter is available for
 * reactive subscriptions in components.
 */
// --- Event types ---

export type AppEvent =
  | {
      type: "workspace:created";
      id: string;
      name: string;
      metadata?: Record<string, unknown>;
    }
  | { type: "workspace:activated"; id: string; previousId: string | null }
  | { type: "workspace:closed"; id: string }
  | { type: "workspace:renamed"; id: string; oldName: string; newName: string }
  | {
      type: "pane:split";
      parentPaneId: string;
      newPaneId: string;
      direction: "horizontal" | "vertical";
    }
  | { type: "pane:closed"; id: string; workspaceId: string }
  | { type: "pane:focused"; id: string; previousId: string | null }
  | { type: "surface:created"; id: string; paneId: string; kind: string }
  | { type: "surface:activated"; id: string; paneId: string }
  | { type: "surface:closed"; id: string; paneId: string }
  | {
      type: "surface:titleChanged";
      id: string;
      oldTitle: string;
      newTitle: string;
    }
  | {
      type: "sidebar:toggled";
      which: "primary" | "secondary";
      visible: boolean;
    }
  | { type: "theme:changed"; id: string; previousId: string }
  | {
      type: "worktree:merged";
      worktreePath: string;
      branch: string;
      baseBranch: string;
      repoPath: string;
      workspaceId: string;
    }
  | {
      // Emitted by agent-detection-service whenever a detected agent
      // transitions state. `status` is one of running | waiting | idle |
      // active | closed (closed fires once as the agent detaches).
      // `workspaceId` may be an empty string when the surface couldn't
      // be resolved to a workspace.
      type: "agent:statusChanged";
      status: string;
      surfaceId: string;
      workspaceId: string;
      agentName: string;
    };

export type AppEventType = AppEvent["type"];

/** Extension-defined custom events use the "extension:" prefix */
export interface ExtensionEvent {
  type: string;
  [key: string]: unknown;
}

// Extract the payload for a specific event type
type EventPayload<T extends AppEventType> = Extract<AppEvent, { type: T }>;

// --- Event bus ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHandler = (event: any) => void;

class EventBus {
  private handlers = new Map<string, Set<AnyHandler>>();

  on<T extends AppEventType>(
    type: T,
    handler: (event: EventPayload<T>) => void,
  ): void;
  on(type: string, handler: (event: ExtensionEvent) => void): void;
  on(type: string, handler: AnyHandler): void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);
  }

  off<T extends AppEventType>(
    type: T,
    handler: (event: EventPayload<T>) => void,
  ): void;
  off(type: string, handler: (event: ExtensionEvent) => void): void;
  off(type: string, handler: AnyHandler): void {
    this.handlers.get(type)?.delete(handler);
  }

  emit(event: AppEvent | ExtensionEvent): void {
    const handlers = this.handlers.get(event.type);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(event);
        } catch (err) {
          console.error(`[event-bus] Error in handler for ${event.type}:`, err);
        }
      }
    }
  }
}

export const eventBus = new EventBus();
