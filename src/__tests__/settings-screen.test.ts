import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import SettingsScreen from "@/screens/SettingsScreen.vue";
import type { Memory, Settings } from "@/types";

const settings: Settings = { apiKey: "", model: "deepseek-v4-flash", debugOverlay: false, daySplitHour: 12 };
const memories: Memory[] = [
  { id: "m1", text: "早上不开会", kind: "preference", createdAt: "2026-09-06T01:00:00.000Z" },
  { id: "m2", text: "今年写完初稿", kind: "goal", createdAt: "2026-09-06T02:00:00.000Z" },
];

describe("SettingsScreen 长期记忆", () => {
  it("列出记忆（含类别标签），点删除发出 removeMemory", async () => {
    const w = mount(SettingsScreen, { props: { settings, memories } });
    expect(w.text()).toContain("长期记忆");
    expect(w.text()).toContain("偏好");
    expect(w.text()).toContain("早上不开会");
    expect(w.text()).toContain("目标");
    const delButtons = w.findAll("[data-memory-del]");
    expect(delButtons).toHaveLength(2);
    await delButtons[0].trigger("click");
    expect(w.emitted("removeMemory")?.[0]).toEqual(["m1"]);
  });

  it("没有记忆时不渲染该区块", () => {
    const w = mount(SettingsScreen, { props: { settings, memories: [] } });
    expect(w.text()).not.toContain("长期记忆");
  });
});
