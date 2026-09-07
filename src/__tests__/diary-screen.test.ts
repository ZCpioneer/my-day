import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import DiaryScreen from "@/screens/DiaryScreen.vue";
import type { DailyLog } from "@/types";

function mkLog(date: string, state: string): DailyLog {
  return {
    date,
    plan: `${date} 的计划`,
    done: [],
    undone: [],
    state,
    updatedAt: `${date}T12:00:00.000Z`,
  };
}

describe("DiaryScreen", () => {
  it("emits compose from 整理成日记 and disables while composing", async () => {
    const w = mount(DiaryScreen, { props: { daily: null, pastLogs: [] } });
    expect(w.text()).toContain("整理成日记");
    expect(w.text()).toContain("明天打开会补上昨天");
    await w.get("[data-diary-compose]").trigger("click");
    expect(w.emitted("compose")).toHaveLength(1);

    await w.setProps({ composing: true });
    expect(w.get("[data-diary-compose]").attributes("disabled")).toBeDefined();
  });

  it("以往日记默认折叠只显示日期，点击展开再点收起", async () => {
    const w = mount(DiaryScreen, {
      props: {
        daily: mkLog("2026-09-06", "今天还行"),
        pastLogs: [mkLog("2026-09-05", "昨天挺累"), mkLog("2026-09-04", "前天平静")],
      },
    });
    expect(w.text()).toContain("记每一天");
    expect(w.text()).toContain("以往");
    expect(w.text()).toContain("9月5日");
    expect(w.text()).toContain("9月4日");
    expect(w.text()).not.toContain("昨天挺累");

    await w.get('[data-log-day="2026-09-05"]').trigger("click");
    expect(w.text()).toContain("昨天挺累");
    expect(w.text()).toContain("2026-09-05 的计划");
    expect(w.text()).not.toContain("前天平静");
    const bare = w.find(".log-card--bare");
    expect(bare.exists()).toBe(true);
    expect(bare.find("h3").exists()).toBe(false);

    await w.get('[data-log-day="2026-09-05"]').trigger("click");
    expect(w.text()).not.toContain("昨天挺累");
  });
});
