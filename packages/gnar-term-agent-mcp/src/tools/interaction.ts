import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeServer } from "../bridge-server.js";
import { KEY_MAP } from "../types.js";

function errorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

function successResult(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

async function forward<T = unknown>(bridge: BridgeServer, op: string, params: unknown) {
  try {
    const result = await bridge.request<T>(op, params);
    return successResult(result);
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}

export function registerInteractionTools(server: McpServer, bridge: BridgeServer): void {
  server.registerTool(
    "send_prompt",
    {
      description:
        "Send text input to a running session, simulating user typing. Appends Enter by default.",
      inputSchema: {
        session_id: z.string().describe("Target session ID"),
        text: z.string().describe("Text to send to the session"),
        press_enter: z
          .boolean()
          .optional()
          .describe("Append Enter keystroke after text (default: true)"),
      },
    },
    async ({
      session_id,
      text,
      press_enter,
    }: {
      session_id: string;
      text: string;
      press_enter?: boolean;
    }) => forward(bridge, "send_prompt", { session_id, text, press_enter }),
  );

  server.registerTool(
    "send_keys",
    {
      description: `Send control sequences or special keys to a session. Available keys: ${Object.keys(KEY_MAP).join(", ")}`,
      inputSchema: {
        session_id: z.string().describe("Target session ID"),
        keys: z
          .string()
          .describe("Key name (e.g. ctrl+c, enter, escape, up, down, tab)"),
      },
    },
    async ({ session_id, keys }: { session_id: string; keys: string }) => {
      if (!KEY_MAP[keys.toLowerCase()]) {
        return errorResult(
          `unknown key "${keys}". Available: ${Object.keys(KEY_MAP).join(", ")}`,
        );
      }
      return forward(bridge, "send_keys", { session_id, keys: keys.toLowerCase() });
    },
  );

  server.registerTool(
    "read_output",
    {
      description:
        "Read recent terminal output from a session. Use cursor-based polling to read incrementally.",
      inputSchema: {
        session_id: z.string().describe("Target session ID"),
        lines: z
          .number()
          .optional()
          .describe("Number of recent lines to return (default: 50)"),
        cursor: z
          .number()
          .optional()
          .describe("Return lines written after this cursor value"),
        strip_ansi: z
          .boolean()
          .optional()
          .describe("Strip ANSI escape codes (default: true)"),
      },
    },
    async ({
      session_id,
      lines,
      cursor,
      strip_ansi,
    }: {
      session_id: string;
      lines?: number;
      cursor?: number;
      strip_ansi?: boolean;
    }) =>
      forward(bridge, "read_output", {
        session_id,
        lines,
        cursor,
        strip_ansi,
      }),
  );
}
