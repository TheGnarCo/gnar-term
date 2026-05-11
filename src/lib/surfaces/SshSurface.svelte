<script lang="ts">
  /**
   * SshSurface — renders an SSH session in a standard terminal pane.
   *
   * At runtime an SSH surface IS a TerminalSurface: the PTY process is
   * the system `ssh` binary launched with the persisted SshSurfaceConfig
   * args. This component delegates to TerminalSurface for all rendering
   * and PTY plumbing; its role is to match the SurfaceTypeDef.component
   * slot in the registry (for future UI decoration — connection status,
   * re-connect affordance, etc.).
   *
   * Props mirror TerminalSurface's signature so PaneView can render it
   * without special-casing.
   */
  import TerminalSurface from "../components/TerminalSurface.svelte";
  import type { TerminalSurface as TermSurface } from "../types";
  import type { SshSurfaceConfig } from "./ssh-surface";

  export let surface: TermSurface & { sshConfig?: SshSurfaceConfig };
  export let visible: boolean;
  export let cwd: string | undefined = undefined;
  export let userScrolledUp = false;
</script>

<TerminalSurface {surface} {visible} {cwd} bind:userScrolledUp />
