import { normKey } from "@/norm";
import type { ProposedTodo } from "@/types";

/** 引导问短名单：拆步 / 归属 / 方向。三处门闩共用。 */
const ASKS = /[？?]|哪几步|哪摊|哪个|还是|从哪/;
const KEYS = /拆|哪几步|哪摊|归属|切入|先定|先跑/;

/** 本轮模型正文是不是还在问清（不看用户原话、不看工具）。空正文不算。 */
export function isClarifyQuestion(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return ASKS.test(t) && KEYS.test(t);
}

/**
 * 解析框专用：比引导问宽。回复里有问号，或还在说「对吧 / 说清 / 要不要记」，
 * 且本轮没有提议时，解析 tasks 先不弹。不改回复工具和「阶段」的认法。
 */
export function replyStillAsking(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return /[？?]/.test(t) || /对吧|说清|要不要记/.test(t);
}

function cjk(s: string): string {
  return s.replace(/[a-z0-9]+/g, "");
}

export function projectMentioned(project: string, texts: string[]): boolean {
  const p = normKey(project);
  if (!p) return false;
  const pCjk = cjk(p);
  return texts.some((t) => {
    const n = normKey(t);
    if (!n) return false;
    if (n.includes(p) || p.includes(n)) return true;
    // 「AI视频」对上「这摊视频」：去掉拉丁前缀后的中文茎
    if (pCjk.length >= 2 && n.includes(pCjk)) return true;
    const nCjk = cjk(n);
    return nCjk.length >= 2 && p.includes(nCjk);
  });
}

/** 本句 + 上一轮用户 + 上一轮秘书。history 不含本句。 */
export function attributionTexts(
  userText: string,
  history: { role: string; content: string }[],
): string[] {
  const out: string[] = [];
  if (userText.trim()) out.push(userText);
  for (let i = history.length - 1; i >= 0 && out.length < 3; i--) {
    const m = history[i];
    if (m.role === "user" || m.role === "assistant") out.push(m.content);
  }
  return out;
}

/** 对话候选进「以后」：剥没点名的组，精确标题去重。 */
export function prepareLaterProposals(items: ProposedTodo[], mentionTexts: string[]): ProposedTodo[] {
  const seen = new Set<string>();
  const out: ProposedTodo[] = [];
  for (const it of items) {
    const k = normKey(it.title);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const project = it.project && projectMentioned(it.project, mentionTexts) ? it.project : undefined;
    out.push({ ...it, when: "later", project });
  }
  return out;
}
