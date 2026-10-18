import { describe, it, expect } from "vitest";
import { applyKeyboardInset, keyboardInsetPx, startKeyboardInset } from "@/keyboard-inset";

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

describe("startKeyboardInset", () => {
  it("没有 visualViewport 仍写 --kb，返回空卸载", () => {
    const root = document.createElement("html");
    const win = {
      innerHeight: 800,
      scrollTo: () => {},
      visualViewport: null as unknown as VisualViewport | null,
    };
    const stop = startKeyboardInset(win as unknown as Window, root);
    expect(root.style.getPropertyValue("--kb")).toBe("0px");
    expect(typeof stop).toBe("function");
    stop();
    expect(root.style.getPropertyValue("--kb")).toBe("0px");
  });

  it("有 vv 时 resize 更新 inset，卸载清零并摘掉监听", () => {
    const root = document.createElement("html");
    const listeners = new Map<string, () => void>();
    const vv = {
      height: 500,
      addEventListener: (type: string, fn: () => void) => {
        listeners.set(type, fn);
      },
      removeEventListener: (type: string) => {
        listeners.delete(type);
      },
    };
    const win = {
      innerHeight: 800,
      scrollTo: () => {},
      visualViewport: vv,
    };
    const stop = startKeyboardInset(win as unknown as Window, root);
    expect(root.style.getPropertyValue("--kb")).toBe("300px");
    expect(root.classList.contains("kb-open")).toBe(true);
    vv.height = 800;
    listeners.get("resize")?.();
    expect(root.style.getPropertyValue("--kb")).toBe("0px");
    stop();
    expect(listeners.size).toBe(0);
    expect(root.style.getPropertyValue("--kb")).toBe("0px");
    expect(root.classList.contains("kb-open")).toBe(false);
  });
});
