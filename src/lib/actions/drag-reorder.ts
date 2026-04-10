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
}

export interface DragReorderState {
  sourceIdx: number | null;
  indicator: { idx: number; edge: "before" | "after" } | null;
  active: boolean;
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
  let ghostEl: HTMLElement | null = null;

  function onDragMove(e: MouseEvent) {
    if (sourceIdx === null) return;
    if (ghostEl) {
      ghostEl.style.left = e.clientX + 8 + "px";
      ghostEl.style.top = e.clientY - 12 + "px";
    }
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el) {
      indicator = null;
      return;
    }
    const item = (el as HTMLElement).closest(selector) as HTMLElement | null;
    if (!item) {
      const inContainer = (el as HTMLElement).closest(config.containerSelector);
      if (inContainer) return; // keep current indicator
      indicator = null;
      return;
    }
    const targetIdx = parseInt(item.dataset[dataKey]!, 10);
    const rect = item.getBoundingClientRect();
    const edge: "before" | "after" =
      e.clientY - rect.top < rect.height / 2 ? "before" : "after";
    indicator = { idx: targetIdx, edge };
  }

  function onDragEnd() {
    window.removeEventListener("mousemove", onDragMove);
    window.removeEventListener("mouseup", onDragEnd);
    if (ghostEl) {
      ghostEl.remove();
      ghostEl = null;
    }

    if (sourceIdx !== null && indicator) {
      const from = sourceIdx;
      let to = indicator.idx;
      if (indicator.edge === "after") to += 1;
      if (from !== to) {
        config.onDrop(from, to);
      }
    }

    sourceIdx = null;
    indicator = null;
    active = false;
    document.body.style.cursor = "";
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
        document.body.style.cursor = "grabbing";
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
    getState: () => ({ sourceIdx, indicator, active }),
  };
}
