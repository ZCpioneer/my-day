import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import GroupSheet from "@/components/GroupSheet.vue";
import type { Project } from "@/types";

const projects: Project[] = [
  { id: "p1", title: "搬家", status: "active", createdAt: "2026-09-06T01:00:00.000Z", updatedAt: "2026-09-06T01:00:00.000Z" },
  { id: "p2", title: "发布会", status: "done", createdAt: "2026-09-05T01:00:00.000Z", updatedAt: "2026-09-05T01:00:00.000Z" },
];

describe("GroupSheet assign 模式", () => {
  it("列出进行中组与未分组，点组抛出 pick", async () => {
    const w = mount(GroupSheet, { props: { mode: "assign", projects, current: null } });
    expect(w.text()).toContain("搬家");
    expect(w.text()).not.toContain("发布会");
    await w.get("[data-pick=p1]").trigger("click");
    expect(w.emitted("pick")?.[0]).toEqual(["p1", undefined]);
    await w.get("[data-pick=none]").trigger("click");
    expect(w.emitted("pick")?.[1]).toEqual([null, undefined]);
  });

  it("新建组：输入为空禁用，确认抛出新标题", async () => {
    const w = mount(GroupSheet, { props: { mode: "assign", projects, current: "p1" } });
    const btn = w.get("[data-new-confirm]");
    expect(btn.attributes("disabled")).toBeDefined();
    await w.get("input").setValue("装修");
    await btn.trigger("click");
    expect(w.emitted("pick")?.[0]).toEqual([null, "装修"]);
  });
});

describe("GroupSheet create 模式", () => {
  it("只有输入行，确认抛出组名", async () => {
    const w = mount(GroupSheet, { props: { mode: "create", projects } });
    expect(w.text()).toContain("新建组");
    expect(w.find("[data-pick]").exists()).toBe(false);
    const btn = w.get("[data-new-confirm]");
    expect(btn.attributes("disabled")).toBeDefined();
    await w.get("input").setValue("装修");
    await btn.trigger("click");
    expect(w.emitted("pick")?.[0]).toEqual([null, "装修"]);
  });
});

describe("GroupSheet manage 模式", () => {
  it("有未完任务时不出完成按钮；能完成时抛出 complete", async () => {
    const busy = mount(GroupSheet, {
      props: { mode: "manage", projects, group: projects[0], openCount: 2 },
    });
    expect(busy.find("[data-complete]").exists()).toBe(false);
    expect(busy.text()).toContain("还有 2 件没做完");

    const idle = mount(GroupSheet, {
      props: { mode: "manage", projects, group: projects[0], openCount: 0 },
    });
    await idle.get("[data-complete]").trigger("click");
    expect(idle.emitted("complete")?.[0]).toEqual([true]);
  });

  it("重命名抛出标题", async () => {
    const ren = mount(GroupSheet, {
      props: { mode: "manage", projects, group: projects[0], openCount: 0 },
    });
    await ren.get("input").setValue("乔迁");
    await ren.get("[data-rename]").trigger("click");
    expect(ren.emitted("rename")?.[0]).toEqual(["乔迁"]);
  });
});
