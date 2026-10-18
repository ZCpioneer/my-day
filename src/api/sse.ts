/**
 * 增量 SSE 解析器：把任意切分的字符串块喂进来，按 SSE 规范切出完整事件。
 *
 * 事件之间以空行分隔（\n\n，兼容 \r\n\r\n）；一个事件里可以有多行 data:，
 * 按规范用 \n 合并。feed 返回本批切出的完整事件的 data 载荷列表；
 * 没等到空行的半截事件留在内部缓冲里，等下一块补齐。
 * `data: [DONE]` 不特殊处理，作为普通载荷交给调用方判断。
 */
export interface SseParser {
  feed(chunk: string): string[];
}

/** 从一段完整事件文本里提取 data 载荷；没有 data 行（注释行等）返回 undefined。 */
function eventData(rawEvent: string): string | undefined {
  const dataLines: string[] = [];
  for (const line of rawEvent.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    // 规范允许「data:」后紧跟一个空格，去掉
    dataLines.push(line.slice(5).replace(/^ /, ""));
  }
  if (dataLines.length === 0) return undefined;
  return dataLines.join("\n");
}

export function createSseParser(): SseParser {
  let buffer = "";
  return {
    feed(chunk: string): string[] {
      buffer += chunk;
      const events: string[] = [];
      // 只切「空行已到账」的完整事件；结尾的半截留在 buffer 里等下一块。
      // 结尾若是「\n\r」这类被切块打断的分隔符，正则不匹配，自然不会误切。
      for (;;) {
        const boundary = /\r?\n\r?\n/.exec(buffer);
        if (!boundary) break;
        const rawEvent = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const data = eventData(rawEvent);
        if (data !== undefined) events.push(data);
      }
      return events;
    },
  };
}
