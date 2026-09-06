import { describe, it, expect } from "vitest";
import { parseRichText } from "@/rich-text";

describe("parseRichText", () => {
  it("keeps plain text as a single unstyled segment", () => {
    expect(parseRichText("今天先买显示器")).toEqual([[{ text: "今天先买显示器", bold: false }]]);
  });

  it("splits **bold** into bold segments and strips the markers", () => {
    expect(parseRichText("建议先做**买显示器**这件")).toEqual([
      [
        { text: "建议先做", bold: false },
        { text: "买显示器", bold: true },
        { text: "这件", bold: false },
      ],
    ]);
  });

  it("preserves line breaks and empty lines", () => {
    expect(parseRichText("第一行\n\n第三行")).toEqual([
      [{ text: "第一行", bold: false }],
      [],
      [{ text: "第三行", bold: false }],
    ]);
  });

  it("leaves unmatched ** markers as literal text", () => {
    expect(parseRichText("这个 ** 没闭合")).toEqual([[{ text: "这个 ** 没闭合", bold: false }]]);
  });
});
