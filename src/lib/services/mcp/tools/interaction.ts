/**
 * Interaction tools: send_prompt, send_keys, read_output.
 */
import { invoke } from "@tauri-apps/api/core";
import { getMcpBuffer } from "../../mcp-output-buffer";
import { registerTool } from "../registry";
import { sessions } from "../state";
import { KEY_MAP } from "../types";

registerTool({
  name: "send_prompt",
  description: "Send text to an MCP session's PTY. Appends Enter unless press_enter is false.",
  inputSchema: {
    type: "object",
    properties: {
      session_id: { type: "string" },
      text: { type: "string" },
      press_enter: { type: "boolean" },
    },
    required: ["session_id", "text"],
  },
  handler: async (args) => {
    const p = args as { session_id: string; text: string; press_enter?: boolean };
    const session = sessions.get(p.session_id);
    if (!session) throw new Error(`session ${p.session_id} not found`);
    const data = p.text + (p.press_enter === false ? "" : "\r");
    await invoke("write_pty", { ptyId: session.ptyId, data });
    return { ok: true };
  },
});

registerTool({
  name: "send_keys",
  description: "Send a named keystroke (ctrl+c, enter, escape, arrows, etc.) to an MCP session.",
  inputSchema: {
    type: "object",
    properties: {
      session_id: { type: "string" },
      keys: { type: "string" },
    },
    required: ["session_id", "keys"],
  },
  handler: async (args) => {
    const p = args as { session_id: string; keys: string };
    const session = sessions.get(p.session_id);
    if (!session) throw new Error(`session ${p.session_id} not found`);
    const sequence = KEY_MAP[p.keys.toLowerCase()];
    if (!sequence) {
      throw new Error(
        `unknown key "${p.keys}". Available: ${Object.keys(KEY_MAP).join(", ")}`,
      );
    }
    await invoke("write_pty", { ptyId: session.ptyId, data: sequence });
    return { ok: true };
  },
});

registerTool({
  name: "read_output",
  description: "Read terminal output from an MCP session. Supports cursor-based polling and ANSI stripping.",
  inputSchema: {
    type: "object",
    properties: {
      session_id: { type: "string" },
      lines: { type: "number" },
      cursor: { type: "number" },
      strip_ansi: { type: "boolean" },
    },
    required: ["session_id"],
  },
  handler: (args) => {
    const p = args as {
      session_id: string;
      lines?: number;
      cursor?: number;
      strip_ansi?: boolean;
    };
    const session = sessions.get(p.session_id);
    if (!session) throw new Error(`session ${p.session_id} not found`);
    const buffer = getMcpBuffer(session.ptyId);
    if (!buffer) {
      return {
        output: "",
        cursor: 0,
        total_lines: 0,
        session_status: session.status,
      };
    }
    const result = buffer.read({
      lines: p.lines,
      cursor: p.cursor,
      strip_ansi: p.strip_ansi,
    });
    return { ...result, session_status: session.status };
  },
});
