import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import SettingsScreen from "@/screens/SettingsScreen.vue";
import { DEFAULT_MODEL } from "@/types";

describe("SettingsScreen 语音", () => {
  it("只留一个百炼 Key，不再有 APP Key / Action Token", () => {
    const w = mount(SettingsScreen, {
      props: {
        settings: { apiKey: "", model: DEFAULT_MODEL, daySplitHour: 12, asrAppKey: "" },
      },
    });
    const text = w.text();
    expect(text).toContain("语音 API Key");
    expect(text).not.toContain("语音识别 API Key");
    expect(text).toContain("阿里云百炼");
    expect(text).not.toContain("APP Key");
    expect(text).not.toContain("Action Token");
    expect(text).not.toContain("豆包");
    expect(w.findAll("input[type=password]")).toHaveLength(2);
  });

  it("保存 emit 当前草稿", async () => {
    const w = mount(SettingsScreen, {
      props: {
        settings: { apiKey: "", model: DEFAULT_MODEL, daySplitHour: 12, asrAppKey: "" },
      },
    });
    await w.get("input[type=password]").setValue("sk-user");
    await w.get("select").setValue("deepseek-v4-pro");
    await w.get("input[type=number]").setValue("18");
    await w.get(".btn-save").trigger("click");
    expect(w.emitted("save")?.[0]?.[0]).toEqual({
      apiKey: "sk-user",
      model: "deepseek-v4-pro",
      daySplitHour: 18,
      asrAppKey: "",
    });
  });

  it("分界小时不是有限数字时 emit 12", async () => {
    const w = mount(SettingsScreen, {
      props: {
        settings: { apiKey: "", model: DEFAULT_MODEL, daySplitHour: Number.NaN, asrAppKey: "" },
      },
    });
    await w.get(".btn-save").trigger("click");
    expect((w.emitted("save")?.[0]?.[0] as { daySplitHour: number }).daySplitHour).toBe(12);
  });
});
