/**
 * Settings → Agents tab tests.
 *
 * SettingsAgentsTab is a controlled component: it renders `presets` and
 * emits the next array to `onChange`. The parent (SettingsPanel) owns the
 * draft + the saveConfig wiring. These tests verify the tab's row-level
 * edit/add/delete behaviors against the AgentPreset shape.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/svelte";
import type { AgentPreset } from "../lib/agents-config";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

import SettingsAgentsTab from "../lib/components/SettingsAgentsTab.svelte";

function lastCallArg(spy: ReturnType<typeof vi.fn>): AgentPreset[] {
  const calls = spy.mock.calls;
  return calls[calls.length - 1]?.[0] as AgentPreset[];
}

describe("SettingsAgentsTab", () => {
  beforeEach(() => {
    cleanup();
  });

  it("renders one row per preset with name + command + autoSpawn", () => {
    const presets: AgentPreset[] = [
      { name: "Claude", command: "claude --model opus", autoSpawn: true },
      { name: "Codex", command: "codex", intendedAgent: "codex" },
    ];

    const { container } = render(SettingsAgentsTab, {
      props: { presets, onChange: vi.fn() },
    });

    const rows = container.querySelectorAll("[data-preset-row]");
    expect(rows).toHaveLength(2);
    expect(rows[0].getAttribute("data-preset-name")).toBe("Claude");
    expect(rows[1].getAttribute("data-preset-name")).toBe("Codex");

    const autoSpawnInputs = container.querySelectorAll(
      '[data-field="autoSpawn"]',
    ) as NodeListOf<HTMLInputElement>;
    expect(autoSpawnInputs[0].checked).toBe(true);
    expect(autoSpawnInputs[1].checked).toBe(false);
  });

  it("shows empty state when there are no presets", () => {
    const { container } = render(SettingsAgentsTab, {
      props: { presets: [], onChange: vi.fn() },
    });
    expect(container.textContent).toContain("No agent presets yet");
    expect(container.querySelectorAll("[data-preset-row]")).toHaveLength(0);
  });

  it("emits a new preset on Add Preset click", async () => {
    const onChange = vi.fn();
    const { container } = render(SettingsAgentsTab, {
      props: { presets: [], onChange },
    });

    const addBtn = container.querySelector(
      '[data-action="add-preset"]',
    ) as HTMLButtonElement;
    await fireEvent.click(addBtn);

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = lastCallArg(onChange);
    expect(next).toHaveLength(1);
    expect(next[0].name).toBe("New Preset");
    expect(next[0].command).toBe("");
  });

  it("uniquifies default names when adding multiple presets", async () => {
    const onChange = vi.fn();
    const { container } = render(SettingsAgentsTab, {
      props: {
        presets: [{ name: "New Preset", command: "" }],
        onChange,
      },
    });

    const addBtn = container.querySelector(
      '[data-action="add-preset"]',
    ) as HTMLButtonElement;
    await fireEvent.click(addBtn);

    const next = lastCallArg(onChange);
    expect(next).toHaveLength(2);
    expect(next[1].name).toBe("New Preset 2");
  });

  it("removes the right row on delete", async () => {
    const onChange = vi.fn();
    const presets: AgentPreset[] = [
      { name: "Keep", command: "a" },
      { name: "Drop", command: "b" },
      { name: "Also Keep", command: "c" },
    ];
    const { container } = render(SettingsAgentsTab, {
      props: { presets, onChange },
    });

    const deleteButtons = container.querySelectorAll(
      '[data-action="delete-preset"]',
    );
    await fireEvent.click(deleteButtons[1] as HTMLButtonElement);

    const next = lastCallArg(onChange);
    expect(next.map((p) => p.name)).toEqual(["Keep", "Also Keep"]);
  });

  it("propagates command edits via onChange", async () => {
    const onChange = vi.fn();
    const { container } = render(SettingsAgentsTab, {
      props: {
        presets: [{ name: "Claude", command: "claude" }],
        onChange,
      },
    });

    const cmdInput = container.querySelector(
      '[data-field="command"]',
    ) as HTMLInputElement;
    await fireEvent.input(cmdInput, {
      target: { value: "claude --model opus" },
    });

    const next = lastCallArg(onChange);
    expect(next[0].command).toBe("claude --model opus");
  });

  it("toggling autoSpawn sets true; unchecking clears the field", async () => {
    const onChange = vi.fn();
    const { container, rerender } = render(SettingsAgentsTab, {
      props: {
        presets: [{ name: "Claude", command: "claude" }],
        onChange,
      },
    });

    let autoSpawn = container.querySelector(
      '[data-field="autoSpawn"]',
    ) as HTMLInputElement;
    await fireEvent.click(autoSpawn);

    let next = lastCallArg(onChange);
    expect(next[0].autoSpawn).toBe(true);

    // Re-render with the new state and toggle off
    await rerender({
      presets: next,
      onChange,
    });
    autoSpawn = container.querySelector(
      '[data-field="autoSpawn"]',
    ) as HTMLInputElement;
    await fireEvent.click(autoSpawn);

    next = lastCallArg(onChange);
    expect(next[0].autoSpawn).toBeUndefined();
  });

  it("intendedAgent select round-trips claude/codex/aider/empty", async () => {
    const onChange = vi.fn();
    const { container } = render(SettingsAgentsTab, {
      props: {
        presets: [{ name: "Claude", command: "claude" }],
        onChange,
      },
    });

    const select = container.querySelector(
      '[data-field="intendedAgent"]',
    ) as HTMLSelectElement;
    await fireEvent.change(select, { target: { value: "claude" } });
    expect(lastCallArg(onChange)[0].intendedAgent).toBe("claude");

    await fireEvent.change(select, { target: { value: "" } });
    expect(lastCallArg(onChange)[0].intendedAgent).toBeUndefined();
  });

  it("adds and removes env entries", async () => {
    const onChange = vi.fn();
    const { container, rerender } = render(SettingsAgentsTab, {
      props: {
        presets: [{ name: "Claude", command: "claude" }],
        onChange,
      },
    });

    const addEnv = container.querySelector(
      '[data-action="add-env"]',
    ) as HTMLButtonElement;
    await fireEvent.click(addEnv);
    let next = lastCallArg(onChange);
    expect(next[0].env).toEqual({ VAR: "" });

    await rerender({ presets: next, onChange });

    const keyInput = container.querySelector(
      '[data-field="env-key"]',
    ) as HTMLInputElement;
    await fireEvent.change(keyInput, { target: { value: "CLAUDE_MODEL" } });
    next = lastCallArg(onChange);
    expect(next[0].env).toEqual({ CLAUDE_MODEL: "" });

    await rerender({ presets: next, onChange });

    const valueInput = container.querySelector(
      '[data-field="env-value"]',
    ) as HTMLInputElement;
    await fireEvent.input(valueInput, { target: { value: "opus" } });
    next = lastCallArg(onChange);
    expect(next[0].env).toEqual({ CLAUDE_MODEL: "opus" });

    await rerender({ presets: next, onChange });

    const removeBtn = container.querySelector(
      '[data-action="remove-env"]',
    ) as HTMLButtonElement;
    await fireEvent.click(removeBtn);
    next = lastCallArg(onChange);
    expect(next[0].env).toBeUndefined();
  });

  it("editing initialPrompt clears it when emptied", async () => {
    const onChange = vi.fn();
    const { container } = render(SettingsAgentsTab, {
      props: {
        presets: [{ name: "Claude", command: "claude", initialPrompt: "hi" }],
        onChange,
      },
    });

    const textarea = container.querySelector(
      '[data-field="initialPrompt"]',
    ) as HTMLTextAreaElement;
    await fireEvent.input(textarea, { target: { value: "" } });

    expect(lastCallArg(onChange)[0].initialPrompt).toBeUndefined();
  });
});
