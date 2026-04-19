/**
 * Shared drag-to-reorder logic for sidebar lists.
 *
 * Creates mouse-driven drag state (HTML5 DnD is broken in Tauri WKWebView).
 * Each instance tracks its own ghost element, insert indicator, and drag state.
 * The caller provides: a data attribute selector, ghost styling, and an onDrop callback.
 */

export interface DragReorderConfig {
  /** The data attribute used on draggable items, e.g. "drag-idx" → `[data-drag-idx]` */
  dataAttr: string;
  /** Container selector for keeping the indicator alive when inside the sidebar */
  containerSelector: string;
  /** Return ghost element background/border colors */
  ghostStyle: () => {
    background: string;
    border: string;
  };
  /** Called when a valid drop occurs */
  onDrop: (fromIdx: number, toIdx: number) => void;
  /** Optional precondition — if provided, must return true for drag to start */
  canStart?: () => boolean;
  /**
   * Optional callback fired on every state transition (start, move, drop,
   * cancel). Svelte consumers use this to re-read `getState()` and mirror
   * into reactive state — without it, Escape-to-cancel would leave the UI
   * stuck until the next mouse event.
   */
  onStateChange?: () => void;
}

export interface DragReorderState {
  sourceIdx: number | null;
  indicator: { idx: number; edge: "before" | "after" } | null;
  active: boolean;
  /** Height of the source element at drag start, in pixels. Consumers
   *  use this to render a ghost placeholder matching the source size
   *  at the drop target — so the drag preview matches the drop result. */
  sourceHeight: number;
}

export interface DragReorderHandle {
  /** Call from mousedown on a draggable item */
  start: (e: MouseEvent, idx: number) => void;
  /** Reactive state — read these to render indicators and opacity */
  getState: () => DragReorderState;
}

export function createDragReorder(
  config: DragReorderConfig,
): DragReorderHandle {
  const selector = `[data-${config.dataAttr}]`;
  const dataKey = config.dataAttr.replace(/-([a-z])/g, (_, c) =>
    c.toUpperCase(),
  );

  let sourceIdx: number | null = null;
  let indicator: { idx: number; edge: "before" | "after" } | null = null;
  let active = false;
  let sourceHeight = 0;
  let ghostEl: HTMLElement | null = null;
  /** The specific container element the drag started in. Captured at
   *  drag-start and used to scope querySelectorAll during move so a
   *  drag in one .workspace-list-view never picks up items from
   *  another. */
  let sourceContainer: HTMLElement | null = null;

  function onDragMove(e: MouseEvent) {
    if (sourceIdx === null) return;
    if (ghostEl) {
      ghostEl.style.left = e.clientX + 8 + "px";
      ghostEl.style.top = e.clientY - 12 + "px";
    }
    const prev = indicator;

    // Gather visible items in THIS drop zone, scoped to the specific
    // container the drag started in. Using the source's captured
    // container (not a global querySelector) keeps nested workspace
    // lists from leaking into one another — a drag in project A's
    // list never picks up items from project B's.
    const items = sourceContainer
      ? Array.from(
          sourceContainer.querySelectorAll<HTMLElement>(selector),
        ).filter((el) => {
          const r = el.getBoundingClientRect();
          return r.height > 0 && r.width > 0;
        })
      : [];

    if (items.length > 0) {
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const firstRect = first.getBoundingClientRect();
      const lastRect = last.getBoundingClientRect();
      const firstIdx = parseInt(first.dataset[dataKey]!, 10);
      const lastIdx = parseInt(last.dataset[dataKey]!, 10);

      if (e.clientY < firstRect.top) {
        // Cursor is ABOVE the drop zone — park at the top slot. Stays
        // there until the cursor comes back into the list.
        indicator = { idx: firstIdx, edge: "before" };
      } else if (e.clientY > lastRect.bottom) {
        // Cursor is BELOW the drop zone — park at the bottom slot.
        indicator = { idx: lastIdx, edge: "after" };
      } else {
        // Cursor is vertically inside the drop zone. Resolve to a
        // specific item's before/after edge when possible; otherwise
        // keep the last indicator (handles gaps between rows).
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const item = el
          ? ((el as HTMLElement).closest(selector) as HTMLElement | null)
          : null;
        if (item) {
          const targetIdx = parseInt(item.dataset[dataKey]!, 10);
          const rect = item.getBoundingClientRect();
          const edge: "before" | "after" =
            e.clientY - rect.top < rect.height / 2 ? "before" : "after";
          indicator = { idx: targetIdx, edge };
        }
      }
    }

    if (prev?.idx !== indicator?.idx || prev?.edge !== indicator?.edge) {
      config.onStateChange?.();
    }
  }

  function teardownDrag() {
    window.removeEventListener("mousemove", onDragMove);
    window.removeEventListener("mouseup", onDragEnd);
    window.removeEventListener("keydown", onKeyDown);
    if (ghostEl) {
      ghostEl.remove();
      ghostEl = null;
    }
    sourceIdx = null;
    indicator = null;
    active = false;
    sourceHeight = 0;
    sourceContainer = null;
    document.body.style.cursor = "";
    config.onStateChange?.();
  }

  function onDragEnd() {
    const from = sourceIdx;
    const dropIndicator = indicator;
    if (from !== null && dropIndicator) {
      let to = dropIndicator.idx;
      if (dropIndicator.edge === "after") to += 1;
      if (from !== to) {
        config.onDrop(from, to);
      }
    }
    teardownDrag();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      teardownDrag();
    }
  }

  function start(e: MouseEvent, idx: number) {
    if (e.button !== 0) return;
    if (config.canStart && !config.canStart()) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const originEl = (e.target as HTMLElement).closest(
      selector,
    ) as HTMLElement | null;

    function onMove(ev: MouseEvent) {
      if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 5) {
        ev.preventDefault();
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUpCancel);
        sourceIdx = idx;
        active = true;
        sourceHeight = originEl?.offsetHeight ?? 0;
        sourceContainer = (originEl?.closest(config.containerSelector) ??
          null) as HTMLElement | null;
        // Park the drop indicator at the source's own position so the
        // ghost renders exactly where the dragged item used to be.
        // Without this, the source hides on drag start and the list
        // collapses by one row until the cursor enters a valid target.
        indicator = { idx, edge: "before" };
        document.body.style.cursor = "grabbing";
        config.onStateChange?.();
        if (originEl) {
          ghostEl = originEl.cloneNode(true) as HTMLElement;
          const { background, border } = config.ghostStyle();
          Object.assign(ghostEl.style, {
            position: "fixed",
            zIndex: "99999",
            pointerEvents: "none",
            width: originEl.offsetWidth + "px",
            opacity: "0.8",
            background,
            border,
            borderRadius: "6px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            left: ev.clientX + 8 + "px",
            top: ev.clientY - 12 + "px",
          });
          document.body.appendChild(ghostEl);
        }
        window.addEventListener("mousemove", onDragMove);
        window.addEventListener("mouseup", onDragEnd);
        window.addEventListener("keydown", onKeyDown);
      }
    }

    function onUpCancel() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUpCancel);
    }

    e.preventDefault();
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUpCancel);
  }

  return {
    start,
    getState: () => ({ sourceIdx, indicator, active, sourceHeight }),
  };
}
