/** Type augmentation for xterm.js options not yet in bundled types. */
declare module "@xterm/xterm" {
  interface ITerminalOptions {
    fastScrollModifier?: "none" | "alt" | "ctrl" | "shift";
    vtExtensions?: {
      kittyKeyboard?: boolean;
    };
  }
}

declare module "*.css";
