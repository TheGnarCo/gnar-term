/**
 * SSH Surface — spawns the system `ssh` binary under a portable-pty PTY.
 *
 * See ADR 0005: SSH surface spawns `ssh` under a normal PTY.
 *
 * At runtime an SSH surface is a TerminalSurface whose ptyId process is
 * `ssh <args>`. The `SshSurfaceConfig` is persisted on the surface def
 * so workspace restore can re-spawn the same connection.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SshSurfaceConfig {
  /** Remote hostname or IP address. Required. */
  host: string;
  /** Remote username. When omitted, ssh uses the local username. */
  user?: string;
  /** Absolute or `~`-relative path to the identity file (-i flag). */
  identity?: string;
  /**
   * Remote working directory. When set, ssh is invoked with
   * `-t 'cd <cwd> && exec $SHELL -l'` to land in the right directory.
   */
  cwd?: string;
  /**
   * Seconds between keep-alive probes (-o ServerAliveInterval=<n>).
   * 0 or omitted means no keep-alive flag is emitted.
   */
  keepAlive?: number;
}

// ---------------------------------------------------------------------------
// Command builder
// ---------------------------------------------------------------------------

/**
 * Build the `ssh` argv for the given config.
 *
 * Returns `null` when the config is invalid (empty or whitespace-only host).
 * The caller must treat null as a skip / fallback — no exception is thrown
 * because invalid config from a serialized file should degrade gracefully.
 *
 * Arg order:
 *   ssh [-i <identity>] [-o ServerAliveInterval=<n>] [user@]host [-t 'cd <cwd> && exec $SHELL -l']
 */
export function buildSshCommand(
  config: SshSurfaceConfig,
): { command: string; args: string[] } | null {
  if (!config.host || !config.host.trim()) return null;

  const args: string[] = [];

  if (config.identity && config.identity.length > 0) {
    args.push("-i", config.identity);
  }

  if (config.keepAlive && config.keepAlive > 0) {
    args.push("-o", `ServerAliveInterval=${config.keepAlive}`);
  }

  const target = config.user ? `${config.user}@${config.host}` : config.host;
  args.push(target);

  if (config.cwd && config.cwd.length > 0) {
    args.push("-t", `cd ${config.cwd} && exec $SHELL -l`);
  }

  return { command: "ssh", args };
}

/**
 * Render the ssh argv as a single shell string suitable for passing as a
 * `startupCommand` to `connectPty` (which writes it to the pty stdin).
 *
 * Returns null when the config is invalid (same contract as buildSshCommand).
 */
export function buildSshStartupCommand(
  config: SshSurfaceConfig,
): string | null {
  const result = buildSshCommand(config);
  if (!result) return null;
  const { command, args } = result;
  // Shell-quote args that contain spaces (only the cwd snippet in practice)
  const quotedArgs = args.map((a) =>
    a.includes(" ") ? `'${a.replace(/'/g, "'\\''")}'` : a,
  );
  return [command, ...quotedArgs].join(" ");
}
