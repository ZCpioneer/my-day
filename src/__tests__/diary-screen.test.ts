import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import DiaryScreen from "@/screens/DiaryScreen.vue";

describe("DiaryScreen", () => {
  it("emits compose from 整理成日记 and disables while composing", async () => {
    const w = mount(DiaryScreen, { props: { daily: null, date: "2026-09-05" } });
    expect(w.text()).toContain("整理成日记");
    expect(w.text()).toContain("明天打开会补上昨天");
    await w.get("[data-diary-compose]").trigger("click");
    expect(w.emitted("compose")).toHaveLength(1);

    await w.setProps({ composing: true });
    expect(w.get("[data-diary-compose]").attributes("disabled")).toBeDefined();
  });
});
