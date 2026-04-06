import * as pty from "node-pty";
import { OutputBuffer } from "./output-buffer.js";
import type { SpawnOptions } from "./types.js";
import { AGENT_COMMANDS, PROMPT_PATTERNS } from "./types.js";

export interface ManagedPty {
  ptyProcess: pty.IPty;
  buffer: OutputBuffer;
  idleTimer: ReturnType<typeof setTimeout> | null;
  onStatusChange: (status: "running" | "idle" | "exited", exitCode?: number) => void;
}

const IDLE_TIMEOUT_MS = 5000;

export class PtyManager {
  private ptys = new Map<string, ManagedPty>();

  spawn(
    id: string,
    opts: SpawnOptions,
    onStatusChange: ManagedPty["onStatusChange"]
  ): { pid: number } {
    const args = this.resolveCommand(opts);
    const cwd = opts.cwd ?? process.env.HOME ?? "/";

    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      ...(opts.env ?? {}),
    };

    const ptyProcess = pty.spawn(args[0], args.slice(1), {
      name: "xterm-256color",
      cols: opts.cols ?? 120,
      rows: opts.rows ?? 30,
      cwd,
      env,
    });

    const buffer = new OutputBuffer();

    const managed: ManagedPty = {
      ptyProcess,
      buffer,
      idleTimer: null,
      onStatusChange,
    };

    ptyProcess.onData((data: string) => {
      buffer.append(data);
      onStatusChange("running");
      this.resetIdleTimer(managed);
    });

    ptyProcess.onExit(({ exitCode }) => {
      this.clearIdleTimer(managed);
      onStatusChange("exited", exitCode);
      this.ptys.delete(id);
    });

    this.ptys.set(id, managed);

    // If a task was provided, send it after startup delay
    if (opts.task) {
      setTimeout(() => {
        if (this.ptys.has(id)) {
          this.write(id, opts.task + "\r");
        }
      }, 3000);
    }

    return { pid: ptyProcess.pid };
  }

  write(id: string, data: string): void {
    const managed = this.ptys.get(id);
    if (!managed) throw new Error(`Session ${id} not found`);
    managed.ptyProcess.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    const managed = this.ptys.get(id);
    if (!managed) throw new Error(`Session ${id} not found`);
    managed.ptyProcess.resize(cols, rows);
  }

  kill(id: string, signal?: string): void {
    const managed = this.ptys.get(id);
    if (!managed) throw new Error(`Session ${id} not found`);
    managed.ptyProcess.kill(signal);
  }

  getBuffer(id: string): OutputBuffer | undefined {
    return this.ptys.get(id)?.buffer;
  }

  has(id: string): boolean {
    return this.ptys.has(id);
  }

  /** Kill all managed PTYs. Called on process exit. */
  killAll(): void {
    for (const [, managed] of this.ptys) {
      try {
        managed.ptyProcess.kill();
      } catch {
        // Already dead
      }
    }
    this.ptys.clear();
  }

  private resolveCommand(opts: SpawnOptions): string[] {
    if (opts.agent === "custom") {
      if (!opts.command) throw new Error('agent "custom" requires a command');
      return opts.command.split(/\s+/);
    }
    const cmd = AGENT_COMMANDS[opts.agent];
    if (!cmd || cmd.length === 0) {
      throw new Error(`Unknown agent type: ${opts.agent}`);
    }
    return [...cmd];
  }

  private resetIdleTimer(managed: ManagedPty): void {
    this.clearIdleTimer(managed);
    managed.idleTimer = setTimeout(() => {
      const lastLine = managed.buffer.getLastLine();
      const isPrompt = PROMPT_PATTERNS.some((p) => p.test(lastLine));
      if (isPrompt) {
        managed.onStatusChange("idle");
      }
    }, IDLE_TIMEOUT_MS);
  }

  private clearIdleTimer(managed: ManagedPty): void {
    if (managed.idleTimer) {
      clearTimeout(managed.idleTimer);
      managed.idleTimer = null;
    }
  }
}
