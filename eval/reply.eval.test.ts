import { describe, expect, it } from "vitest";
import { chatCompletions } from "@/api/deepseek";
import { runAgent } from "@/agent/loop";
import { REPLY_CORPUS } from "@/agent/reply-corpus";
import { scoreReplyCase, type ReplyObservation } from "@/agent/reply-eval";
import type { ChatCompletionRequest, ChatCompletionResponse } from "@/api/deepseek";
import type { ChatMessage, ProposedTodo, Todo } from "@/types";

const key = process.env.DEEPSEEK_API_KEY ?? "";
const model = process.env.EVAL_MODEL ?? "deepseek-v4-flash";

const postJson = async (url: string, headers: Record<string, string>, body: unknown) => {
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as unknown };
};

describe.skipIf(!key)("回复语料 eval（真实 API，需 DEEPSEEK_API_KEY）", () => {
  it("逐条打分并报告通过率", async () => {
    let pass = 0;
    for (const c of REPLY_CORPUS) {
      const toolNames: string[] = [];
      const proposed: ProposedTodo[] = [];
      const today: Todo[] = (c.todayTitles ?? []).map((title, i) => ({
        id: `t${i}`,
        title,
        status: "open" as const,
        when: "today" as const,
        sourceDate: "2026-09-06",
        createdAt: "2026-09-06T01:00:00.000Z",
      }));
      const history: ChatMessage[] = (c.context ?? []).map((m, i) => ({
        id: `h${i}`,
        role: m.role,
        content: m.content,
        createdAt: "2026-09-06T01:00:00.000Z",
        mode: "chat" as const,
      }));
      const complete = async (req: ChatCompletionRequest): Promise<ChatCompletionResponse> => {
        const res = await chatCompletions({ apiKey: key, request: req, postJson });
        for (const tc of res.tool_calls ?? []) toolNames.push(tc.function.name);
        return res;
      };
      const r = await runAgent({
        deps: {
          complete,
          listTodos: async () => today,
          setTodayPlan: async () => {},
          addTodos: async (items) => {
            proposed.push(...items);
          },
          now: () => new Date(2026, 8, 6, 10, 0, 0),
          onPropose: async (items) => items,
        },
        mode: "chat",
        userText: c.input,
        history,
        model,
      });
      const observed: ReplyObservation = {
        text: r.assistantText,
        executedPropose: r.executedPropose,
        toolNames,
        proposed,
      };
      const score = scoreReplyCase(c, observed);
      if (score.pass) pass += 1;
      else console.log(`✗ ${c.input}\n  ${score.misses.join("；")}`);
    }
    const rate = pass / REPLY_CORPUS.length;
    console.log(`通过率 ${pass}/${REPLY_CORPUS.length} = ${(rate * 100).toFixed(0)}%`);
    expect(rate).toBeGreaterThanOrEqual(0.6);
  });
});
