/** Type augmentation for xterm.js options not yet in bundled types. */
declare module "@xterm/xterm" {
  interface ITerminalOptions {
    fastScrollModifier?: "none" | "alt" | "ctrl" | "shift";
    vtExtensions?: {
      kittyKeyboard?: boolean;
    };
  }
}

// Side-effect CSS imports — TS bundler resolution needs an explicit shim
// once we moved to @xterm/xterm@6.1.0-beta.197 (which dropped the implicit
// CSS types).
declare module "*.css";
