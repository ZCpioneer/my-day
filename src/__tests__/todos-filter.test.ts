import { describe, it, expect } from "vitest";
import { filterPlanItems, filterTodayPlanItems, mergeOverlappingProposed, withoutCoveredTitles } from "@/todos-filter";

describe("filterPlanItems", () => {
  it("keeps today and later, drops blanks, and lets today win on duplicates", () => {
    const plan = filterPlanItems({
      today: [{ title: " 支付宝 " }, { title: " " }, { title: "水电" }],
      later: [{ title: "周报" }, { title: "支付宝" }, { title: "水电" }],
    });
    expect(plan.today.map((x) => x.title)).toEqual(["支付宝", "水电"]);
    expect(plan.later.map((x) => x.title)).toEqual(["周报"]);
    expect(plan.today.every((x) => x.when === "today")).toBe(true);
    expect(plan.later.every((x) => x.when === "later")).toBe(true);
  });

  it("spills extra today items into later so a day stays short", () => {
    const plan = filterPlanItems({
      today: [
        { title: "一" },
        { title: "二" },
        { title: "三" },
        { title: "四" },
        { title: "五" },
      ],
      later: [{ title: "以后的" }],
    });
    expect(plan.today.map((x) => x.title)).toEqual(["一", "二", "三", "四"]);
    expect(plan.later.map((x) => x.title)).toEqual(["五", "以后的"]);
  });

  it("treats legacy items as today", () => {
    const plan = filterPlanItems({
      items: [{ title: "支付宝" }],
      later: [{ title: "周报" }],
    });
    expect(plan.today.map((x) => x.title)).toEqual(["支付宝"]);
    expect(plan.later.map((x) => x.title)).toEqual(["周报"]);
  });
});

describe("filterTodayPlanItems", () => {
  it("去掉空白与重复标题，一律 when=today", () => {
    const out = filterTodayPlanItems([
      { title: "  支付宝  ", reason: "  先付  ", project: "搬家" },
      { title: " " },
      { title: "支付宝" },
      { title: "水电", reason: "   " },
    ]);
    expect(out.map((x) => x.title)).toEqual(["支付宝", "水电"]);
    expect(out.every((x) => x.when === "today")).toBe(true);
  });

  it("不保留 project，空白 reason 变 undefined", () => {
    const out = filterTodayPlanItems([{ title: "买牛奶", project: "日常", reason: "  " }]);
    expect(out).toEqual([{ title: "买牛奶", reason: undefined, when: "today" }]);
    expect(out[0]).not.toHaveProperty("project");
  });
});

describe("withoutCoveredTitles", () => {
  it("未完成标题被包含或包含候选时丢掉候选，已完成只挡全字相同", () => {
    const existing = [
      { title: "摸清第一条链路", status: "open" },
      { title: "给房东转水电费", status: "done" },
    ];
    const out = withoutCoveredTitles(
      [
        { title: "摸清第一条链路：夸克网盘取素材", when: "later" },
        { title: "推进宝宝周岁相关的事（急）", when: "later" },
        { title: "给房东转水电费", when: "later" },
        { title: "给房东转水电费今天再催", when: "later" },
        { title: "买牛奶", when: "later" },
      ],
      existing,
    );
    expect(out.map((x) => x.title)).toEqual(["推进宝宝周岁相关的事（急）", "给房东转水电费今天再催", "买牛奶"]);
  });

  it("同一批里互相包含时留更长的那句", () => {
    const out = withoutCoveredTitles(
      [
        { title: "摸清第一条链路", when: "later" },
        { title: "摸清第一条链路：夸克网盘取素材", when: "later" },
      ],
      [],
    );
    expect(out.map((x) => x.title)).toEqual(["摸清第一条链路：夸克网盘取素材"]);
  });
});

describe("mergeOverlappingProposed", () => {
  it("互相包含的标题合成一条，留更长的，今天优先于以后", () => {
    const out = mergeOverlappingProposed([
      { title: "摸清第一条链路", when: "later", project: "AI剪视频" },
      { title: "摸清第一条链路：夸克网盘取素材", when: "later", project: "AI剪视频" },
      { title: "写周岁信", when: "today" },
      { title: "推进宝宝周岁相关的事", when: "later" },
      { title: "推进宝宝周岁相关的事（急）", when: "today" },
    ]);
    expect(out.map((x) => ({ title: x.title, when: x.when }))).toEqual([
      { title: "摸清第一条链路：夸克网盘取素材", when: "later" },
      { title: "写周岁信", when: "today" },
      { title: "推进宝宝周岁相关的事（急）", when: "today" },
    ]);
  });
});
