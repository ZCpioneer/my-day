import { describe, expect, it, vi } from "vitest";
import { createNotifier, listenNotificationOpen } from "@/notify-capacitor";

describe("notify-capacitor 非原生", () => {
  it("createNotifier 在 web/测试里 cancelAll 和 schedule 不抛", async () => {
    const n = createNotifier();
    await expect(n.cancelAll()).resolves.toBeUndefined();
    await expect(n.schedule([])).resolves.toBeUndefined();
    await expect(
      n.schedule([{ id: 1, title: "该办了", body: "交房租", at: new Date(2099, 0, 1) }]),
    ).resolves.toBeUndefined();
  });

  it("listenNotificationOpen 返回可调用的卸载函数，且不触发 onOpen", () => {
    const onOpen = vi.fn();
    const stop = listenNotificationOpen(onOpen);
    expect(typeof stop).toBe("function");
    stop();
    stop();
    expect(onOpen).not.toHaveBeenCalled();
  });
});
