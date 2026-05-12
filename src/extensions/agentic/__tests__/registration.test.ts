import { describe, it, expect, vi } from "vitest";
import { writable, get } from "svelte/store";
import type { ExtensionAPI } from "../../api";
import { registerAgenticExtension } from "../index";

function makeFakeApi(): {
  api: ExtensionAPI;
  onActivateSpy: ReturnType<typeof vi.fn>;
  onDeactivateSpy: ReturnType<typeof vi.fn>;
  registerGlobalSurfaceSpy: ReturnType<typeof vi.fn>;
  registerTitleBarButtonSpy: ReturnType<typeof vi.fn>;
  attention: ReturnType<typeof writable<unknown[]>>;
} {
  const onActivateSpy = vi.fn();
  const onDeactivateSpy = vi.fn();
  const spawnOrNavigate = vi.fn(() => {});
  const registerGlobalSurfaceSpy = vi.fn(() => spawnOrNavigate);
  const registerTitleBarButtonSpy = vi.fn();
  const attention = writable<unknown[]>([]);
  const agents = writable<unknown[]>([]);

  const api = {
    onActivate: onActivateSpy,
    onDeactivate: onDeactivateSpy,
    registerGlobalSurface: registerGlobalSurfaceSpy,
    registerTitleBarButton: registerTitleBarButtonSpy,
    registerWorkspaceSubtitle: vi.fn(),
    registerChildRowContributor: vi.fn(),
    registerRootRowRenderer: vi.fn(),
    attention,
    agents,
  } as unknown as ExtensionAPI;

  return {
    api,
    onActivateSpy,
    onDeactivateSpy,
    registerGlobalSurfaceSpy,
    registerTitleBarButtonSpy,
    attention,
  };
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

  describe("onActivate registrations", () => {
    function runActivate() {
      const fakes = makeFakeApi();
      registerAgenticExtension(fakes.api);
      const callback = fakes.onActivateSpy.mock.calls[0][0] as () => void;
      callback();
      return fakes;
    }

    it("registers a global surface with id 'dashboard'", () => {
      const { registerGlobalSurfaceSpy } = runActivate();
      expect(registerGlobalSurfaceSpy).toHaveBeenCalledTimes(1);
      expect(registerGlobalSurfaceSpy.mock.calls[0][0]).toBe("dashboard");
    });

    it("registers a TitleBar button with id 'agentic'", () => {
      const { registerTitleBarButtonSpy } = runActivate();
      expect(registerTitleBarButtonSpy).toHaveBeenCalledTimes(1);
      expect(registerTitleBarButtonSpy.mock.calls[0][0]).toBe("agentic");
    });

    it("button isActive store emits false when attention is empty", () => {
      const { registerTitleBarButtonSpy } = runActivate();
      const opts = registerTitleBarButtonSpy.mock.calls[0][1] as {
        isActive: ReturnType<typeof writable<boolean>>;
      };
      expect(get(opts.isActive)).toBe(false);
    });

    it("button isActive store emits true after pushing one attention entry", () => {
      const fakes = makeFakeApi();
      registerAgenticExtension(fakes.api);
      const callback = fakes.onActivateSpy.mock.calls[0][0] as () => void;
      callback();

      const opts = fakes.registerTitleBarButtonSpy.mock.calls[0][1] as {
        isActive: ReturnType<typeof writable<boolean>>;
      };
      fakes.attention.set([{ paneId: "pane-1", type: "awaiting_input" }]);
      expect(get(opts.isActive)).toBe(true);
    });

    it("button onClick is the spawnOrNavigate callable from registerGlobalSurface", () => {
      const { registerGlobalSurfaceSpy, registerTitleBarButtonSpy } =
        runActivate();
      const spawnOrNavigate = registerGlobalSurfaceSpy.mock.results[0].value;
      const opts = registerTitleBarButtonSpy.mock.calls[0][1] as {
        onClick: () => void;
      };
      expect(opts.onClick).toBe(spawnOrNavigate);
    });
  });
});
