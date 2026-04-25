// Suppress jsdom "Not implemented: HTMLCanvasElement.getContext()" noise.
// Tests that need real canvas output should install the `canvas` npm package.
HTMLCanvasElement.prototype.getContext = () => null;

// Suppress jsdom navigation noise — tests don't exercise cross-document navigation.
// jsdom binds console.error at virtualConsole setup time so we must intercept stderr.
declare const process: {
  stderr: {
    write: (chunk: string | Uint8Array, ...rest: unknown[]) => boolean;
  };
};
const _stderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk: string | Uint8Array, ...rest: unknown[]) => {
  if (
    typeof chunk === "string" &&
    chunk.includes("Not implemented: navigation")
  )
    return true;
  return _stderrWrite(chunk, ...rest);
};
