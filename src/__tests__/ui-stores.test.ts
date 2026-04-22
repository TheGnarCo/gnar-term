/**
 * Tests for UI store prompt functions — showInputPrompt, showFormPrompt, showConfirmPrompt
 */
import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import {
  inputPrompt,
  showInputPrompt,
  formPrompt,
  showFormPrompt,
  confirmPrompt,
  showConfirmPrompt,
  type FormField,
} from "../lib/stores/ui";

describe("showInputPrompt", () => {
  beforeEach(() => {
    inputPrompt.set(null);
  });

  it("sets inputPrompt store with placeholder and resolve", () => {
    showInputPrompt("Enter name");

    const state = get(inputPrompt);
    expect(state).not.toBeNull();
    expect(state!.placeholder).toBe("Enter name");
    expect(state!.defaultValue).toBeUndefined();
    expect(typeof state!.resolve).toBe("function");
  });

  it("sets inputPrompt store with placeholder and defaultValue", () => {
    showInputPrompt("Enter name", "default");

    const state = get(inputPrompt);
    expect(state!.placeholder).toBe("Enter name");
    expect(state!.defaultValue).toBe("default");
  });

  it("resolves with value when resolve is called", async () => {
    const promise = showInputPrompt("Enter name");

    const state = get(inputPrompt);
    state!.resolve("typed value");

    const result = await promise;
    expect(result).toBe("typed value");
  });

  it("resolves with null when resolve is called with null", async () => {
    const promise = showInputPrompt("Enter name");

    const state = get(inputPrompt);
    state!.resolve(null);

    const result = await promise;
    expect(result).toBeNull();
  });
});

describe("showFormPrompt", () => {
  beforeEach(() => {
    formPrompt.set(null);
  });

  const fields: FormField[] = [
    { key: "name", label: "Name", placeholder: "Enter name" },
    { key: "email", label: "Email", defaultValue: "test@example.com" },
  ];

  it("sets formPrompt store with title, fields, and resolve", () => {
    showFormPrompt("Create User", fields);

    const state = get(formPrompt);
    expect(state).not.toBeNull();
    expect(state!.title).toBe("Create User");
    expect(state!.fields).toEqual(fields);
    expect(typeof state!.resolve).toBe("function");
  });

  it("resolves with form values when resolve is called", async () => {
    const promise = showFormPrompt("Create User", fields);

    const state = get(formPrompt);
    state!.resolve({ name: "Alice", email: "alice@example.com" });

    const result = await promise;
    expect(result).toEqual({ name: "Alice", email: "alice@example.com" });
  });

  it("resolves with null when cancelled", async () => {
    const promise = showFormPrompt("Create User", fields);

    const state = get(formPrompt);
    state!.resolve(null);

    const result = await promise;
    expect(result).toBeNull();
  });
});

describe("showConfirmPrompt", () => {
  beforeEach(() => {
    confirmPrompt.set(null);
  });

  it("sets confirmPrompt store with message and resolve", () => {
    showConfirmPrompt("Are you sure?");

    const state = get(confirmPrompt);
    expect(state).not.toBeNull();
    expect(state!.message).toBe("Are you sure?");
    expect(typeof state!.resolve).toBe("function");
  });

  it("uses default confirm/cancel labels when not specified", () => {
    showConfirmPrompt("Are you sure?");

    const state = get(confirmPrompt);
    expect(state!.confirmLabel).toBe("Confirm");
    expect(state!.cancelLabel).toBe("Cancel");
  });

  it("uses provided title and labels", () => {
    showConfirmPrompt("Close this workspace?", {
      title: "Close Workspace",
      confirmLabel: "Close",
      cancelLabel: "Keep Open",
      danger: true,
    });

    const state = get(confirmPrompt);
    expect(state!.title).toBe("Close Workspace");
    expect(state!.confirmLabel).toBe("Close");
    expect(state!.cancelLabel).toBe("Keep Open");
    expect(state!.danger).toBe(true);
  });

  it("resolves with true when confirmed", async () => {
    const promise = showConfirmPrompt("Are you sure?");

    const state = get(confirmPrompt);
    state!.resolve(true);

    const result = await promise;
    expect(result).toBe(true);
  });

  it("resolves with false when cancelled", async () => {
    const promise = showConfirmPrompt("Are you sure?");

    const state = get(confirmPrompt);
    state!.resolve(false);

    const result = await promise;
    expect(result).toBe(false);
  });
});
