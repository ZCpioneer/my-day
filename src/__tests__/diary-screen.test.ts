import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import DiaryScreen from "@/screens/DiaryScreen.vue";
import { localDate, monthLabel, weekdayLabel } from "@/dates";
import type { DailyLog, WeeklyLog } from "@/types";

function mkLog(date: string, state: string, over: Partial<DailyLog> = {}): DailyLog {
  return {
    date,
    state,
    updatedAt: `${date}T12:00:00.000Z`,
    ...over,
  };
}

function mkWeekly(): WeeklyLog {
  return {
    week: "2026-W37",
    from: "2026-09-07",
    to: "2026-09-13",
    done: "做完了解析层",
    undone: "周报剩一点",
    next: "下周先收周报",
    updatedAt: "2026-09-13T12:00:00.000Z",
  };
}

describe("DiaryScreen", () => {
  it("emits compose from 整理成日记 and disables while composing", async () => {
    const w = mount(DiaryScreen, { props: { daily: null, pastLogs: [] } });
    expect(w.text()).toContain("整理成日记");
    expect(w.text()).toContain("明天打开会补上昨天");
    expect(w.text()).not.toContain("晚");
    expect(w.text()).toContain(weekdayLabel(localDate()));
    await w.get("[data-diary-compose]").trigger("click");
    expect(w.emitted("compose")).toHaveLength(1);

    await w.setProps({ composing: true });
    expect(w.get("[data-diary-compose]").attributes("disabled")).toBeDefined();
  });

  it("已有今天日记时底栏是重新整理", () => {
    const w = mount(DiaryScreen, { props: { daily: mkLog("2026-09-07", "今天还行"), pastLogs: [] } });
    expect(w.get("[data-diary-compose]").text()).toBe("重新整理");
  });

  it("历史按月分组，默认露出摘要，点开才见寄语和编辑", async () => {
    const w = mount(DiaryScreen, {
      props: {
        daily: mkLog("2026-09-06", "今天还行"),
        pastLogs: [
          mkLog("2026-09-05", "昨天挺累", { cheer: "早点睡" }),
          mkLog("2026-09-04", "前天平静", { cheer: "稳住" }),
        ],
      },
    });
    expect(w.text()).toContain("9月");
    expect(w.text()).not.toContain("以往");
    expect(w.text()).toContain("昨天挺累");
    expect(w.text()).toContain("前天平静");
    expect(w.text()).not.toContain("早点睡");
    expect(w.text()).not.toContain("早计划");
    expect(w.get('[data-log-day="2026-09-05"]').find("[data-log-edit]").exists()).toBe(false);

    await w.get('[data-log-day="2026-09-05"]').trigger("click");
    expect(w.text()).toContain("早点睡");
    expect(w.text()).not.toContain("稳住");

    await w.get('[data-log-day="2026-09-05"]').trigger("click");
    expect(w.text()).not.toContain("早点睡");
  });

  it("跨月历史出现月标题", () => {
    const w = mount(DiaryScreen, {
      props: {
        daily: mkLog("2026-09-01", "今天"),
        pastLogs: [mkLog("2026-08-31", "八月最后")],
      },
    });
    expect(w.text()).toContain(monthLabel("2026-08-31"));
    expect(w.text()).toContain("八月最后");
  });

  it("周报区：未生成时显示「生成本周周报」，点击 emit composeWeekly", async () => {
    const w = mount(DiaryScreen, { props: { daily: mkLog("2026-09-07", "今天还行"), pastLogs: [], weekly: null } });
    const btn = w.get("[data-weekly-compose]");
    expect(btn.text()).toContain("生成本周周报");
    await btn.trigger("click");
    expect(w.emitted("composeWeekly")).toHaveLength(1);
  });

  it("周报区：已生成默认只显示区间，点开才见正文和重新生成", async () => {
    const w = mount(DiaryScreen, {
      props: { daily: null, pastLogs: [], weekly: mkWeekly() },
    });
    expect(w.text()).toContain("9月7日");
    expect(w.text()).toContain("9月13日");
    expect(w.text()).not.toContain("做完了解析层");
    await w.get("[data-weekly-toggle]").trigger("click");
    expect(w.text()).toContain("做完了解析层");
    expect(w.text()).toContain("下周先收周报");
    const btn = w.get("[data-weekly-compose]");
    expect(btn.text()).toContain("重新生成");
    await btn.trigger("click");
    expect(w.emitted("composeWeekly")).toHaveLength(1);
  });

  it("周报区：生成中按钮禁用，失败显示中文错误", async () => {
    const w = mount(DiaryScreen, {
      props: { daily: null, pastLogs: [], weekly: null, composingWeekly: true },
    });
    const btn = w.get("[data-weekly-compose]");
    expect(btn.text()).toContain("正在生成");
    expect(btn.attributes("disabled")).toBeDefined();

    await w.setProps({ composingWeekly: false, weeklyError: "模型这轮没回上，再说一次" });
    expect(w.get("[data-weekly-error]").text()).toContain("模型这轮没回上");
  });

  it("LogCard 保存往上转发 save", async () => {
    const daily = mkLog("2026-09-07", "旧状态");
    const w = mount(DiaryScreen, { props: { daily, pastLogs: [], weekly: null } });
    await w.get("[data-log-edit]").trigger("click");
    await w.get("[data-log-edit-state]").setValue("新状态");
    await w.get("[data-log-edit-save]").trigger("click");
    const saved = w.emitted("save");
    expect(saved).toHaveLength(1);
    expect((saved![0] as DailyLog[])[0].state).toBe("新状态");
  });
});
