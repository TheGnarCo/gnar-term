import { WebSocketServer, WebSocket } from "ws";
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";

const PORT_FILE_DIR = join(homedir(), ".config", "gnar-term");
const PORT_FILE_PATH = join(PORT_FILE_DIR, "mcp-bridge.port");

const REQUEST_TIMEOUT_MS = 30_000;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

type BridgeMessage =
  | { type: "request"; id: string; op: string; params: unknown }
  | { type: "response"; id: string; result?: unknown; error?: string };

export class BridgeNotConnectedError extends Error {
  constructor() {
    super("Gnar Term is not connected to the MCP bridge. Open Gnar Term and try again.");
    this.name = "BridgeNotConnectedError";
  }
}

/**
 * WebSocket bridge server hosted by the MCP sidecar. The Gnar Term webview
 * connects as a client and handles op requests. See SPEC.md for the
 * wire protocol.
 */
export class BridgeServer {
  private wss: WebSocketServer | null = null;
  private client: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private portWritten = false;

  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });

      this.wss.on("listening", () => {
        const addr = this.wss!.address();
        const port = typeof addr === "object" && addr !== null ? addr.port : 0;
        try {
          mkdirSync(PORT_FILE_DIR, { recursive: true });
          writeFileSync(PORT_FILE_PATH, String(port), "utf-8");
          this.portWritten = true;
        } catch (err) {
          console.error("[gnar-term-mcp] Failed to write bridge port file:", err);
        }
        resolve(port);
      });

      this.wss.on("error", reject);

      this.wss.on("connection", (ws) => {
        if (this.client) {
          // One client at a time. New connection takes over and old one is
          // closed — this handles the webview reloading during dev.
          try {
            this.client.close();
          } catch {
            // Ignore
          }
        }
        this.client = ws;
        console.error("[gnar-term-mcp] Gnar Term webview connected to bridge");

        ws.on("message", (raw) => this.handleMessage(raw.toString()));
        ws.on("close", () => {
          if (this.client === ws) {
            this.client = null;
            console.error("[gnar-term-mcp] Gnar Term webview disconnected");
            // Fail every pending request so MCP tools return promptly.
            for (const [id, pending] of this.pending) {
              clearTimeout(pending.timer);
              pending.reject(new BridgeNotConnectedError());
              this.pending.delete(id);
            }
          }
        });
        ws.on("error", (err) => {
          console.error("[gnar-term-mcp] Bridge client error:", err);
        });
      });
    });
  }

  isConnected(): boolean {
    return this.client !== null && this.client.readyState === WebSocket.OPEN;
  }

  /**
   * Send a request to the connected webview and wait for its response.
   * Throws BridgeNotConnectedError if no webview is connected.
   */
  async request<T = unknown>(op: string, params: unknown = {}): Promise<T> {
    if (!this.isConnected()) {
      throw new BridgeNotConnectedError();
    }
    const id = randomUUID();
    const msg: BridgeMessage = { type: "request", id, op, params };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`bridge op "${op}" timed out after ${REQUEST_TIMEOUT_MS}ms`));
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
        timer,
      });

      try {
        this.client!.send(JSON.stringify(msg));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private handleMessage(raw: string): void {
    let msg: BridgeMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      console.error("[gnar-term-mcp] malformed bridge message:", raw);
      return;
    }
    if (msg.type !== "response") {
      // The webview should only be sending responses right now. Future:
      // accept events. Ignore anything else for forward compatibility.
      return;
    }
    const pending = this.pending.get(msg.id);
    if (!pending) {
      // Late response or duplicate — drop.
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(msg.id);
    if (msg.error) {
      pending.reject(new Error(msg.error));
    } else {
      pending.resolve(msg.result);
    }
  }

  stop(): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new BridgeNotConnectedError());
      this.pending.delete(id);
    }
    if (this.client) {
      try {
        this.client.close();
      } catch {
        // Ignore
      }
      this.client = null;
    }
    this.wss?.close();
    this.wss = null;
    if (this.portWritten) {
      try {
        unlinkSync(PORT_FILE_PATH);
      } catch {
        // May not exist
      }
      this.portWritten = false;
    }
  }
}
