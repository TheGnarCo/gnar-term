/**
 * RenameableLabel — extracted contentEditable label that powers inline
 * rename for workspace items and workspace section banner titles. The
 * tests cover the contract that callers depend on:
 *   - startRename() makes the span contentEditable and selects all text
 *   - finishRename calls onCommit with the trimmed new value when changed
 *   - empty / unchanged input is treated as a cancel (no commit)
 *   - Escape restores the previous value without committing
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/svelte";
import { tick } from "svelte";
import RenameableLabel from "../lib/components/RenameableLabel.svelte";

afterEach(() => {
  cleanup();
});

function getLabel(container: HTMLElement): HTMLSpanElement {
  const el = container.querySelector('[role="textbox"]');
  if (!el) throw new Error("RenameableLabel span not found");
  return el as HTMLSpanElement;
}

describe("RenameableLabel", () => {
  it("renders the value and an aria-label for screen readers", () => {
    const onCommit = vi.fn();
    const { container } = render(RenameableLabel, {
      props: {
        value: "alpha",
        onCommit,
        ariaLabel: "Workspace name",
      },
    });
    const span = getLabel(container);
    expect(span.textContent).toBe("alpha");
    expect(span.getAttribute("aria-label")).toBe("Workspace name");
    expect(span.contentEditable).not.toBe("true");
  });

  it("startRename enables contentEditable and focuses", async () => {
    const onCommit = vi.fn();
    const result = render(RenameableLabel, {
      props: { value: "alpha", onCommit, ariaLabel: "n" },
    });
    const inst = result.component as unknown as {
      startRename: () => Promise<void>;
    };
    await inst.startRename();
    const span = getLabel(result.container);
    expect(span.contentEditable).toBe("true");
    expect(document.activeElement).toBe(span);
  });

  it("commits the trimmed new value on blur when changed", async () => {
    const onCommit = vi.fn();
    const result = render(RenameableLabel, {
      props: { value: "alpha", onCommit, ariaLabel: "n" },
    });
    const inst = result.component as unknown as {
      startRename: () => Promise<void>;
    };
    await inst.startRename();
    const span = getLabel(result.container);
    span.textContent = "  beta  ";
    await fireEvent.blur(span);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("beta");
  });

  it("does not commit when the value is empty or unchanged", async () => {
    const onCommit = vi.fn();
    const result = render(RenameableLabel, {
      props: { value: "alpha", onCommit, ariaLabel: "n" },
    });
    const inst = result.component as unknown as {
      startRename: () => Promise<void>;
    };
    await inst.startRename();
    const span = getLabel(result.container);
    span.textContent = "   ";
    await fireEvent.blur(span);
    expect(onCommit).not.toHaveBeenCalled();
    expect(span.textContent).toBe("alpha");

    await inst.startRename();
    span.textContent = "alpha";
    await fireEvent.blur(span);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("Escape restores the original value and ends edit mode without committing", async () => {
    const onCommit = vi.fn();
    const result = render(RenameableLabel, {
      props: { value: "alpha", onCommit, ariaLabel: "n" },
    });
    const inst = result.component as unknown as {
      startRename: () => Promise<void>;
    };
    await inst.startRename();
    const span = getLabel(result.container);
    span.textContent = "garbage";
    await fireEvent.keyDown(span, { key: "Escape" });
    await tick();
    expect(onCommit).not.toHaveBeenCalled();
    expect(span.textContent).toBe("alpha");
    expect(span.contentEditable).toBe("false");
  });

  it("Enter commits the current text via blur", async () => {
    const onCommit = vi.fn();
    const result = render(RenameableLabel, {
      props: { value: "alpha", onCommit, ariaLabel: "n" },
    });
    const inst = result.component as unknown as {
      startRename: () => Promise<void>;
    };
    await inst.startRename();
    const span = getLabel(result.container);
    span.textContent = "gamma";
    await fireEvent.keyDown(span, { key: "Enter" });
    await tick();
    expect(onCommit).toHaveBeenCalledWith("gamma");
  });
});
