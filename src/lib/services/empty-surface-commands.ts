/**
 * Command ids promoted as buttons on the Empty Surface screen.
 *
 * The Empty Surface renders workspace-zone actions automatically, but
 * commands (from the command registry) don't surface that way — listing
 * their ids here opts them in. Unknown ids are silently skipped, so
 * entries safely reference extensions that may not be installed.
 */
export const EMPTY_SURFACE_COMMAND_IDS: string[] = [
  // workspaces:create-workspace removed: "New Workspace..." now surfaces
  // via the workspace-scope workspaceAction (rendered automatically by
  // EmptySurface alongside "New Nested Workspace"), so keeping the
  // command id here would double-render it.
];
