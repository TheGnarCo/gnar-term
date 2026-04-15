import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { get } from "svelte/store";
import { workspaces } from "../stores/workspace";
import { getAllSurfaces, isTerminalSurface } from "../types";

interface BridgeRequest {
  correlation_id: number;
  op: string;
  params: unknown;
}

interface BridgeResponse {
  correlation_id: number;
  result?: unknown;
  error?: string;
}

type Handler = (params: unknown) => unknown | Promise<unknown>;

const handlers: Record<string, Handler> = {
  list_ptys: () => {
    const all = get(workspaces);
    const ids = new Set<number>();
    for (const ws of all) {
      for (const surface of getAllSurfaces(ws)) {
        if (isTerminalSurface(surface) && surface.ptyId > 0) {
          ids.add(surface.ptyId);
        }
      }
    }
    return { pty_ids: Array.from(ids).sort((a, b) => a - b) };
  },

  ping: () => ({ pong: true }),
};

export function registerBridgeHandler(op: string, handler: Handler): void {
  handlers[op] = handler;
}

export async function initBridgeHandler(): Promise<UnlistenFn> {
  return listen<BridgeRequest>("bridge:request", async (event) => {
    const { correlation_id, op, params } = event.payload;
    let response: BridgeResponse;
    try {
      const handler = handlers[op];
      if (!handler) {
        response = { correlation_id, error: `unknown op: ${op}` };
      } else {
        const result = await handler(params);
        response = { correlation_id, result };
      }
    } catch (e) {
      response = {
        correlation_id,
        error: e instanceof Error ? e.message : String(e),
      };
    }
    await emit("bridge:response", response);
  });
}
