// Match navigator.platform to the actual OS so isMac-conditional tests and
// skipIf(!isMac) guards behave correctly without per-test mocks.
Object.defineProperty(navigator, "platform", {
  value: process.platform === "darwin" ? "MacIntel" : "Linux x86_64",
  configurable: true,
  writable: true,
});

// Suppress jsdom "Not implemented: HTMLCanvasElement.getContext()" noise.
// Tests that need real canvas output should install the `canvas` npm package.
HTMLCanvasElement.prototype.getContext = () => null;

// jsdom doesn't implement Web Animations API. Svelte's `slide`/`fade`/etc.
// transitions call `element.animate(...)` and throw under jsdom, surfacing
// as an unhandled error during render. Stub a minimal Animation shim so
// transitions noop instead of crashing.
if (typeof Element !== "undefined" && !Element.prototype.animate) {
  Element.prototype.animate = function () {
    return {
      cancel() {},
      finish() {},
      pause() {},
      play() {},
      reverse() {},
      addEventListener() {},
      removeEventListener() {},
      finished: Promise.resolve(),
      onfinish: null,
      oncancel: null,
    } as unknown as Animation;
  };
}

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
