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
});
