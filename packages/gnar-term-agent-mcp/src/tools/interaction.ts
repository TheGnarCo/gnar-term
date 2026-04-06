import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SessionStore } from "../session-store.js";
import type { PtyManager } from "../pty-manager.js";
import { KEY_MAP } from "../types.js";

export function registerInteractionTools(
  server: McpServer,
  sessions: SessionStore,
  ptyManager: PtyManager,
): void {
  server.registerTool(
    "send_prompt",
    {
      description:
        "Send text input to a running agent session, simulating user typing. By default appends Enter to submit.",
      inputSchema: {
        session_id: z.string().describe("Target session ID"),
        text: z.string().describe("Text to send to the agent"),
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
    }) => {
      const session = sessions.get(session_id);
      if (!session) {
        return {
          content: [
            { type: "text" as const, text: `Error: session ${session_id} not found` },
          ],
          isError: true,
        };
      }
      try {
        const shouldPressEnter = press_enter !== false;
        ptyManager.write(session_id, text + (shouldPressEnter ? "\r" : ""));
        return {
          content: [
            {
              type: "text" as const,
              text: `Sent to ${session.name}: "${text}"${shouldPressEnter ? " [Enter]" : ""}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error sending prompt: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "send_keys",
    {
      description: `Send control sequences or special keys to an agent session. Available keys: ${Object.keys(KEY_MAP).join(", ")}`,
      inputSchema: {
        session_id: z.string().describe("Target session ID"),
        keys: z
          .string()
          .describe(
            "Key name to send (e.g. ctrl+c, enter, escape, up, down, tab)",
          ),
      },
    },
    async ({ session_id, keys }: { session_id: string; keys: string }) => {
      const session = sessions.get(session_id);
      if (!session) {
        return {
          content: [
            { type: "text" as const, text: `Error: session ${session_id} not found` },
          ],
          isError: true,
        };
      }
      const sequence = KEY_MAP[keys.toLowerCase()];
      if (!sequence) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: unknown key "${keys}". Available: ${Object.keys(KEY_MAP).join(", ")}`,
            },
          ],
          isError: true,
        };
      }
      try {
        ptyManager.write(session_id, sequence);
        return {
          content: [
            {
              type: "text" as const,
              text: `Sent ${keys} to ${session.name}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error sending keys: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "read_output",
    {
      description:
        "Read recent terminal output from an agent session. Use cursor-based reads for polling without missing data.",
      inputSchema: {
        session_id: z.string().describe("Target session ID"),
        lines: z
          .number()
          .optional()
          .describe("Number of recent lines to return (default: 50)"),
        cursor: z
          .number()
          .optional()
          .describe(
            "Return lines written after this cursor value (for incremental polling)",
          ),
        strip_ansi: z
          .boolean()
          .optional()
          .describe("Strip ANSI escape codes from output (default: true)"),
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
    }) => {
      const session = sessions.get(session_id);
      if (!session) {
        return {
          content: [
            { type: "text" as const, text: `Error: session ${session_id} not found` },
          ],
          isError: true,
        };
      }
      const buffer = ptyManager.getBuffer(session_id);
      if (!buffer) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                output: "",
                cursor: 0,
                total_lines: 0,
                session_status: session.status,
              }),
            },
          ],
        };
      }
      const result = buffer.read({
        lastN: lines,
        sinceCursor: cursor,
        shouldStripAnsi: strip_ansi !== false,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                output: result.lines.join("\n"),
                cursor: result.cursor,
                total_lines: result.totalLines,
                session_status: session.status,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
