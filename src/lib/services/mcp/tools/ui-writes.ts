/**
 * UI-write tools: render_sidebar, remove_sidebar_section, create_preview.
 */
import { workspaces } from "../../../stores/workspace";
import { type Pane } from "../../../types";
import {
  upsertSection,
  removeSection,
  type SidebarItem,
} from "../../../stores/extension-sidebar";
import { openPreviewFromContent } from "../../../../preview";
import { registerTool } from "../registry";
import {
  resolveTarget,
  pickHostPane,
  splitPaneInWorkspace,
} from "../target-resolution";

registerTool({
  name: "render_sidebar",
  description:
    "Declare or replace an extension sidebar section in the resolved workspace. Sections are workspace-scoped: invisible from other workspaces.",
  inputSchema: {
    type: "object",
    properties: {
      section_id: { type: "string" },
      title: { type: "string" },
      items: { type: "array" },
      workspace_id: { type: "string" },
    },
    required: ["section_id", "title", "items"],
  },
  handler: (args, ctx) => {
    const p = args as {
      section_id: string;
      title: string;
      items: SidebarItem[];
      workspace_id?: string;
    };
    const target = resolveTarget({ workspace_id: p.workspace_id }, ctx);
    upsertSection({
      sectionId: p.section_id,
      title: p.title,
      items: p.items ?? [],
      workspaceId: target.workspace.id,
    });
    return { ok: true, workspace_id: target.workspace.id };
  },
});

registerTool({
  name: "remove_sidebar_section",
  description:
    "Remove an extension-declared sidebar section from the resolved workspace. Safe for non-existent IDs.",
  inputSchema: {
    type: "object",
    properties: {
      section_id: { type: "string" },
      workspace_id: { type: "string" },
    },
    required: ["section_id"],
  },
  handler: (args, ctx) => {
    const p = args as {
      section_id: string;
      workspace_id?: string;
    };
    const target = resolveTarget({ workspace_id: p.workspace_id }, ctx);
    removeSection(target.workspace.id, p.section_id);
    return { ok: true, workspace_id: target.workspace.id };
  },
});

registerTool({
  name: "create_preview",
  description:
    "Open a preview surface with markdown/text/code content. Targets the agent's host workspace by default; pass workspace_id/pane_id to override.",
  inputSchema: {
    type: "object",
    properties: {
      content: { type: "string" },
      format: { type: "string", enum: ["markdown", "text", "code"] },
      language: { type: "string" },
      title: { type: "string" },
      placement: {
        type: "string",
        enum: ["split-right", "split-down", "new-tab", "current-pane"],
      },
      workspace_id: { type: "string" },
      pane_id: { type: "string" },
    },
    required: ["content", "format"],
  },
  handler: (args, ctx) => {
    const p = args as {
      content: string;
      format: "markdown" | "text" | "code";
      language?: string;
      title?: string;
      placement?: "split-right" | "split-down" | "new-tab" | "current-pane";
      workspace_id?: string;
      pane_id?: string;
    };
    const target = resolveTarget(p, ctx);
    const title = p.title ?? "Preview";
    let rendered: string;
    if (p.format === "markdown") rendered = p.content;
    else if (p.format === "code")
      rendered = "```" + (p.language ?? "") + "\n" + p.content + "\n```";
    else rendered = "```\n" + p.content + "\n```";
    const previewSurface = openPreviewFromContent(rendered, title);

    const placement = p.placement ?? "split-right";
    const hostPane = target.hostPane ?? pickHostPane(target.workspace);
    let targetPane: Pane;
    if (placement === "split-right") {
      targetPane = splitPaneInWorkspace(target.workspace, hostPane, "horizontal");
      ctx.lastSpawnedPaneId = targetPane.id;
    } else if (placement === "split-down") {
      targetPane = splitPaneInWorkspace(target.workspace, hostPane, "vertical");
      ctx.lastSpawnedPaneId = targetPane.id;
    } else {
      // new-tab and current-pane drop into the host pane's surface list.
      targetPane = hostPane;
    }

    const surface = {
      kind: "preview" as const,
      id: previewSurface.id,
      filePath: previewSurface.filePath,
      title: previewSurface.title,
      element: previewSurface.element,
      watchId: previewSurface.watchId,
      hasUnread: false,
    };
    targetPane.surfaces.push(surface);
    targetPane.activeSurfaceId = surface.id;
    workspaces.update((l) => [...l]);

    return {
      preview_id: surface.id,
      pane_id: targetPane.id,
      workspace_id: target.workspace.id,
    };
  },
});
