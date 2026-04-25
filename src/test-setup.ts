// Suppress jsdom "Not implemented: HTMLCanvasElement.getContext()" noise.
// Tests that need real canvas output should install the `canvas` npm package.
HTMLCanvasElement.prototype.getContext = () => null;
