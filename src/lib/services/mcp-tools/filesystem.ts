import { invoke } from "@tauri-apps/api/core";
import type { ToolDef } from "../mcp-types";

export const filesystemTools: ToolDef[] = [
  {
    name: "list_dir",
    description:
      "List a directory. Returns entries with name, path, is_dir, size.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        include_hidden: { type: "boolean" },
      },
      required: ["path"],
    },
    handler: async (args) => {
      const p = args as { path: string; include_hidden?: boolean };
      const entries = await invoke<
        Array<{ name: string; path: string; is_dir: boolean; size: number }>
      >("mcp_list_dir", { path: p.path, includeHidden: p.include_hidden });
      return { entries };
    },
  },
  {
    name: "read_file",
    description:
      "Read a UTF-8 file and return its contents. Non-UTF-8 content is an error.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        max_bytes: { type: "number" },
      },
      required: ["path"],
    },
    handler: async (args) => {
      const p = args as { path: string; max_bytes?: number };
      const content = await invoke<string>("read_file", { path: p.path });
      if (p.max_bytes && content.length > p.max_bytes) {
        return { content: content.slice(0, p.max_bytes), truncated: true };
      }
      return { content, truncated: false };
    },
  },
  {
    name: "file_exists",
    description:
      "Check whether a path exists. Returns exists and (if it does) is_dir.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    handler: async (args) => {
      const p = args as { path: string };
      const [exists, isDir] = await invoke<[boolean, boolean]>(
        "mcp_file_info",
        { path: p.path },
      );
      return exists ? { exists: true, is_dir: isDir } : { exists: false };
    },
  },
  {
    name: "write_file",
    description:
      "Write content to a file at the given path. Creates the file if it does not exist; overwrites if it does. Restricted to paths permitted by the MCP read allowlist. Use create_preview_file when you also want to open a live preview surface.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
    handler: async (args) => {
      const p = args as { path: string; content: string };
      await invoke("write_file", { path: p.path, content: p.content });
      return { ok: true };
    },
  },
];
