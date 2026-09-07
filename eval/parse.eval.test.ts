import { describe, expect, it } from "vitest";
import { chatCompletions } from "@/api/deepseek";
import { parseInput } from "@/agent/parse";
import { PARSE_CORPUS } from "@/agent/parse-corpus";
import { scoreCase } from "@/agent/parse-eval";

const key = process.env.DEEPSEEK_API_KEY ?? "";
const model = process.env.EVAL_MODEL ?? "deepseek-v4-flash";

const postJson = async (url: string, headers: Record<string, string>, body: unknown) => {
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as unknown };
};

describe.skipIf(!key)("解析语料 eval（真实 API，需 DEEPSEEK_API_KEY 环境变量）", () => {
  it("逐条打分并报告通过率", async () => {
    let pass = 0;
    for (const c of PARSE_CORPUS) {
      const result = await parseInput({
        text: c.input,
        date: "2026-09-06",
        todos: [],
        projects: [],
        model,
        recent: c.context,
        complete: (req) => chatCompletions({ apiKey: key, request: req, postJson }),
      });
      const score = scoreCase(c, result);
      if (score.pass) {
        pass += 1;
      } else {
        console.log(`✗ ${c.input}\n  ${score.misses.join("；")}`);
      }
    }
    const rate = pass / PARSE_CORPUS.length;
    console.log(`通过率 ${pass}/${PARSE_CORPUS.length} = ${(rate * 100).toFixed(0)}%`);
    expect(rate).toBeGreaterThanOrEqual(0.7);
  });
});
