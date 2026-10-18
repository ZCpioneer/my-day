import { describe, expect, it } from "vitest";
import { createSseParser } from "@/api/sse";

describe("SSE 解析器", () => {
  it("一个 chunk 里的完整事件直接切出来", () => {
    const p = createSseParser();
    expect(p.feed('data: {"a":1}\n\n')).toEqual(['{"a":1}']);
  });

  it("一个 chunk 里多个事件按顺序全部返回", () => {
    const p = createSseParser();
    expect(p.feed("data: 一\n\ndata: 二\n\ndata: 三\n\n")).toEqual(["一", "二", "三"]);
  });

  it("跨 chunk 的半截事件等补齐后才产出", () => {
    const p = createSseParser();
    expect(p.feed("data: 你好")).toEqual([]);
    expect(p.feed("，世")).toEqual([]);
    expect(p.feed("界\n\n")).toEqual(["你好，世界"]);
  });

  it("事件边界被切块打断（\\n\\n 分开到）也能拼上", () => {
    const p = createSseParser();
    expect(p.feed("data: 甲\n")).toEqual([]);
    expect(p.feed("\ndata: 乙\n\n")).toEqual(["甲", "乙"]);
  });

  it("\\r\\n 换行与被打断的 \\r\\n\\r\\n 边界都认得", () => {
    const p = createSseParser();
    expect(p.feed("data: 甲\r\n\r")).toEqual([]);
    expect(p.feed("\ndata: 乙\r\n\r\n")).toEqual(["甲", "乙"]);
  });

  it("多行 data 按规范用 \\n 合并成一个载荷", () => {
    const p = createSseParser();
    expect(p.feed("data: 第一行\ndata: 第二行\n\n")).toEqual(["第一行\n第二行"]);
  });

  it("非 data 行（event:/id:/注释）忽略；没有 data 的事件不产出", () => {
    const p = createSseParser();
    expect(p.feed(": 心跳注释\n\nevent: message\nid: 7\ndata: 正文\n\n")).toEqual(["正文"]);
  });

  it("[DONE] 作为普通载荷原样交出（由调用方判断终止）", () => {
    const p = createSseParser();
    expect(p.feed('data: {"x":1}\n\ndata: [DONE]\n\n')).toEqual(['{"x":1}', "[DONE]"]);
  });

  it("data: 后紧跟的一个空格按规范去掉", () => {
    const p = createSseParser();
    expect(p.feed("data:  前面两空格只去一个\n\n")).toEqual([" 前面两空格只去一个"]);
  });

  it("结尾的半截事件留在缓冲里，不会提前吐出", () => {
    const p = createSseParser();
    expect(p.feed("data: 完整\n\ndata: 半截")).toEqual(["完整"]);
    expect(p.feed("\n\n")).toEqual(["半截"]);
  });
});
