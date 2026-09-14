import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import LogCard from "@/components/LogCard.vue";
import type { DailyLog } from "@/types";

function mkLog(over: Partial<DailyLog> = {}): DailyLog {
  return {
    date: "2026-09-07",
    state: "今天还行",
    updatedAt: "2026-09-07T12:00:00.000Z",
    ...over,
  };
}

describe("LogCard 展示", () => {
  it("今天报头带 kicker、日期和星期，情绪在报头", () => {
    const w = mount(LogCard, {
      props: { log: mkLog({ mood: "😮‍💨", cheer: "辛苦了" }), kicker: "今天" },
    });
    expect(w.text()).toContain("今天");
    expect(w.text()).toContain("9月7日");
    expect(w.text()).toContain("周一");
    expect(w.get("[data-log-mood]").text()).toBe("😮‍💨");
    expect(w.get("[data-log-state]").text()).toBe("今天还行");
    expect(w.get("[data-log-cheer]").text()).toBe("辛苦了");
    expect(w.text()).not.toContain("早计划");
    expect(w.text()).not.toContain("做成了");
    expect(w.find("h3").exists()).toBe(false);
  });

  it("历史报头是日序号+星期，不重复月份", () => {
    const w = mount(LogCard, { props: { log: mkLog(), collapsible: true, collapsed: true } });
    expect(w.get("[data-log-day]").attributes("data-log-day")).toBe("2026-09-07");
    expect(w.text()).toContain("7日");
    expect(w.text()).toContain("周一");
    expect(w.text()).not.toContain("9月7日");
  });

  it("旧日记没有 mood/cheer 时不渲染寄语块", () => {
    const w = mount(LogCard, { props: { log: mkLog() } });
    expect(w.find("[data-log-mood]").exists()).toBe(false);
    expect(w.find("[data-log-cheer]").exists()).toBe(false);
  });
});

describe("LogCard 折叠", () => {
  it("收起时露出正文、藏寄语和编辑", () => {
    const w = mount(LogCard, {
      props: {
        log: mkLog({ cheer: "早点休息" }),
        collapsible: true,
        collapsed: true,
      },
    });
    expect(w.get("[data-log-state]").text()).toBe("今天还行");
    expect(w.find("[data-log-cheer]").exists()).toBe(false);
    expect(w.find("[data-log-edit]").exists()).toBe(false);
    expect(w.get("[data-log-day]").attributes("aria-expanded")).toBe("false");
  });

  it("展开后寄语和编辑出现", () => {
    const w = mount(LogCard, {
      props: {
        log: mkLog({ cheer: "早点休息" }),
        collapsible: true,
        collapsed: false,
      },
    });
    expect(w.get("[data-log-cheer]").text()).toBe("早点休息");
    expect(w.find("[data-log-edit]").exists()).toBe(true);
    expect(w.get("[data-log-day]").attributes("aria-expanded")).toBe("true");
  });

  it("点卡片 emit toggle；点编辑不 toggle", async () => {
    const w = mount(LogCard, {
      props: { log: mkLog({ cheer: "寄" }), collapsible: true, collapsed: false },
    });
    await w.get("[data-log-day]").trigger("click");
    expect(w.emitted("toggle")).toHaveLength(1);
    await w.get("[data-log-edit]").trigger("click");
    expect(w.emitted("toggle")).toHaveLength(1);
  });
});

describe("LogCard 编辑", () => {
  it("点编辑载入现文，保存 emit 更新后的日志", async () => {
    const w = mount(LogCard, { props: { log: mkLog() } });
    await w.get("[data-log-edit]").trigger("click");
    const state = w.get<HTMLTextAreaElement>("[data-log-edit-state]");
    expect(state.element.value).toBe("今天还行");
    await state.setValue("改过的状态");
    await w.get("[data-log-edit-save]").trigger("click");
    const saved = w.emitted("save");
    expect(saved).toHaveLength(1);
    const log = (saved![0] as DailyLog[])[0];
    expect(log.state).toBe("改过的状态");
    expect(log.date).toBe("2026-09-07");
    expect(w.find("[data-log-edit-state]").exists()).toBe(false);
  });

  it("取消不 emit，恢复展示", async () => {
    const w = mount(LogCard, { props: { log: mkLog() } });
    await w.get("[data-log-edit]").trigger("click");
    await w.get("[data-log-edit-state]").setValue("写到一半");
    await w.get("[data-log-edit-cancel]").trigger("click");
    expect(w.emitted("save")).toBeUndefined();
    expect(w.find("[data-log-edit-state]").exists()).toBe(false);
    expect(w.get("[data-log-state]").text()).toBe("今天还行");
  });

  it("清空状态不允许保存", async () => {
    const w = mount(LogCard, { props: { log: mkLog() } });
    await w.get("[data-log-edit]").trigger("click");
    await w.get("[data-log-edit-state]").setValue("   ");
    expect(w.get("[data-log-edit-save]").attributes("disabled")).toBeDefined();
    await w.get("[data-log-edit-save]").trigger("click");
    expect(w.emitted("save")).toBeUndefined();
  });

  it("编辑可改 mood/cheer，保存带上；清空则落为 undefined", async () => {
    const w = mount(LogCard, { props: { log: mkLog({ mood: "😊", cheer: "不错" }) } });
    await w.get("[data-log-edit]").trigger("click");
    expect(w.get<HTMLInputElement>("[data-log-edit-mood]").element.value).toBe("😊");
    expect(w.get<HTMLTextAreaElement>("[data-log-edit-cheer]").element.value).toBe("不错");
    await w.get("[data-log-edit-mood]").setValue("🥳");
    await w.get("[data-log-edit-cheer]").setValue("  ");
    await w.get("[data-log-edit-save]").trigger("click");
    const log = (w.emitted("save")![0] as DailyLog[])[0];
    expect(log.mood).toBe("🥳");
    expect(log.cheer).toBeUndefined();
  });
});
