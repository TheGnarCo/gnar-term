import { WebSocketServer, WebSocket } from "ws";
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { SessionStore } from "./session-store.js";
import type { PtyManager } from "./pty-manager.js";
import type { AgentSession, ScreenDescriptor, SessionPlacement } from "./types.js";

/** Bridge protocol messages: server → client */
export type ServerMessage =
  | { type: "session-created"; session: AgentSession }
  | { type: "session-placed"; session: AgentSession; placement: SessionPlacement }
  | { type: "session-output"; sessionId: string; data: string }
  | { type: "session-exit"; sessionId: string; exitCode: number }
  | { type: "session-list"; sessions: AgentSession[] }
  | { type: "screen-created"; screen: ScreenDescriptor }
  | { type: "preview-placed"; previewId: string; title: string; content: string; placement: SessionPlacement };

/** Bridge protocol messages: client → server */
export type ClientMessage =
  | { type: "list-sessions" }
  | { type: "write-session"; sessionId: string; data: string }
  | { type: "resize-session"; sessionId: string; cols: number; rows: number };

const PORT_FILE_DIR = join(homedir(), ".config", "gnar-term");
const PORT_FILE_PATH = join(PORT_FILE_DIR, "mcp-bridge.port");

/**
 * WebSocket bridge that allows the Gnar Term frontend to observe and interact
 * with MCP-managed PTY sessions in real time.
 */
export class BridgeServer {
  private wss: WebSocketServer | null = null;
  private clients = new Set<WebSocket>();

  constructor(
    private sessions: SessionStore,
    private ptyManager: PtyManager,
  ) {}

  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });

      this.wss.on("listening", () => {
        const addr = this.wss!.address();
        const port = typeof addr === "object" && addr !== null ? addr.port : 0;

        // Write port file for frontend discovery
        try {
          mkdirSync(PORT_FILE_DIR, { recursive: true });
          writeFileSync(PORT_FILE_PATH, String(port), "utf-8");
        } catch (err) {
          console.error("Failed to write bridge port file:", err);
        }

        this.wireEvents();
        resolve(port);
      });

      this.wss.on("error", reject);

      this.wss.on("connection", (ws) => {
        this.clients.add(ws);
        ws.on("message", (raw) => this.handleClientMessage(ws, raw));
        ws.on("close", () => this.clients.delete(ws));
        ws.on("error", () => this.clients.delete(ws));
      });
    });
  }

  private wireEvents(): void {
    // Forward session creation events
    this.sessions.on("session-created", (session: AgentSession) => {
      this.broadcast({ type: "session-created", session });
    });

    // Forward placed sessions (tab, split-right, split-down)
    this.sessions.on("session-placed", ({ session, placement }: { session: AgentSession; placement: SessionPlacement }) => {
      this.broadcast({ type: "session-placed", session, placement });
    });

    // Forward session exit events
    this.sessions.on("session-exit", ({ sessionId, exitCode }: { sessionId: string; exitCode: number }) => {
      this.broadcast({ type: "session-exit", sessionId, exitCode });
    });

    // Forward screen creation events (composite layout with multiple sessions)
    this.sessions.on("screen-created", (screen: ScreenDescriptor) => {
      this.broadcast({ type: "screen-created", screen });
    });

    // Forward preview placement events (rich markdown content panes)
    this.sessions.on("preview-placed", ({ previewId, title, content, placement }: { previewId: string; title: string; content: string; placement: SessionPlacement }) => {
      this.broadcast({ type: "preview-placed", previewId, title, content, placement });
    });

    // Forward raw PTY output (base64 encoded for binary safety)
    this.ptyManager.on("pty-data", ({ sessionId, data }: { sessionId: string; data: string }) => {
      if (this.clients.size === 0) return; // No point encoding if nobody's listening
      const encoded = Buffer.from(data, "utf-8").toString("base64");
      this.broadcast({ type: "session-output", sessionId, data: encoded });
    });

    this.ptyManager.on("pty-exit", ({ sessionId, exitCode }: { sessionId: string; exitCode: number }) => {
      this.broadcast({ type: "session-exit", sessionId, exitCode });
    });
  }

  private handleClientMessage(ws: WebSocket, raw: WebSocket.RawData): void {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      return;
    }

    switch (msg.type) {
      case "list-sessions":
        ws.send(JSON.stringify({
          type: "session-list",
          sessions: this.sessions.list(),
        } satisfies ServerMessage));
        break;

      case "write-session":
        try {
          this.ptyManager.write(msg.sessionId, msg.data);
        } catch {
          // Session may have exited
        }
        break;

      case "resize-session":
        try {
          this.ptyManager.resize(msg.sessionId, msg.cols, msg.rows);
        } catch {
          // Session may have exited
        }
        break;
    }
  }

  private broadcast(msg: ServerMessage): void {
    const json = JSON.stringify(msg);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(json);
      }
    }
  }

  stop(): void {
    // Clean up port file
    try {
      unlinkSync(PORT_FILE_PATH);
    } catch {
      // May not exist
    }

    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();
    this.wss?.close();
    this.wss = null;
  }
}
