import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import App from "@/App.vue";

describe("ritual visibility", () => {
  it("shows 自动整理待办 only on chat tab", async () => {
    const w = mount(App);
    expect(w.text()).toContain("自动整理待办");
    await w.get("[data-nav=todo]").trigger("click");
    expect(w.text()).not.toContain("自动整理待办");
    await w.get("[data-nav=chat]").trigger("click");
    expect(w.text()).toContain("自动整理待办");
  });

  it("shows 整理成日记 on the diary tab and keeps 自动整理待办 on chat", async () => {
    const w = mount(App);
    expect(w.text()).toContain("自动整理待办");
    expect(w.text()).toContain("确认这次整理后这段会清掉，可以重新聊");
    await w.get("[data-nav=diary]").trigger("click");
    expect(w.text()).toContain("整理成日记");
    expect(w.text()).not.toContain("自动整理待办");
    await w.get("[data-nav=chat]").trigger("click");
    expect(w.text()).toContain("自动整理待办");
  });

  it("keeps debug off the chat screen and opens settings from the gear", async () => {
    const w = mount(App);
    expect(w.find(".debug-panel").exists()).toBe(false);
    expect(w.get("[data-nav=settings]").text()).toContain("设置");
    await w.get("[data-nav=settings]").trigger("click");
    expect(w.text()).toContain("DeepSeek API Key");
    expect(w.text()).toContain("调试日志");
    expect(w.find(".debug-panel").exists()).toBe(true);
  });
});
