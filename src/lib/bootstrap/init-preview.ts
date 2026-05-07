/**
 * Preview bootstrap — registers all built-in previewers and wires the
 * theme-change listener that refreshes preview styles.
 *
 * Previewers self-register via side-effectful imports of each file in
 * `lib/preview/previewers/`. The PreviewSurface component renders the
 * actual surface; this bootstrap just ensures the previewer registry is
 * populated before any preview surface mounts.
 */
import { eventBus, type AppEvent } from "../services/event-bus";
import { refreshPreviewStyles } from "../services/preview-service";
import { registerMarkdownComponent } from "../services/markdown-component-registry";
import ColumnsWidget from "../components/ColumnsWidget.svelte";

// Side-effect imports — each previewer self-registers via registerPreviewer().
import "../preview/previewers/markdown";
import "../preview/previewers/json";
import "../preview/previewers/image";
import "../preview/previewers/pdf";
import "../preview/previewers/csv";
import "../preview/previewers/yaml";
import "../preview/previewers/video";
import "../preview/previewers/text";

export function initPreview(): void {
  registerMarkdownComponent({
    name: "columns",
    component: ColumnsWidget,
    source: "core",
  });

  eventBus.on("theme:changed", (event: AppEvent) => {
    if (event.type !== "theme:changed") return;
    refreshPreviewStyles();
  });
}
