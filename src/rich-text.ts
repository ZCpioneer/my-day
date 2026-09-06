// 聊天气泡的轻量富文本：只支持换行与 **加粗**，不引入 markdown 依赖。
export interface RichSegment {
  text: string;
  bold: boolean;
}

export type RichLine = RichSegment[];

function parseLine(line: string): RichLine {
  const parts = line.split(/(\*\*.+?\*\*)/g);
  const segments: RichSegment[] = [];
  for (const part of parts) {
    if (!part) continue;
    if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) {
      segments.push({ text: part.slice(2, -2), bold: true });
    } else {
      segments.push({ text: part, bold: false });
    }
  }
  return segments;
}

/** 按行切开，行内解析 **加粗**；空行保留为空数组，由渲染层留出间距。 */
export function parseRichText(text: string): RichLine[] {
  return text.split("\n").map(parseLine);
}
