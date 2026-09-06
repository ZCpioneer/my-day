import { describe, it, expect } from "vitest";
import { applyKeyboardInset, keyboardInsetPx } from "@/keyboard-inset";

describe("keyboardInsetPx", () => {
  it("is the gap between layout height and visible height", () => {
    expect(keyboardInsetPx(800, 500)).toBe(300);
    expect(keyboardInsetPx(800, 800)).toBe(0);
    expect(keyboardInsetPx(500, 800)).toBe(0);
  });
});

describe("applyKeyboardInset", () => {
  it("sets --kb and marks the document when the keyboard is open", () => {
    const root = document.createElement("html");
    applyKeyboardInset(root, 320);
    expect(root.style.getPropertyValue("--kb")).toBe("320px");
    expect(root.classList.contains("kb-open")).toBe(true);
    applyKeyboardInset(root, 0);
    expect(root.classList.contains("kb-open")).toBe(false);
  });
});
