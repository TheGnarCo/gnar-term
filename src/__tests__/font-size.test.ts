/**
 * Font-size store tests — zoom bounds + config round-trip.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import {
  fontSize,
  zoomIn,
  zoomOut,
  resetFontSize,
  setFontSizeFromConfig,
  DEFAULT_FONT_SIZE,
  MIN_FONT_SIZE,
  MAX_FONT_SIZE,
} from "../lib/stores/font-size";

describe("font-size store", () => {
  beforeEach(() => {
    fontSize.set(DEFAULT_FONT_SIZE);
  });

  it("starts at the default", () => {
    expect(get(fontSize)).toBe(DEFAULT_FONT_SIZE);
  });

  it("zoomIn increments by one", () => {
    zoomIn();
    expect(get(fontSize)).toBe(DEFAULT_FONT_SIZE + 1);
  });

  it("zoomOut decrements by one", () => {
    zoomOut();
    expect(get(fontSize)).toBe(DEFAULT_FONT_SIZE - 1);
  });

  it("zoomIn clamps to MAX_FONT_SIZE", () => {
    fontSize.set(MAX_FONT_SIZE);
    zoomIn();
    expect(get(fontSize)).toBe(MAX_FONT_SIZE);
  });

  it("zoomOut clamps to MIN_FONT_SIZE", () => {
    fontSize.set(MIN_FONT_SIZE);
    zoomOut();
    expect(get(fontSize)).toBe(MIN_FONT_SIZE);
  });

  it("resetFontSize returns to default from zoomed-in state", () => {
    zoomIn();
    zoomIn();
    resetFontSize();
    expect(get(fontSize)).toBe(DEFAULT_FONT_SIZE);
  });

  it("resetFontSize returns to default from zoomed-out state", () => {
    zoomOut();
    zoomOut();
    resetFontSize();
    expect(get(fontSize)).toBe(DEFAULT_FONT_SIZE);
  });

  describe("setFontSizeFromConfig", () => {
    it("applies a valid config value", () => {
      setFontSizeFromConfig(18);
      expect(get(fontSize)).toBe(18);
    });

    it("ignores undefined", () => {
      fontSize.set(16);
      setFontSizeFromConfig(undefined);
      expect(get(fontSize)).toBe(16);
    });

    it("ignores NaN", () => {
      fontSize.set(16);
      setFontSizeFromConfig(Number.NaN);
      expect(get(fontSize)).toBe(16);
    });

    it("clamps below MIN_FONT_SIZE", () => {
      setFontSizeFromConfig(2);
      expect(get(fontSize)).toBe(MIN_FONT_SIZE);
    });

    it("clamps above MAX_FONT_SIZE", () => {
      setFontSizeFromConfig(999);
      expect(get(fontSize)).toBe(MAX_FONT_SIZE);
    });
  });
});
