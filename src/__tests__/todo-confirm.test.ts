import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import TodoConfirm from "@/components/TodoConfirm.vue";
import type { ProposedTodo } from "@/types";

const items: ProposedTodo[] = [
  { title: "找房", when: "later", project: "搬家" },
  { title: "打包", when: "later", project: "搬家" },
  { title: "买纸箱", when: "later" },
  { title: "写稿子", when: "later", project: "发布会" },
];

describe("TodoConfirm 按组分组", () => {
  it("同组候选收在组名标题下，未分组无组标题", () => {
    const w = mount(TodoConfirm, { props: { items, existingProjects: [] } });
    const labels = w.findAll(".propose-sub").map((el) => el.text());
    expect(labels.some((t) => t.includes("搬家"))).toBe(true);
    expect(labels.some((t) => t.includes("发布会"))).toBe(true);
    expect(labels).toHaveLength(2);
    // 组标题相对位置：搬家标题在「找房」前
    const text = w.text();
    expect(text.indexOf("搬家")).toBeLessThan(text.indexOf("找房"));
    expect(text.indexOf("买纸箱")).toBeGreaterThan(text.indexOf("写稿子"));
  });

  it("已有项目不打标，新组标「新」", () => {
    const w = mount(TodoConfirm, { props: { items, existingProjects: ["搬家"] } });
    const subs = w.findAll(".propose-sub");
    const move = subs.find((el) => el.text().includes("搬家"))!;
    const launch = subs.find((el) => el.text().includes("发布会"))!;
    expect(move.find(".propose-new").exists()).toBe(false);
    expect(launch.find(".propose-new").exists()).toBe(true);
  });

  it("全部无组时不渲染组标题；confirm 仍按勾选原样抛出", async () => {
    const plain: ProposedTodo[] = [{ title: "甲" }, { title: "乙" }];
    const w = mount(TodoConfirm, { props: { items: plain } });
    expect(w.find(".propose-sub").exists()).toBe(false);
    await w.findAll(".todo-pick input")[1].setValue(false);
    await w.get(".btn-yes").trigger("click");
    expect(w.emitted("confirm")?.[0]).toEqual([[{ title: "甲" }]]);
  });

  it("today/later 分桶标签保留", () => {
    const mixed: ProposedTodo[] = [
      { title: "今天事", when: "today", project: "搬家" },
      { title: "以后事", when: "later", project: "搬家" },
    ];
    const w = mount(TodoConfirm, { props: { items: mixed } });
    const groups = w.findAll(".propose-group").map((el) => el.text());
    expect(groups).toContain("今天");
    expect(groups).toContain("以后");
  });

  it("组标题 checkbox 整组勾选/取消", async () => {
    const items: ProposedTodo[] = [
      { title: "找房", when: "later", project: "搬家" },
      { title: "打包", when: "later", project: "搬家" },
      { title: "写稿子", when: "later", project: "发布会" },
    ];
    const w = mount(TodoConfirm, { props: { items, existingProjects: [] } });
    const subChecks = w.findAll(".propose-sub-check input");
    expect(subChecks).toHaveLength(2);
    // 默认全勾；取消「搬家」整组
    await subChecks[0].setValue(false);
    await w.get(".btn-yes").trigger("click");
    expect(w.emitted("confirm")?.[0]).toEqual([[{ title: "写稿子", when: "later", project: "发布会" }]]);
  });
});

describe("TodoConfirm 确认前调整", () => {
  it("调整归属后重新分组，confirm 抛出改后的值", async () => {
    const w = mount(TodoConfirm, {
      props: { items: [{ title: "买纸箱", when: "later" }], existingProjects: ["搬家"] },
    });
    expect(w.find(".propose-sub").exists()).toBe(false);
    await w.get(".todo-adjust").trigger("click");
    await w.get(".todo-edit select").setValue("搬家");
    expect(w.findAll(".propose-sub").map((el) => el.text())).toContain("搬家");
    await w.get(".btn-yes").trigger("click");
    expect(w.emitted("confirm")?.[0]).toEqual([[{ title: "买纸箱", when: "later", project: "搬家" }]]);
  });

  it("可改截止、耗时、急", async () => {
    const w = mount(TodoConfirm, { props: { items: [{ title: "交稿", when: "later" }] } });
    await w.get(".todo-adjust").trigger("click");
    await w.get('.todo-edit input[type="date"]').setValue("2099-01-02");
    await w.get('.todo-edit input[type="number"]').setValue(45);
    await w.get('.todo-edit input[type="checkbox"]').setValue(true);
    await w.get(".btn-yes").trigger("click");
    expect(w.emitted("confirm")?.[0]).toEqual([
      [{ title: "交稿", when: "later", due: "2099-01-02", estimate: 45, priority: "high" }],
    ]);
  });

  it("选「＋ 新组…」后用文本输入的组名", async () => {
    const w = mount(TodoConfirm, { props: { items: [{ title: "找房", when: "later" }], existingProjects: [] } });
    await w.get(".todo-adjust").trigger("click");
    await w.get(".todo-edit select").setValue("__new__");
    await w.get(".todo-edit-new").setValue("搬家");
    await w.get(".btn-yes").trigger("click");
    expect(w.emitted("confirm")?.[0]).toEqual([[{ title: "找房", when: "later", project: "搬家" }]]);
  });

  it("候选带 reason 时显示在标题下", () => {
    const w = mount(TodoConfirm, {
      props: { items: [{ title: "去银行", when: "later", reason: "利率要重签" }] },
    });
    expect(w.get(".todo-why").text()).toBe("利率要重签");
  });
});
