/**
 * Tests for UI store prompt functions — showInputPrompt and showFormPrompt
 */
import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import {
  inputPrompt,
  showInputPrompt,
  formPrompt,
  showFormPrompt,
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
