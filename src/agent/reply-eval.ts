import { isClarifyQuestion } from "./clarify";
import { normKey } from "@/norm";
import type { ReplyCorpusCase } from "./reply-corpus";
import type { ProposedTodo } from "@/types";

export interface ReplyObservation {
  text: string;
  executedPropose: boolean;
  toolNames: string[];
  proposed: ProposedTodo[];
}

export interface ReplyScore {
  pass: boolean;
  misses: string[];
}

function hit(haystack: string[], needle: string): boolean {
  const n = normKey(needle);
  return haystack.some((h) => h.includes(n) || n.includes(h));
}

export function scoreReplyCase(c: ReplyCorpusCase, o: ReplyObservation): ReplyScore {
  const misses: string[] = [];
  if (c.expect.noPropose && o.executedPropose) misses.push("不应提议");
  if (c.expect.propose && !o.executedPropose) misses.push("应提议");
  if (c.expect.noSetTodayPlan && o.toolNames.includes("set_today_plan")) misses.push("不应 set_today_plan");
  if (c.expect.question && !isClarifyQuestion(o.text) && !/[？?]/.test(o.text)) misses.push("应是问句");
  const titles = o.proposed.map((t) => t.title);
  for (const t of c.expect.titles ?? []) if (!hit(titles, t)) misses.push(`缺提议:${t}`);
  const projects = o.proposed.map((t) => t.project ?? "").filter(Boolean);
  for (const p of c.expect.noProject ?? []) if (hit(projects, p)) misses.push(`误带 project:${p}`);
  return { pass: misses.length === 0, misses };
}
