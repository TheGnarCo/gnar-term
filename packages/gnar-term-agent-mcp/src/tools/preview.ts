import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SessionStore } from "../session-store.js";
import type { PtyManager } from "../pty-manager.js";
import type { SessionPlacement } from "../types.js";

export function registerPreviewTools(
  server: McpServer,
  sessions: SessionStore,
  _ptyManager: PtyManager,
): void {
  server.registerTool(
    "create_preview",
    {
      description:
        "Create a rich markdown preview pane in the terminal. " +
        "Renders content as formatted markdown (GitHub-flavored) instead of raw terminal output. " +
        "Useful for summaries, reports, documentation, or any structured content.",
      inputSchema: {
        content: z.string().describe("Markdown content to render"),
        title: z.string().describe("Tab title for the preview pane"),
        placement: z
          .enum(["tab", "split-right", "split-down"])
          .default("tab")
          .describe("Where to place the preview: tab (new tab in active pane), split-right, or split-down"),
      },
    },
    async ({ content, title, placement }: { content: string; title: string; placement: SessionPlacement }) => {
      const previewId = `preview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      sessions.emit("preview-placed", { previewId, title, content, placement });

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            preview_id: previewId,
            title,
            placement,
          }, null, 2),
        }],
      };
    },
  );
}
