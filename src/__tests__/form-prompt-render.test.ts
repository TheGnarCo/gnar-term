/**
 * Diagnostic: FormPrompt must render the dialog when a root-context
 * new-dashboard form is shown (no locked fields). Regression-guards
 * against the reported "base New Agent Dashboard launches nothing"
 * behavior — if FormPrompt renders here, the bug is environmental
 * (stale dev-server bundle) rather than a code defect.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/svelte";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(async () => null),
}));

import FormPrompt from "../lib/components/FormPrompt.svelte";
import { formPrompt } from "../lib/stores/ui";

describe("FormPrompt rendering", () => {
  beforeEach(() => {
    cleanup();
    formPrompt.set(null);
  });

  it("renders a dialog with all fields when fired in root mode (directory + name + color)", () => {
    formPrompt.set({
      title: "New Agent Dashboard",
      fields: [
        {
          key: "baseDir",
          label: "Base directory",
          type: "directory",
          required: true,
          defaultValue: "",
          pickerTitle: "Select",
          placeholder: "Pick a folder...",
        },
        {
          key: "name",
          label: "Name",
          defaultValue: "Agent Dashboard",
          placeholder: "Agent Dashboard",
        },
        {
          key: "color",
          label: "Color",
          type: "color",
          defaultValue: "purple",
        },
      ],
      resolve: () => {},
    });

    const { container } = render(FormPrompt);
    // Dialog title present.
    expect(container.textContent).toContain("New Agent Dashboard");
    // All three fields render their labels.
    expect(container.textContent).toContain("Base directory");
    expect(container.textContent).toContain("Name");
    expect(container.textContent).toContain("Color");
    // Browse button is visible (directory is not readonly).
    expect(container.querySelectorAll("button").length).toBeGreaterThan(0);
  });

  it("renders select options inside <optgroup> elements when options carry a group tag", () => {
    formPrompt.set({
      title: "New agentic branch",
      fields: [
        {
          key: "base",
          label: "Source branch",
          type: "select",
          defaultValue: "feat/agentic-core-refresh",
          options: [
            {
              label: "feat/agentic-core-refresh (current)",
              value: "feat/agentic-core-refresh",
              group: "Local",
            },
            {
              label: "chore/lint-pass",
              value: "chore/lint-pass",
              group: "Local",
            },
            {
              label: "origin/dependabot/bump-vite",
              value: "origin/dependabot/bump-vite",
              group: "Remote",
            },
            {
              label: "spike/rust-color-pipeline",
              value: "spike/rust-color-pipeline",
              group: "Worktrees",
            },
          ],
        },
      ],
      resolve: () => {},
    });

    const { container } = render(FormPrompt);
    const optgroups = Array.from(container.querySelectorAll("optgroup"));
    const labels = optgroups.map((og) => og.getAttribute("label"));

    // Three groups render, in caller-supplied order (locals first, worktrees last).
    expect(labels).toEqual(["Local", "Remote", "Worktrees"]);

    // Worktree section sits after the local + remote sections.
    expect(labels.indexOf("Worktrees")).toBeGreaterThan(
      labels.indexOf("Local"),
    );
    expect(labels.indexOf("Worktrees")).toBeGreaterThan(
      labels.indexOf("Remote"),
    );
  });

  it("renders just the name field when fired in project mode", () => {
    formPrompt.set({
      title: "New Agent Dashboard",
      fields: [
        {
          key: "name",
          label: "Name",
          defaultValue: "Agent Dashboard",
          placeholder: "Agent Dashboard",
        },
      ],
      resolve: () => {},
    });

    const { container } = render(FormPrompt);
    expect(container.textContent).toContain("New Agent Dashboard");
    expect(container.textContent).toContain("Name");
    expect(container.textContent).not.toContain("Base directory");
    expect(container.textContent).not.toContain("Color");
  });
});
