import { describe, it, expect, vi } from "vitest";
import type { ExtensionAPI } from "../../api";
import { registerAgenticExtension } from "../index";

function makeFakeApi(): {
  api: ExtensionAPI;
  onActivateSpy: ReturnType<typeof vi.fn>;
  onDeactivateSpy: ReturnType<typeof vi.fn>;
} {
  const onActivateSpy = vi.fn();
  const onDeactivateSpy = vi.fn();
  const api = {
    onActivate: onActivateSpy,
    onDeactivate: onDeactivateSpy,
  } as unknown as ExtensionAPI;
  return { api, onActivateSpy, onDeactivateSpy };
}

describe("registerAgenticExtension", () => {
  it("calls onActivate exactly once", () => {
    const { api, onActivateSpy } = makeFakeApi();
    registerAgenticExtension(api);
    expect(onActivateSpy).toHaveBeenCalledTimes(1);
  });

  it("calls onDeactivate exactly once", () => {
    const { api, onDeactivateSpy } = makeFakeApi();
    registerAgenticExtension(api);
    expect(onDeactivateSpy).toHaveBeenCalledTimes(1);
  });

  it("onActivate callback does not throw", () => {
    const { api, onActivateSpy } = makeFakeApi();
    registerAgenticExtension(api);
    const callback = onActivateSpy.mock.calls[0][0] as () => void;
    expect(() => callback()).not.toThrow();
  });

  it("onDeactivate callback does not throw", () => {
    const { api, onDeactivateSpy } = makeFakeApi();
    registerAgenticExtension(api);
    const callback = onDeactivateSpy.mock.calls[0][0] as () => void;
    expect(() => callback()).not.toThrow();
  });
});
