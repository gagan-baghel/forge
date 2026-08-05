import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// jsdom lacks a few browser APIs the app touches; stub the minimum.
beforeEach(() => {
  localStorage.clear();
  if (!window.matchMedia) {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
  }
  if (!Element.prototype.scrollTo) {
    Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
  }
  if (!navigator.clipboard) {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
