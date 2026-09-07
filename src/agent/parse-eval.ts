import { normKey } from "@/norm";
import { isChitchat } from "./parse";
import type { CorpusCase } from "./parse-corpus";
import type { ParseResult } from "@/types";

export interface ScoreResult {
  pass: boolean;
  misses: string[];
}

function hit(haystack: string[], needle: string): boolean {
  const n = normKey(needle);
  return haystack.some((h) => h.includes(n) || n.includes(h));
}

/** 用语料期望给真实解析结果打分。所有匹配都是归一化后的双向包含。 */
export function scoreCase(c: CorpusCase, r: ParseResult): ScoreResult {
  const misses: string[] = [];
  const taskTitles = r.tasks.map((t) => normKey(t.title));
  const eventTexts = r.events.map(normKey);
  const decisionTexts = r.decisions.map(normKey);
  const waitingTexts = r.waitings.map((w) => normKey(w.text));

  for (const t of c.expect.tasks ?? []) if (!hit(taskTitles, t)) misses.push(`缺 task:${t}`);
  for (const t of c.expect.notTasks ?? []) if (hit(taskTitles, t)) misses.push(`误抽 task:${t}`);
  for (const e of c.expect.events ?? []) if (!hit(eventTexts, e)) misses.push(`缺 event:${e}`);
  for (const d of c.expect.decisions ?? []) if (!hit(decisionTexts, d)) misses.push(`缺 decision:${d}`);
  for (const w of c.expect.waitings ?? []) if (!hit(waitingTexts, w)) misses.push(`缺 waiting:${w}`);
  const taskProjects = r.tasks.map((t) => normKey(t.project ?? "")).filter(Boolean);
  for (const p of c.expect.projects ?? []) if (!hit(taskProjects, p)) misses.push(`缺 project:${p}`);
  for (const e of c.expect.estimates ?? []) {
    const t = r.tasks.find((x) => hit([normKey(x.title)], e.task));
    if (!t) misses.push(`缺 task:${e.task}（估时）`);
    else if (t.estimate !== e.minutes) misses.push(`task:${e.task} 估时应为 ${e.minutes} 分钟，实际 ${t.estimate ?? "无"}`);
  }
  if (c.expect.chitchat && !isChitchat(r)) misses.push("应为纯闲聊");
  return { pass: misses.length === 0, misses };
}
