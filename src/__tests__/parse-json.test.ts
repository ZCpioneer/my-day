import { describe, expect, it } from "vitest";
import { parseJsonObject } from "@/agent/parse-json";

describe("parseJsonObject", () => {
  it("直接解析对象", () => {
    expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it("从 json fence 里抽出对象", () => {
    expect(parseJsonObject('好了\n```json\n{"ok":true}\n```\n')).toEqual({ ok: true });
    expect(parseJsonObject("```\n{\"x\":2}\n```")).toEqual({ x: 2 });
  });

  it("前后废话时取第一个 { 到最后一个 }", () => {
    expect(parseJsonObject('说明一下 {"title":"买牛奶"} 就这些')).toEqual({ title: "买牛奶" });
  });

  it("顶层数组也返回（JS 里 array 是 object）", () => {
    expect(parseJsonObject("[1,2]")).toEqual([1, 2]);
  });

  it("非法 JSON 或空串返回 undefined", () => {
    expect(parseJsonObject("")).toBeUndefined();
    expect(parseJsonObject("   ")).toBeUndefined();
    expect(parseJsonObject("{nope")).toBeUndefined();
    expect(parseJsonObject("不是 json")).toBeUndefined();
  });
});
