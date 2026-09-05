import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import App from "@/App.vue";

describe("ritual visibility", () => {
  it("shows 朝/暮 only on chat tab", async () => {
    const w = mount(App);
    expect(w.text()).toContain("开始今天");
    expect(w.text()).toContain("回顾今天");
    await w.get("[data-nav=todo]").trigger("click");
    expect(w.text()).not.toContain("开始今天");
    await w.get("[data-nav=chat]").trigger("click");
    expect(w.text()).toContain("开始今天");
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
