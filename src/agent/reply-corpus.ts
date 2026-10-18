/** 回复侧语料：问清 / 整理。与 PARSE_CORPUS 共用故事，多一列「该不该提议」。
 *  完整性走 reply-corpus.test.ts；真实 API 走 eval/reply.eval.test.ts。 */
export interface ReplyCorpusCase {
  input: string;
  note?: string;
  context?: { role: "user" | "assistant"; content: string }[];
  /** 注入「今天」待办标题，测负荷。 */
  todayTitles?: string[];
  expect: {
    /** 本轮必须出现提议工具。 */
    propose?: boolean;
    /** 本轮不得 propose_todos / set_today_plan。 */
    noPropose?: boolean;
    /** 本轮不得 set_today_plan。 */
    noSetTodayPlan?: boolean;
    /** 回复应是问句。 */
    question?: boolean;
    /** 提议标题应包含的关键词。 */
    titles?: string[];
    /** 提议不得带上的项目名。 */
    noProject?: string[];
  };
}

export const REPLY_CORPUS: ReplyCorpusCase[] = [
  {
    input: "我要做一个AI视频",
    note: "一摊事刚冒头：只问一句，不提议",
    expect: { noPropose: true, question: true },
  },
  {
    context: [
      { role: "user", content: "我要做一个AI视频的事情" },
      { role: "assistant", content: "这摊事要拆成哪几步？" },
    ],
    input: "拆成两步吧：先写脚本，再生成画面",
    expect: { propose: true, titles: ["脚本", "画面"] },
  },
  {
    input: "记得给妈妈回电话",
    expect: { propose: true, titles: ["回电话"] },
  },
  {
    input: "下午再加个会",
    note: "今天已经排了不少，不把新会塞进今日计划",
    todayTitles: ["交稿", "开会", "回邮件"],
    expect: { noSetTodayPlan: true },
  },
  {
    input: "买瓷砖",
    note: "没点名归属，即使有装修组也不带 project",
    expect: { noProject: ["装修"] },
  },
];
