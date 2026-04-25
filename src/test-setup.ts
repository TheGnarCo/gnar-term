// Suppress jsdom "Not implemented: HTMLCanvasElement.getContext()" noise.
// Tests that need real canvas output should install the `canvas` npm package.
HTMLCanvasElement.prototype.getContext = () => null;

// Suppress jsdom navigation noise — tests don't exercise cross-document navigation.
// jsdom binds console.error at virtualConsole setup time so we must intercept stderr.
const _stderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (
  chunk: string | Uint8Array,
  encodingOrCb?: BufferEncoding | ((err?: Error | null) => void),
  cb?: (err?: Error | null) => void,
): boolean => {
  if (
    typeof chunk === "string" &&
    chunk.includes("Not implemented: navigation")
  )
    return true;
  return _stderrWrite(
    chunk,
    encodingOrCb as BufferEncoding,
    cb as (err?: Error | null) => void,
  );
};
