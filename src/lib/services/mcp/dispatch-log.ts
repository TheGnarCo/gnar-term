/**
 * Observability: the in-memory dispatch log for UI-mutating tools.
 */
import type { ConnectionBinding } from "./types";

export interface DispatchLogEntry {
  ts: string;
  connectionId: number;
  tool: string;
  binding: ConnectionBinding | null;
  args: unknown;
  resolved?: { workspaceId: string; paneId: string | null; source: string };
  result?: { kind: "ok"; summary: string } | { kind: "error"; message: string };
}

const DISPATCH_LOG_MAX = 500;
const dispatchLog: DispatchLogEntry[] = [];

export function logDispatch(entry: DispatchLogEntry): void {
  dispatchLog.push(entry);
  if (dispatchLog.length > DISPATCH_LOG_MAX) {
    dispatchLog.shift();
  }
  // Echo to console in a structured single line so devtools can grep.
  const resolved = entry.resolved
    ? `resolved={ws=${entry.resolved.workspaceId},pane=${entry.resolved.paneId ?? "-"},src=${entry.resolved.source}}`
    : "resolved=<unresolved>";
  const bind = entry.binding
    ? `binding={ws=${entry.binding.workspaceId ?? "null"},pane=${entry.binding.paneId ?? "null"}}`
    : "binding=<none>";
  const result = entry.result
    ? entry.result.kind === "ok"
      ? `result=ok(${entry.result.summary})`
      : `result=ERR(${entry.result.message})`
    : "result=<pending>";
  // eslint-disable-next-line no-console
  console.log(
    `[mcp] conn=#${entry.connectionId} tool=${entry.tool} ${bind} args=${JSON.stringify(entry.args)} ${resolved} ${result}`,
  );
}

export function getDispatchLog(): readonly DispatchLogEntry[] {
  return dispatchLog;
}

export function resetDispatchLogForTest(): void {
  dispatchLog.length = 0;
}
