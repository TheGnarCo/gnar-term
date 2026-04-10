/**
 * Typed event bus for GnarTerm lifecycle events.
 *
 * Services emit events after state mutations. Extensions and components
 * subscribe via on()/off(). A Svelte store adapter is available for
 * reactive subscriptions in components.
 */
// --- Event types ---

export type AppEvent =
  | { type: "workspace:created"; id: string; name: string }
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
  | { type: "theme:changed"; id: string; previousId: string };

export type AppEventType = AppEvent["type"];

/** Extension-defined custom events use the "extension:" prefix */
export interface ExtensionEvent {
  type: string;
  [key: string]: unknown;
}

// Extract the payload for a specific event type
type EventPayload<T extends AppEventType> = Extract<AppEvent, { type: T }>;

// --- Event bus ---

type Handler<T extends AppEventType = AppEventType> = (
  event: EventPayload<T>,
) => void;

class EventBus {
  private handlers = new Map<string, Set<Handler<AppEventType>>>();
  on<T extends AppEventType>(type: T, handler: Handler<T>): void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler as unknown as Handler<AppEventType>);
  }

  off<T extends AppEventType>(type: T, handler: Handler<T>): void {
    this.handlers
      .get(type)
      ?.delete(handler as unknown as Handler<AppEventType>);
  }

  emit(event: AppEvent | ExtensionEvent): void {
    const handlers = this.handlers.get(event.type);
    if (handlers) {
      for (const handler of handlers) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (handler as (e: any) => void)(event);
        } catch (err) {
          console.error(`[event-bus] Error in handler for ${event.type}:`, err);
        }
      }
    }
  }

  /** Subscribe to extension-defined custom events (extension:* namespace) */
  onExtension(type: string, handler: (event: ExtensionEvent) => void): void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler as unknown as Handler<AppEventType>);
  }

  /** Unsubscribe from extension-defined custom events */
  offExtension(type: string, handler: (event: ExtensionEvent) => void): void {
    this.handlers
      .get(type)
      ?.delete(handler as unknown as Handler<AppEventType>);
  }

  /** Emit an extension-defined custom event */
  emitExtension(event: ExtensionEvent): void {
    this.emit(event as unknown as AppEvent);
  }
}

export const eventBus = new EventBus();
