<script lang="ts">
  /**
   * SshSurface — renders an SSH session in a standard terminal pane.
   *
   * At runtime an SSH surface IS a TerminalSurface: the PTY process is
   * the system `ssh` binary launched with the persisted SshSurfaceConfig
   * args. This component delegates to AlacrittyTerminalSurface for all
   * rendering and PTY plumbing; its role is to match the SurfaceTypeDef.component
   * slot in the registry (for future UI decoration — connection status,
   * re-connect affordance, etc.).
   */
  import AlacrittyTerminalSurface from "../components/AlacrittyTerminalSurface.svelte";
  import type { TerminalSurface as TermSurface } from "../types";
  import type { SshSurfaceConfig } from "./ssh-surface";

  export let surface: TermSurface & { sshConfig?: SshSurfaceConfig };
  // visible / cwd / userScrolledUp are accepted for interface compatibility
  // with PaneView but not forwarded (AlacrittyTerminalSurface manages its own
  // visibility and cwd via PTY events).
  export let visible: boolean = true;
  export let cwd: string | undefined = undefined;
  export let userScrolledUp = false;

  // Silence unused-prop warnings — these are accepted for prop-interface
  // compatibility but not needed by AlacrittyTerminalSurface.
  void visible;
  void cwd;
  void userScrolledUp;
</script>

<AlacrittyTerminalSurface ptyId={surface.ptyId} paneId={surface.id} />
