import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { AgentSession, SpawnOptions, SessionStatus } from "./types.js";

export class SessionStore extends EventEmitter {
  private sessions = new Map<string, AgentSession>();

  create(opts: SpawnOptions, command: string): AgentSession {
    const session: AgentSession = {
      id: randomUUID(),
      name: opts.name,
      agentType: opts.agent,
      command,
      status: "starting",
      cwd: opts.cwd ?? process.env.HOME ?? "/",
      pid: undefined,
      createdAt: new Date().toISOString(),
      exitCode: undefined,
    };
    this.sessions.set(session.id, session);
    this.emit("session-created", session);
    return session;
  }

  get(id: string): AgentSession | undefined {
    return this.sessions.get(id);
  }

  list(): AgentSession[] {
    return Array.from(this.sessions.values());
  }

  updateStatus(id: string, status: SessionStatus, exitCode?: number): void {
    const session = this.sessions.get(id);
    if (!session) return;
    // Don't transition backwards (except to exited, which is terminal)
    if (status === "exited") {
      session.status = "exited";
      session.exitCode = exitCode;
      this.emit("session-exit", { sessionId: id, exitCode });
    } else if (session.status !== "exited") {
      session.status = status;
    }
  }

  updatePid(id: string, pid: number): void {
    const session = this.sessions.get(id);
    if (session) session.pid = pid;
  }

  delete(id: string): boolean {
    return this.sessions.delete(id);
  }
}
