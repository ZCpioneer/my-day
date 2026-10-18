import { describe, expect, it } from "vitest";
import { normKey, titlesOverlap } from "@/norm";

describe("normKey", () => {
  it("忽略空白与大小写", () => {
    expect(normKey(" 给房东 转水电费 ")).toBe("给房东转水电费");
    expect(normKey("Postgres DB")).toBe("postgresdb");
  });
});

describe("titlesOverlap", () => {
  it("去掉空白后一方完整包含另一方算同一条", () => {
    expect(titlesOverlap("摸清第一条链路", "摸清第一条链路：夸克网盘取素材")).toBe(true);
    expect(titlesOverlap("推进宝宝周岁相关的事", "推进宝宝周岁相关的事（急）")).toBe(true);
    expect(titlesOverlap("  给房东转水电费 ", "给房东转水电费")).toBe(true);
  });

  it("中间多字或空串不算包含", () => {
    expect(titlesOverlap("写一封周岁信", "写周岁信")).toBe(false);
    expect(titlesOverlap("", "买牛奶")).toBe(false);
    expect(titlesOverlap("买牛奶", "买面包")).toBe(false);
  });
});
