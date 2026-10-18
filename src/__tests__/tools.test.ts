import { describe, expect, it } from "vitest";
import { TOOL_DEFS } from "@/agent/tools";

describe("TOOL_DEFS", () => {
  it("回复循环只有三件工具，没有勾掉或写日记", () => {
    expect(TOOL_DEFS.map((t) => t.function.name)).toEqual(["list_todos", "set_today_plan", "propose_todos"]);
    const names = TOOL_DEFS.map((t) => t.function.name);
    expect(names).not.toContain("write_daily_log");
    expect(names).not.toContain("suggest_order");
  });

  it("list_todos 没有必填参数", () => {
    const list = TOOL_DEFS.find((t) => t.function.name === "list_todos")!;
    const params = list.function.parameters as { required?: string[] };
    expect(params.required).toBeUndefined();
  });

  it("propose_todos 的 items.title 必填，并声明 due/estimate/project/priority", () => {
    const propose = TOOL_DEFS.find((t) => t.function.name === "propose_todos")!;
    const params = propose.function.parameters as {
      required?: string[];
      properties: { items: { items: { required?: string[]; properties: Record<string, unknown> } } };
    };
    expect(params.required).toEqual(["items"]);
    const item = params.properties.items.items;
    expect(item.required).toEqual(["title"]);
    expect(item.properties).toMatchObject({
      title: { type: "string" },
      due: { type: "string" },
      estimate: { type: "number" },
      project: { type: "string" },
      priority: { type: "string", enum: ["high", "normal"] },
    });
  });
});
